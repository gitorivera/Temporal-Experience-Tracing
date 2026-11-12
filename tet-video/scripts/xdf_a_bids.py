#!/usr/bin/env python3
"""Convierte las capturas de `sourcedata/` en BIDS válido (ver test_files/bids/README.md).

BIDS no admite el `.xdf` como EEG crudo —solo BrainVision, EDF, BDF y EEGLAB—, así que lo que
graba LabRecorder se queda en `sourcedata/` y de ahí sale el conjunto:

    sourcedata/sub-001/ses-01/eeg/run-001_acq-quest/sub-001_..._eeg.xdf
        → sub-001/ses-01/eeg/sub-001_..._eeg.vhdr  (+ .eeg, .vmrk)
                                sub-001_..._eeg.json
                                sub-001_..._channels.tsv
                                sub-001_..._events.tsv
          sub-001/ses-01/sub-001_ses-01_scans.tsv
        → derivatives/tet/sub-001/ses-01/beh/sub-001_..._desc-tet_timeseries.tsv  (y demás)

Las entidades (sub, ses, task, acq, run y la modalidad) salen del nombre del XDF, que ya los trae
porque LabRecorder los escribe con la plantilla BIDS. La raíz del conjunto se deduce subiendo
hasta la carpeta `sourcedata`.

El tiempo cero de cada pasada es la primera muestra del EEG; los eventos y las trazas de TET se
pasan a ese reloj restando ese instante de su `tiempo_lsl_s` (el mismo reloj LSL que ya corrigió
pyxdf). En una pasada sin EEG (modalidad `beh`) el cero es el primer marcador del juego.

Uso (dentro de tet-video/):
    pip install pyxdf numpy
    python scripts/xdf_a_bids.py ../test_files/bids/sourcedata                    # todas las pasadas
    python scripts/xdf_a_bids.py ../test_files/bids/sourcedata/sub-001/ses-01     # una visita
    python scripts/xdf_a_bids.py ruta/sub-001_..._eeg.xdf --sobrescribir
    python scripts/xdf_a_bids.py CARPETA --referencia "CMS/DRL (BioSemi)" --fabricante BioSemi
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

# Stream de marcadores del juego (GAME-SPECS §4); los demás (ColorQuestMarkers) no se exportan.
STREAM_JUEGO = "JuegoEventos"
# Frecuencia de las trazas de TET (SPEC §8.2): una muestra cada 0,1 s.
TET_HZ = 10.0
# Campos fijos del equipo de EEG (fabricante, referencia, descripción de la tarea…). Va en
# sourcedata/ y no en la raíz: un «task-<x>_eeg.json» suelto sin SamplingFrequency lo rechaza el
# validador, así que estos campos se copian dentro del sidecar de cada pasada.
DEFAULTS_EEG = "eeg_defaults.json"
# Si el ritmo efectivo del EEG se aleja más que esto del nominal, se avisa.
TOLERANCIA_RITMO = 0.005

ENTIDADES_RE = re.compile(
    r"^sub-(?P<sub>[A-Za-z0-9]+)"
    r"_ses-(?P<ses>[A-Za-z0-9]+)"
    r"_task-(?P<task>[A-Za-z0-9]+)"
    r"(?:_acq-(?P<acq>[A-Za-z0-9]+))?"
    r"(?:_run-(?P<run>[A-Za-z0-9]+))?"
    r"_(?P<sufijo>eeg|beh)$"
)

# Etiquetas del juego → (trial_type, valor). El número final de la etiqueta es el valor.
TIPOS = (
    (re.compile(r"^sync[_ ]?(\d+)?$", re.I), "sync"),
    (re.compile(r"^inicio[_ ]partida$", re.I), "inicio_partida"),
    (re.compile(r"^fin[_ ]partida$", re.I), "fin_partida"),
    (re.compile(r"^inicio[_ ]nivel[_ ]?(\d+)?$", re.I), "inicio_nivel"),
    (re.compile(r"^acierto[_ ]objetivo[_ ]?(\d+)?$", re.I), "acierto"),
    (re.compile(r"^error[_ ]objetivo[_ ]?(\d+)?$", re.I), "error"),
    (re.compile(r"^premio[_ ]puntos[_ ]?(\d+)?$", re.I), "premio"),
)


class ErrorBids(Exception):
    """Algo impide convertir esta pasada; el mensaje dice qué."""


# ---------------------------------------------------------------------------------------------
# Nombres y entidades


def sin_tildes(texto: str) -> str:
    """«Diversión» → «diversion»: para nombres de columna y de archivo."""
    base = unicodedata.normalize("NFD", texto)
    return "".join(c for c in base if unicodedata.category(c) != "Mn")


def etiqueta_bids(texto: str) -> str:
    """Deja solo letras y números, que es lo que admite una etiqueta de BIDS."""
    return re.sub(r"[^A-Za-z0-9]+", "", sin_tildes(texto))


def columna(texto: str) -> str:
    """Nombre de columna: minúsculas, sin tildes y con guiones bajos."""
    limpio = re.sub(r"[^a-z0-9]+", "_", sin_tildes(texto).lower())
    return limpio.strip("_")


def entidades_de(nombre: str) -> dict[str, str]:
    """Entidades BIDS del nombre de archivo (sin extensión); ErrorBids si no las trae."""
    m = ENTIDADES_RE.match(nombre)
    if not m:
        raise ErrorBids(
            f"«{nombre}» no tiene nombre BIDS. Se esperaba algo como "
            "sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg (ver el README del conjunto)."
        )
    return {k: v for k, v in m.groupdict().items() if v}


def base_de(nombre: str) -> str:
    """El nombre sin la modalidad final: «sub-001_…_run-001_eeg» → «sub-001_…_run-001»."""
    return nombre.rsplit("_", 1)[0]


def raiz_bids(ruta: Path) -> Path:
    """Raíz del conjunto: la carpeta que contiene a `sourcedata`."""
    for padre in ruta.resolve().parents:
        if padre.name == "sourcedata":
            return padre.parent
    raise ErrorBids(
        f"{ruta} no está dentro de una carpeta «sourcedata»: indica la raíz con --bids RUTA."
    )


# ---------------------------------------------------------------------------------------------
# Streams del XDF


def _campo(info: dict, clave: str, por_omision: str = "") -> str:
    """En pyxdf cada campo de `info` es una lista con un solo valor."""
    valor = info.get(clave, [por_omision])
    if isinstance(valor, list):
        valor = valor[0] if valor else por_omision
    return str(valor if valor is not None else por_omision)


def nombre_stream(s: dict) -> str:
    return _campo(s.get("info", {}), "name")


def stream_eeg(streams: Sequence[dict]) -> dict | None:
    """El primer stream de tipo EEG con muestras."""
    for s in streams:
        if _campo(s.get("info", {}), "type").upper() == "EEG" and len(s.get("time_stamps", [])):
            return s
    return None


def stream_marcadores(streams: Sequence[dict], nombre: str = STREAM_JUEGO) -> dict | None:
    for s in streams:
        if nombre_stream(s) == nombre:
            return s
    return None


def nombres_canales(info: dict) -> list[str]:
    """Nombres de los canales de la cabecera del stream; Ch1, Ch2… si no los trae."""
    nombres: list[str] = []
    desc = info.get("desc", [{}])
    desc = desc[0] if isinstance(desc, list) and desc else desc
    if isinstance(desc, dict):
        canales = desc.get("channels", [{}])
        canales = canales[0] if isinstance(canales, list) and canales else canales
        if isinstance(canales, dict):
            for c in canales.get("channel", []) or []:
                if isinstance(c, dict):
                    nombres.append(_campo(c, "label") or _campo(c, "name"))
    n = int(float(_campo(info, "channel_count", "0") or 0))
    nombres = [x for x in nombres if x]
    if len(nombres) != n:
        nombres = [f"Ch{i + 1}" for i in range(n)]
    return nombres


def unidades_canales(info: dict, n: int) -> list[str]:
    """Unidad de cada canal; µV cuando la cabecera no dice nada (lo normal en LSL)."""
    unidades: list[str] = []
    desc = info.get("desc", [{}])
    desc = desc[0] if isinstance(desc, list) and desc else desc
    if isinstance(desc, dict):
        canales = desc.get("channels", [{}])
        canales = canales[0] if isinstance(canales, list) and canales else canales
        if isinstance(canales, dict):
            for c in canales.get("channel", []) or []:
                if isinstance(c, dict):
                    unidades.append(_campo(c, "unit"))
    unidades = [u if u else "µV" for u in unidades]
    if len(unidades) != n:
        unidades = ["µV"] * n
    return unidades


def ritmos(s: dict) -> tuple[float, float]:
    """(nominal, efectivo) en Hz. El efectivo sale de los tiempos de la primera y última muestra."""
    nominal = float(_campo(s.get("info", {}), "nominal_srate", "0") or 0)
    t = np.asarray(s.get("time_stamps", []), dtype=float)
    efectivo = (len(t) - 1) / (t[-1] - t[0]) if len(t) > 1 and t[-1] > t[0] else 0.0
    return nominal, efectivo


# ---------------------------------------------------------------------------------------------
# BrainVision


def escribir_brainvision(destino: Path, X: np.ndarray, fs: float, canales: Sequence[str],
                         unidades: Sequence[str], inicio: datetime | None = None) -> None:
    """Escribe el trío .vhdr/.eeg/.vmrk de BrainVision (binario float32, multiplexado).

    `X` es (muestras × canales) y `destino` es la ruta del .vhdr. Los eventos no van aquí: en
    BIDS viven en el _events.tsv, y el .vmrk solo lleva el marcador «New Segment» del inicio.
    """
    if X.ndim != 2:
        raise ErrorBids(f"Los datos de EEG tienen que ser (muestras × canales), no {X.shape}.")
    if X.shape[1] != len(canales) or len(canales) != len(unidades):
        raise ErrorBids("El número de canales no coincide con el de nombres o unidades.")
    if fs <= 0:
        raise ErrorBids("La frecuencia de muestreo tiene que ser mayor que cero.")

    datos = destino.with_suffix(".eeg")
    marcas = destino.with_suffix(".vmrk")
    # Multiplexado: todos los canales de una muestra, uno tras otro. C-order ya los deja así.
    np.ascontiguousarray(X, dtype="<f4").tofile(datos)

    # La coma separa los campos de «Ch<n>=», así que en los nombres se escapa como \1.
    def limpio(nombre: str) -> str:
        return nombre.replace(",", r"\1")

    intervalo_us = 1_000_000.0 / fs
    cabecera = [
        "Brain Vision Data Exchange Header File Version 1.0",
        "; Escrito por xdf_a_bids.py (Temporal Experience Tracing)",
        "",
        "[Common Infos]",
        "Codepage=UTF-8",
        f"DataFile={datos.name}",
        f"MarkerFile={marcas.name}",
        "DataFormat=BINARY",
        "DataOrientation=MULTIPLEXED",
        f"NumberOfChannels={len(canales)}",
        f"SamplingInterval={intervalo_us:.6f}",
        "",
        "[Binary Infos]",
        "BinaryFormat=IEEE_FLOAT_32",
        "",
        "[Channel Infos]",
    ]
    for i, (nombre, unidad) in enumerate(zip(canales, unidades), 1):
        cabecera.append(f"Ch{i}={limpio(nombre)},,1,{unidad}")
    destino.write_text("\n".join(cabecera) + "\n", encoding="utf-8")

    sello = (inicio or datetime.now()).strftime("%Y%m%d%H%M%S%f")
    marcas.write_text(
        "\n".join([
            "Brain Vision Data Exchange Marker File, Version 1.0",
            "",
            "[Common Infos]",
            "Codepage=UTF-8",
            f"DataFile={datos.name}",
            "",
            "[Marker Infos]",
            f"Mk1=New Segment,,1,1,0,{sello}",
        ]) + "\n",
        encoding="utf-8",
    )


def leer_brainvision(vhdr: Path) -> tuple[np.ndarray, float, list[str]]:
    """Lee lo que escribe `escribir_brainvision`: (datos, fs, nombres). Para las pruebas."""
    campos: dict[str, str] = {}
    canales: list[str] = []
    for linea in vhdr.read_text(encoding="utf-8").splitlines():
        if linea.startswith(";") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        if clave.startswith("Ch") and clave[2:].isdigit():
            canales.append(valor.split(",")[0].replace(r"\1", ","))
        else:
            campos[clave] = valor
    n = int(campos["NumberOfChannels"])
    fs = 1_000_000.0 / float(campos["SamplingInterval"])
    datos = np.fromfile(vhdr.with_name(campos["DataFile"]), dtype="<f4")
    return datos.reshape(-1, n), fs, canales


# ---------------------------------------------------------------------------------------------
# Eventos


def tipo_y_valor(etiqueta: str) -> tuple[str, str]:
    """«acierto objetivo 3» → («acierto», «3»); lo que no reconoce pasa a minúsculas con _."""
    texto = etiqueta.strip()
    for patron, tipo in TIPOS:
        m = patron.match(texto)
        if m:
            grupos = m.groups()
            return tipo, (grupos[0] if grupos and grupos[0] else "n/a")
    numero = re.search(r"(\d+)\s*$", texto)
    tipo = columna(re.sub(r"\d+\s*$", "", texto)) or "otro"
    return tipo, (numero.group(1) if numero else "n/a")


def filas_eventos(marcadores: Iterable[tuple[float, str]], t0: float) -> list[dict[str, Any]]:
    """Filas del _events.tsv a partir de (tiempo LSL, etiqueta), con el cero en `t0`."""
    filas = []
    for t, etiqueta in sorted(marcadores, key=lambda r: r[0]):
        tipo, valor = tipo_y_valor(etiqueta)
        filas.append({
            "onset": f"{t - t0:.4f}",
            "duration": "0",
            "trial_type": tipo,
            "value": valor,
            "marker": etiqueta,
            "source": "lsl",
        })
    return filas


def marcadores_de(s: dict) -> list[tuple[float, str]]:
    """(tiempo, etiqueta) de un stream de marcadores; una muestra de varios canales se une con «|»."""
    filas = []
    for t, muestra in zip(s.get("time_stamps", []), s.get("time_series", [])):
        valores = muestra if isinstance(muestra, (list, tuple, np.ndarray)) else [muestra]
        etiqueta = "|".join(str(v) for v in valores).strip()
        if etiqueta:
            filas.append((float(t), etiqueta))
    return sorted(filas, key=lambda r: r[0])


# ---------------------------------------------------------------------------------------------
# Escritura de TSV y JSON


def escribir_tsv(ruta: Path, columnas: Sequence[str], filas: Sequence[dict[str, Any]]) -> None:
    """TSV de BIDS: UTF-8, tabuladores, «n/a» en lo que falte y fin de línea \\n."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with ruta.open("w", encoding="utf-8", newline="\n") as f:
        f.write("\t".join(columnas) + "\n")
        for fila in filas:
            f.write("\t".join(str(fila.get(c, "n/a")) for c in columnas) + "\n")


def leer_tsv(ruta: Path) -> tuple[list[str], list[dict[str, str]]]:
    with ruta.open(encoding="utf-8", newline="") as f:
        lector = csv.DictReader(f, delimiter="\t")
        return list(lector.fieldnames or []), list(lector)


def escribir_json(ruta: Path, datos: dict[str, Any]) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    # Sin BOM: json.load de Python y otros lectores fallan con él (CLAUDE.md, cambio 1).
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def defaults_eeg(raiz: Path) -> dict[str, Any]:
    """Campos fijos del equipo, de `sourcedata/eeg_defaults.json`; {} si no está."""
    ruta = raiz / "sourcedata" / DEFAULTS_EEG
    if not ruta.exists():
        return {}
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as e:
        raise ErrorBids(f"{ruta} no es JSON válido: {e}")
    if not isinstance(datos, dict):
        raise ErrorBids(f"{ruta} tiene que ser un objeto JSON con los campos del sidecar.")
    return datos


def actualizar_scans(ruta: Path, archivo: str, acq_time: str) -> None:
    """Agrega o actualiza la fila de este archivo en el *_scans.tsv de la visita."""
    filas: list[dict[str, str]] = []
    if ruta.exists():
        _, filas = leer_tsv(ruta)
    filas = [f for f in filas if f.get("filename") != archivo]
    filas.append({"filename": archivo, "acq_time": acq_time})
    filas.sort(key=lambda f: f["filename"])
    escribir_tsv(ruta, ["filename", "acq_time"], filas)


def fecha_xdf(cabecera: dict, respaldo: Path) -> str:
    """Hora de inicio de la grabación, de la cabecera del XDF o de la fecha del archivo.

    En el formato que pide BIDS para `acq_time`: AAAA-MM-DDTHH:MM:SS, hora local y **sin** el
    desfase del huso (el validador lo rechaza; las fechas suelen anonimizarse).
    """
    info = cabecera.get("info", {}) if isinstance(cabecera, dict) else {}
    texto = _campo(info, "datetime") if isinstance(info, dict) else ""
    cuando: datetime | None = None
    if texto:
        try:
            cuando = datetime.fromisoformat(texto.strip().replace("Z", "+00:00"))
        except ValueError:
            cuando = None
    if cuando is None:
        cuando = datetime.fromtimestamp(respaldo.stat().st_mtime)
    return cuando.replace(tzinfo=None).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------------------------
# Trazas de TET


def _numero(texto: str) -> float | None:
    try:
        return float(texto.replace(",", "."))
    except (ValueError, AttributeError):
        return None


def leer_csv_tet(ruta: Path) -> tuple[list[str], list[dict[str, str]]]:
    """CSV de TET: viene con BOM y CRLF, separado por comas y con punto decimal."""
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        lector = csv.DictReader(f)
        return list(lector.fieldnames or []), list(lector)


def _tiempos(filas: Sequence[dict[str, str]]) -> tuple[str, str]:
    """Qué columna de tiempo usar: la de LSL si está llena, si no la del video."""
    con_lsl = any(_numero(f.get("tiempo_lsl_s", "")) is not None for f in filas)
    return ("tiempo_lsl_s", "lsl") if con_lsl else ("tiempo_video_s", "video")


def trazas_anchas(filas: Sequence[dict[str, str]], t0: float,
                  avisar) -> tuple[list[str], list[dict[str, Any]], str]:
    """Pasa las filas del CSV de 10 Hz (una por dimensión y tiempo) a una tabla ancha.

    Sale `onset` y una columna por dimensión, que es lo que pide el análisis (agrupar por
    instante las 8 dimensiones). Si las dimensiones no comparten la misma rejilla de tiempos,
    las que falten quedan en n/a.
    """
    col_t, origen = _tiempos(filas)
    dimensiones: list[str] = []
    por_tiempo: dict[float, dict[str, Any]] = {}
    saltadas = 0
    for f in filas:
        t = _numero(f.get(col_t, ""))
        valor = _numero(f.get("valor", ""))
        dim = columna(f.get("dimension", ""))
        if t is None or valor is None or not dim:
            saltadas += 1
            continue
        if dim not in dimensiones:
            dimensiones.append(dim)
        onset = round(t - t0, 4)
        por_tiempo.setdefault(onset, {"onset": f"{onset:.4f}"})[dim] = f"{valor:.4f}"
    if saltadas:
        avisar(f"{saltadas} filas del CSV de trazas sin tiempo o sin valor: no se convierten.")
    filas_anchas = [por_tiempo[k] for k in sorted(por_tiempo)]
    return ["onset", *dimensiones], filas_anchas, origen


def eventos_tet(filas: Sequence[dict[str, str]], t0: float, con_pasada: bool,
                extra: Sequence[str] = (),
                hasta_la_siguiente: bool = False) -> tuple[list[str], list[dict[str, Any]]]:
    """Ventanas y toques como lista de eventos: onset, duration, dimension, value.

    Con `hasta_la_siguiente`, cada fila dura hasta la siguiente de su misma dimensión, que es lo
    que son las ventanas; los toques son instantáneos y se quedan en 0.
    """
    col_t, _ = _tiempos(filas)
    salida: list[dict[str, Any]] = []
    for f in filas:
        t = _numero(f.get(col_t, ""))
        valor = _numero(f.get("valor", ""))
        if t is None or valor is None:
            continue
        fila: dict[str, Any] = {
            "onset": f"{t - t0:.4f}",
            "duration": "0",
            "dimension": columna(f.get("dimension", "")),
            "value": f"{valor:.4f}",
        }
        if con_pasada:
            fila["pass"] = f.get("pasada", "n/a")
        for c in extra:
            fila[c] = f.get(c, "n/a")
        salida.append(fila)
    salida.sort(key=lambda f: (f["dimension"], float(f["onset"])))
    if hasta_la_siguiente:
        for i, fila in enumerate(salida):
            siguiente = salida[i + 1] if i + 1 < len(salida) else None
            if siguiente is not None and siguiente["dimension"] == fila["dimension"]:
                fila["duration"] = f"{float(siguiente['onset']) - float(fila['onset']):.4f}"
    columnas = ["onset", "duration", "dimension", "value"]
    if con_pasada:
        columnas.append("pass")
    columnas.extend(extra)
    return columnas, salida


def archivos_tet(carpeta: Path) -> dict[str, Path]:
    """Los cuatro archivos que exporta TET, en `traces/` o sueltos en la carpeta de la pasada."""
    encontrados: dict[str, Path] = {}
    for base in (carpeta / "traces", carpeta):
        if not base.is_dir():
            continue
        for ruta in sorted(base.glob("TET_*")):
            if ruta.name.endswith("_10hz.csv"):
                encontrados.setdefault("10hz", ruta)
            elif ruta.name.endswith("_ventanas.csv"):
                encontrados.setdefault("ventanas", ruta)
            elif ruta.name.endswith("_toques.csv"):
                encontrados.setdefault("toques", ruta)
            elif ruta.suffix == ".json":
                encontrados.setdefault("json", ruta)
        if encontrados:
            break
    return encontrados


def convertir_tet(carpeta: Path, raiz: Path, base: str, ent: dict[str, str], t0: float,
                  log, avisar, duracion: float | None = None) -> int:
    """Pasa lo que exportó TET a derivatives/tet/. Devuelve cuántos archivos escribió."""
    fuentes = archivos_tet(carpeta)
    if not fuentes:
        avisar("No hay archivos de TET en la carpeta (ni en traces/): no se escriben derivados.")
        return 0
    destino = raiz / "derivatives" / "tet" / f"sub-{ent['sub']}" / f"ses-{ent['ses']}" / "beh"
    destino.mkdir(parents=True, exist_ok=True)
    escritos = 0

    if "10hz" in fuentes:
        _, filas = leer_csv_tet(fuentes["10hz"])
        columnas, anchas, origen = trazas_anchas(filas, t0, avisar)
        ruta = destino / f"{base}_desc-tet_timeseries.tsv"
        escribir_tsv(ruta, columnas, anchas)
        inicio = float(anchas[0]["onset"]) if anchas else 0.0
        fin = float(anchas[-1]["onset"]) if anchas else 0.0
        if duracion is not None and anchas and (inicio < -1 or fin > duracion + 1):
            avisar(
                f"Las trazas de TET van de {inicio:.1f} a {fin:.1f} s y la grabación dura "
                f"{duracion:.1f} s: no se cruzan. ¿Los archivos de TET son de esta pasada?"
            )
        escribir_json(destino / f"{base}_desc-tet_timeseries.json", {
            "Description": "Trazas de Temporal Experience Tracing: una columna por dimensión.",
            "SamplingFrequency": TET_HZ,
            "StartTime": inicio,
            "TimeSource": origen,
            "Columns": {
                "onset": {
                    "Description": "Segundos desde el inicio de la grabación de esta pasada",
                    "Units": "s",
                },
                **{c: {"Description": f"Dimensión «{c}» trazada por el participante",
                       "Units": "arbitrary", "Minimum": 0, "Maximum": 1} for c in columnas[1:]},
            },
        })
        log(f"{ruta.name}: {len(anchas)} instantes × {len(columnas) - 1} dimensiones "
            f"(tiempo de {origen}).")
        escritos += 2

    for clave, desc, con_pasada, extra, seguidas in (
        ("ventanas", "tetventanas", False, (), True),
        ("toques", "tettoques", True, ("ms_desde_inicio_sesion",), False),
    ):
        if clave not in fuentes:
            continue
        _, filas = leer_csv_tet(fuentes[clave])
        columnas, eventos = eventos_tet(filas, t0, con_pasada, extra, seguidas)
        ruta = destino / f"{base}_desc-{desc}_events.tsv"
        escribir_tsv(ruta, columnas, eventos)
        log(f"{ruta.name}: {len(eventos)} filas.")
        escritos += 1

    if "json" in fuentes:
        ruta = destino / f"{base}_desc-tet_sesion.json"
        datos = json.loads(fuentes["json"].read_text(encoding="utf-8-sig"))
        escribir_json(ruta, datos)
        log(f"{ruta.name}: sesión de TET completa (sincronización, ventana y configuración).")
        escritos += 1
    return escritos


# ---------------------------------------------------------------------------------------------
# Conversión de una pasada


def convertir_pasada(xdf: Path, raiz: Path, opciones: argparse.Namespace,
                     log=print) -> list[str]:
    """Convierte una pasada; devuelve la lista de avisos."""
    avisos: list[str] = []

    def avisar(texto: str) -> None:
        avisos.append(texto)
        log(f"[AVISO] {texto}")

    ent = entidades_de(xdf.stem)
    base = base_de(xdf.stem)
    sufijo = ent["sufijo"]
    carpeta_ses = raiz / f"sub-{ent['sub']}" / f"ses-{ent['ses']}"
    carpeta_mod = carpeta_ses / sufijo

    import pyxdf  # solo se necesita para leer el archivo

    # Las mismas opciones que xdf_a_eventos.py: pyxdf corrige los relojes y quita el jitter.
    streams, cabecera = pyxdf.load_xdf(str(xdf))
    eeg = stream_eeg(streams)
    juego = stream_marcadores(streams)
    if juego is None:
        avisar(f"El XDF no tiene el stream «{STREAM_JUEGO}»: el _events.tsv queda vacío.")
    marcadores = marcadores_de(juego) if juego is not None else []

    if sufijo == "eeg" and eeg is None:
        raise ErrorBids(
            f"{xdf.name} se llama «_eeg» pero el XDF no trae ningún stream de tipo EEG. "
            "Si esa pasada fue sin gorro, el archivo tiene que llamarse «_beh»."
        )
    if sufijo == "beh" and eeg is not None:
        avisar("El archivo se llama «_beh» pero el XDF sí trae EEG: el EEG no se convierte.")

    duracion: float | None = None
    if sufijo == "eeg" and eeg is not None:
        tiempos = np.asarray(eeg["time_stamps"], dtype=float)
        X = np.asarray(eeg["time_series"], dtype=float)
        t0 = float(tiempos[0])
        nominal, efectivo = ritmos(eeg)
        fs = efectivo if opciones.ritmo == "efectivo" else nominal
        if fs <= 0:
            fs = efectivo
            avisar(f"El stream no declara frecuencia nominal; se usa la efectiva ({fs:.3f} Hz).")
        if nominal > 0 and efectivo > 0 and abs(efectivo - nominal) / nominal > TOLERANCIA_RITMO:
            avisar(
                f"El ritmo efectivo ({efectivo:.3f} Hz) se aleja del nominal ({nominal:.0f} Hz): "
                "BrainVision supone muestras parejas, así que los eventos se irían corriendo. "
                "Revisa integridad.txt; con --ritmo efectivo se usa el medido."
            )
        canales = nombres_canales(eeg["info"])
        unidades = unidades_canales(eeg["info"], X.shape[1] if X.ndim == 2 else 0)
        inicio = fecha_xdf(cabecera, xdf)

        vhdr = carpeta_mod / f"{base}_eeg.vhdr"
        vhdr.parent.mkdir(parents=True, exist_ok=True)
        if vhdr.exists() and not opciones.sobrescribir:
            raise ErrorBids(f"Ya existe {vhdr}. Usa --sobrescribir para rehacerlo.")
        try:
            marca = datetime.fromisoformat(inicio)
        except ValueError:
            marca = None
        escribir_brainvision(vhdr, X, fs, canales, unidades, marca)
        duracion = X.shape[0] / fs
        log(f"{vhdr.name}: {X.shape[1]} canales × {X.shape[0]} muestras a {fs:.3f} Hz "
            f"({X.shape[0] / fs:.1f} s).")

        escribir_tsv(carpeta_mod / f"{base}_channels.tsv",
                     ["name", "type", "units", "sampling_frequency", "low_cutoff", "high_cutoff",
                      "status"],
                     [{"name": n, "type": "EEG", "units": u, "sampling_frequency": f"{fs:.3f}",
                       "low_cutoff": "n/a", "high_cutoff": "n/a", "status": "good"}
                      for n, u in zip(canales, unidades)])

        # El sidecar de cada pasada queda completo: lo fijo del equipo más lo medido aquí.
        sidecar: dict[str, Any] = dict(defaults_eeg(raiz))
        sidecar.update({
            "TaskName": ent["task"],
            "SamplingFrequency": round(fs, 6),
            "EEGChannelCount": len(canales),
            "RecordingDuration": round(X.shape[0] / fs, 3),
        })
        sidecar.setdefault("RecordingType", "continuous")
        sidecar.setdefault("SoftwareFilters", "n/a")
        if opciones.referencia:
            sidecar["EEGReference"] = opciones.referencia
        if opciones.fabricante or _campo(eeg["info"], "manufacturer"):
            sidecar["Manufacturer"] = opciones.fabricante or _campo(eeg["info"], "manufacturer")
        if opciones.modelo:
            sidecar["ManufacturersModelName"] = opciones.modelo
        if opciones.red_hz:
            sidecar["PowerLineFrequency"] = opciones.red_hz
        escribir_json(carpeta_mod / f"{base}_eeg.json", sidecar)
        actualizar_scans(carpeta_ses / f"sub-{ent['sub']}_ses-{ent['ses']}_scans.tsv",
                         f"{sufijo}/{vhdr.name}", inicio)
    else:
        # Pasada sin EEG: el cero es el primer marcador del juego.
        if not marcadores:
            raise ErrorBids(
                f"{xdf.name} no tiene EEG ni marcadores: no hay nada que convertir."
            )
        t0 = marcadores[0][0]
        # Sin archivo de datos no se escribe un _beh.json por pasada: sería un sidecar huérfano.
        # TaskName lo hereda del task-<task>_beh.json de la raíz.
        actualizar_scans(carpeta_ses / f"sub-{ent['sub']}_ses-{ent['ses']}_scans.tsv",
                         f"{sufijo}/{base}_events.tsv", fecha_xdf(cabecera, xdf))
        log("Pasada sin EEG: el tiempo cero es el primer marcador del juego.")

    eventos = filas_eventos(marcadores, t0)
    ruta_eventos = carpeta_mod / f"{base}_events.tsv"
    escribir_tsv(ruta_eventos, ["onset", "duration", "trial_type", "value", "marker", "source"],
                 eventos)
    syncs = sum(1 for f in eventos if f["trial_type"] == "sync")
    log(f"{ruta_eventos.name}: {len(eventos)} eventos, {syncs} de sincronización.")
    if syncs == 0:
        avisar("No hay eventos sync: sin ellos no se puede comprobar la alineación con el video.")

    if not opciones.sin_tet:
        convertir_tet(xdf.parent, raiz, base, ent, t0, log, avisar, duracion)
    return avisos


def buscar_xdf(ruta: Path) -> list[Path]:
    """Los XDF a convertir: el archivo indicado, o todos los que haya bajo esa carpeta."""
    if ruta.is_file():
        return [ruta]
    if not ruta.is_dir():
        raise ErrorBids(f"No existe {ruta}.")
    return sorted(p for p in ruta.rglob("*.xdf") if p.is_file())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Convierte las capturas de sourcedata/ en BIDS (EEG en BrainVision, "
                    "eventos en TSV y las trazas de TET en derivatives/tet).")
    p.add_argument("ruta", type=Path,
                   help="un .xdf, o una carpeta con varios debajo (por ejemplo sourcedata/)")
    p.add_argument("--bids", type=Path,
                   help="raíz del conjunto (por omisión, la carpeta que contiene a sourcedata)")
    p.add_argument("--sobrescribir", action="store_true", help="rehace lo que ya esté convertido")
    p.add_argument("--ritmo", choices=("nominal", "efectivo"), default="nominal",
                   help="frecuencia de muestreo que se escribe: la declarada o la medida")
    p.add_argument("--referencia", help="EEGReference del sidecar, p. ej. «CMS/DRL (BioSemi)»")
    p.add_argument("--fabricante", help="Manufacturer del sidecar, p. ej. BioSemi")
    p.add_argument("--modelo", help="ManufacturersModelName, p. ej. ActiveTwo")
    p.add_argument("--red-hz", type=float, default=None, dest="red_hz",
                   help="PowerLineFrequency (60 en Colombia); por omisión se hereda de la raíz")
    p.add_argument("--sin-tet", action="store_true", dest="sin_tet",
                   help="no escribir los derivados de TET")
    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    try:
        archivos = buscar_xdf(args.ruta)
        if not archivos:
            raise ErrorBids(f"No hay ningún .xdf en {args.ruta}.")
        raiz = args.bids.resolve() if args.bids else raiz_bids(archivos[0])
        if not (raiz / "dataset_description.json").exists():
            raise ErrorBids(f"{raiz} no parece la raíz de un conjunto BIDS "
                            "(no tiene dataset_description.json).")
    except ErrorBids as e:
        print(f"[ERROR] {e}")
        return 1

    print(f"Conjunto BIDS: {raiz}")
    errores = 0
    avisos = 0
    for xdf in archivos:
        print(f"\n== {xdf.name}")
        try:
            avisos += len(convertir_pasada(xdf, raiz, args))
        except ErrorBids as e:
            print(f"[ERROR] {e}")
            errores += 1
        except Exception as e:  # noqa: BLE001 - un archivo roto no debe parar el lote
            print(f"[ERROR] {xdf.name}: {type(e).__name__}: {e}")
            errores += 1

    print(f"\nResumen: {len(archivos)} pasadas, {errores} errores, {avisos} avisos.")
    print("Revisa el conjunto con:  deno run -A jsr:@bids/validator " + str(raiz))
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
