#!/usr/bin/env python3
"""Corrige los tiempos LSL de una sesión TET ya exportada (desfase entre el video y LSL).

Caso típico (exp007): la sesión se hizo con una versión vieja de la app o sin detectar los
destellos, con `video_s` mal puesto; toda la columna `tiempo_lsl_s` queda corrida. Como
`tiempo_video_s` sí está bien, basta con rehacer la sincronización y recalcular LSL.

Uso (dentro de tet-video/):
    python scripts/corregir_tet.py ../test_files/exp007                  # detecta los destellos en el video
    python scripts/corregir_tet.py ../test_files/exp007 --recortar       # además, deja solo la partida
    python scripts/corregir_tet.py CARPETA --destellos 2.767,62.817,-,141.597   # destellos a mano (- = falta)
    python scripts/corregir_tet.py CARPETA --desfase 2.767               # solo mover video_s (un punto)

Fuentes, en la carpeta de la captura: los JSON `TET_*.json` con sus 3 CSV, las filas sync del
CSV de eventos (`*_eventos.csv`) o, si no está, del XDF; y el video, para detectar los destellos
(necesita OpenCV), salvo con --destellos o --desfase.

Qué hace, como la app (SPEC §16):
- Con 2 o más destellos, sincronización por tramos; con uno, desfase fijo (o --modelo primero).
- Recalcula `tiempo_lsl_s` de las dimensiones en los 3 CSV (la práctica sigue vacía).
- En el JSON: bloque `sincronizacion` completo, tiempos de los eventos en el video, `inicio_s` por
  dimensión y un bloque `correccion` con la sincronización original y lo que se cambió.
- Con --recortar, como la ventana de trazado (§16.8): deja solo las filas del primer al último
  destello y rehace los promedios de `_ventanas.csv` desde el nuevo inicio. Las filas conservan su
  tiempo del video: no se interpola.

Nunca toca los originales: escribe en <carpeta del JSON>/corregido/ con los mismos nombres
(CSV con BOM y CRLF, JSON sin BOM, como la app) y un `correccion.txt`.
Si la sincronización nueva difiere de la original en menos de un cuadro, no escribe nada
(salvo con --recortar o --forzar).
"""
from __future__ import annotations

import argparse
import copy
import csv
import io
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

import integridad as ig
from xdf_a_eventos import DEFAULT_STREAM, SYNC_RE, rows_from_stream, stream_name

HZ = 10
MAX_DIF_INTERVALO_S = 0.5
UN_CUADRO_S = 1 / 30
SALIDA = "corregido"


# ---------------------------------------------------------------------------------------------
# Sincronización (misma lógica que src/data/sync.ts)


def puntos_de(sinc: dict) -> list[dict]:
    """Puntos {etiqueta, video_s, lsl_s, origen} ordenados por LSL; en sesiones viejas, el único."""
    p = sinc.get("puntos") or []
    if p:
        return sorted(p, key=lambda x: x["lsl_s"])
    if sinc.get("lsl_s") is None:
        return []
    return [{"etiqueta": "sync", "video_s": sinc.get("video_s", 0), "lsl_s": sinc["lsl_s"], "origen": "manual"}]


def tramos(sinc: dict) -> list[dict] | None:
    """Puntos usables por tramos: al menos 2 y con el video y LSL creciendo a la vez."""
    if sinc.get("modelo") == "un_punto":
        return None
    p = puntos_de(sinc)
    if len(p) < 2:
        return None
    for a, b in zip(p, p[1:]):
        if not (b["video_s"] > a["video_s"] and b["lsl_s"] > a["lsl_s"]):
            return None
    return p


def _interp(x: float, xs: list[float], ys: list[float]) -> float:
    """Lineal por tramos; fuera del rango se extiende el primer o el último tramo."""
    k = 0
    while k < len(xs) - 2 and x >= xs[k + 1]:
        k += 1
    return ys[k] + (x - xs[k]) * (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k])


def video_a_lsl(t: float, sinc: dict) -> float | None:
    p = tramos(sinc)
    if p:
        return _interp(t, [x["video_s"] for x in p], [x["lsl_s"] for x in p])
    if sinc.get("lsl_s") is None:
        return None
    return sinc["lsl_s"] + (t - sinc.get("video_s", 0))


def lsl_a_video(t: float, sinc: dict) -> float:
    p = tramos(sinc)
    if p:
        return _interp(t, [x["lsl_s"] for x in p], [x["video_s"] for x in p])
    return sinc.get("video_s", 0) + (t - (sinc.get("lsl_s") or 0))


def calidad(puntos: list[dict]) -> dict:
    """Ritmo por tramo, diferencia de intervalo máxima y residuo de la recta (SPEC §16.3)."""
    p = sorted(puntos, key=lambda x: x["lsl_s"])
    if len(p) < 2:
        return {"ritmo": [], "dif_max": None, "residuo_ms": None, "orden_ok": True}
    dv = [b["video_s"] - a["video_s"] for a, b in zip(p, p[1:])]
    dl = [b["lsl_s"] - a["lsl_s"] for a, b in zip(p, p[1:])]
    V = np.array([x["video_s"] for x in p])
    L = np.array([x["lsl_s"] for x in p])
    b, a = np.polyfit(V, L, 1)
    return {
        "ritmo": [l / v if v > 0 else float("nan") for v, l in zip(dv, dl)],
        "dif_max": max(abs(v - l) for v, l in zip(dv, dl)),
        "residuo_ms": float(np.abs(L - (a + b * V)).max() * 1000),
        "orden_ok": all(v > 0 and l > 0 for v, l in zip(dv, dl)),
    }


def armar_sincronizacion(puntos: list[dict], modelo: str = "auto") -> dict:
    """Bloque `sincronizacion` del JSON (SPEC §16.6) a partir de los puntos emparejados."""
    p = sorted(puntos, key=lambda x: x["lsl_s"])
    if not p:
        raise ValueError("No hay ningún punto de sincronización.")
    q = calidad(p)
    usar_tramos = modelo != "primero" and len(p) >= 2 and q["orden_ok"]
    if usar_tramos and q["dif_max"] > MAX_DIF_INTERVALO_S:
        raise ValueError(
            f"Diferencia de intervalo de {q['dif_max']:.3f} s (máximo {MAX_DIF_INTERVALO_S} s): algún destello "
            "está mal emparejado. Revísalos con --destellos o usa --modelo primero.")
    if not usar_tramos:
        p, q = p[:1], calidad(p[:1])
    return {
        "video_s": round(p[0]["video_s"], 3),
        "lsl_s": round(p[0]["lsl_s"], 3),
        "modelo": "tramos" if usar_tramos else "un_punto",
        "puntos": [{"etiqueta": x["etiqueta"], "video_s": round(x["video_s"], 3), "lsl_s": round(x["lsl_s"], 3),
                    "origen": x["origen"]} for x in p],
        "ritmo_por_tramo": [round(r, 6) for r in q["ritmo"]],
        "dif_intervalo_max_s": None if q["dif_max"] is None else round(q["dif_max"], 3),
        "residuo_recta_max_ms": None if q["residuo_ms"] is None else round(q["residuo_ms"], 1),
    }


# ---------------------------------------------------------------------------------------------
# Fuentes


def filas_sync(carpeta: Path) -> tuple[list[tuple[float, str]], str]:
    """(tiempo LSL, etiqueta) de las filas sync, del CSV de eventos o del XDF; y de dónde salieron."""
    arch = ig.buscar_archivos(carpeta)
    for ruta in arch["eventos"]:
        with ruta.open(encoding="utf-8-sig", newline="") as f:
            filas = [(float(r["tiempo"]), r["evento"].strip()) for r in csv.DictReader(f)]
        sync = sorted((t, e) for t, e in filas if SYNC_RE.match(e))
        if sync:
            return sync, ruta.name
    for ruta in arch["xdf"]:
        try:
            import pyxdf
        except ImportError:
            raise SystemExit("Falta pyxdf para leer el XDF: pip install pyxdf")
        streams, _ = pyxdf.load_xdf(str(ruta))
        juego = next((s for s in streams if stream_name(s) == DEFAULT_STREAM), None)
        if juego is not None:
            sync = [(t, e) for t, e in rows_from_stream(juego) if SYNC_RE.match(e)]
            if sync:
                return sync, ruta.name
    return [], ""


def leer_destellos(texto: str, n: int) -> list[float | None]:
    """«2.767,62.817,-,141.597» → un valor por fila sync, en orden; «-» o vacío = no se vio."""
    partes = [x.strip() for x in texto.replace(";", ",").split(",")]
    if len(partes) != n:
        raise SystemExit(f"--destellos trae {len(partes)} valores y hay {n} filas sync.")
    return [None if x in ("", "-") else float(x) for x in partes]


def buscar_video(carpeta: Path, nombre: str | None) -> Path | None:
    videos = ig.buscar_archivos(carpeta)["video"]
    por_nombre = [v for v in videos if nombre and v.name == nombre]
    return (por_nombre or videos or [None])[0]


# ---------------------------------------------------------------------------------------------
# Archivos de la sesión


def leer_csv(ruta: Path) -> tuple[list[str], list[dict]]:
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        return list(r.fieldnames or []), list(r)


def escribir_csv(ruta: Path, columnas: list[str], filas: list[dict]) -> None:
    """Como la app: UTF-8 con BOM, CRLF y comillas solo cuando hacen falta."""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columnas, lineterminator="\r\n")
    w.writeheader()
    w.writerows(filas)
    ruta.write_bytes(("﻿" + buf.getvalue()).encode("utf-8"))


def promedios(filas: list[dict], paso: float) -> list[tuple[float, float | None]]:
    """(inicio, promedio) por ventana de `paso` s desde la primera fila, como resample() de la app."""
    vals = [float(f["valor"]) if f["valor"] != "" else float("nan") for f in filas]
    if not vals:
        return []
    t0 = float(filas[0]["tiempo_video_s"])
    dur = (len(vals) - 1) / HZ
    out = []
    k = 0
    while k * paso < dur - 1e-9:
        i0 = round(k * paso * HZ)
        i1 = min(len(vals) - 1, round((k + 1) * paso * HZ) - 1)
        tramo = [v for v in vals[i0:i1 + 1] if not np.isnan(v)]
        out.append((t0 + k * paso, sum(tramo) / len(tramo) if tramo else None))
        k += 1
    return out


def paso_ventanas(filas: list[dict]) -> float:
    """Resolución de `_ventanas.csv` (la de la sesión); 1 s si no se puede saber."""
    for a, b in zip(filas, filas[1:]):
        if a["orden"] == b["orden"]:
            return round(float(b["tiempo_video_s"]) - float(a["tiempo_video_s"]), 6)
    return 1.0


def dentro(t: float, ventana: tuple[float, float] | None) -> bool:
    return ventana is None or ventana[0] - 1e-6 <= t <= ventana[1] + 1e-6


def corregir_series(filas: list[dict], sinc: dict, ventana: tuple[float, float] | None) -> list[dict]:
    """Recalcula tiempo_lsl_s de las dimensiones (orden > 0); con ventana, deja solo sus filas."""
    out = []
    for f in filas:
        if f["orden"] == "0":
            out.append(f)
            continue
        t = float(f["tiempo_video_s"])
        if not dentro(t, ventana):
            continue
        lsl = video_a_lsl(t, sinc)
        out.append({**f, "tiempo_lsl_s": "" if lsl is None else f"{lsl:.3f}"})
    return out


def rehacer_ventanas(filas_10hz: list[dict], columnas: list[str], paso: float, sinc: dict) -> list[dict]:
    """Filas de `_ventanas.csv` desde la serie a 10 Hz ya recortada (solo dimensiones)."""
    out = []
    for orden in dict.fromkeys(f["orden"] for f in filas_10hz if f["orden"] != "0"):
        serie = [f for f in filas_10hz if f["orden"] == orden]
        base = {c: serie[0][c] for c in columnas if c not in ("tiempo_video_s", "tiempo_lsl_s", "valor")}
        for t, v in promedios(serie, paso):
            lsl = video_a_lsl(t, sinc)
            out.append({**base, "tiempo_video_s": f"{t:.3f}", "tiempo_lsl_s": "" if lsl is None else f"{lsl:.3f}",
                        "valor": "" if v is None else f"{v:.4f}"})
    return out


def corregir_json(d: dict, sinc: dict, ventana: tuple[float, float] | None, motivo: str) -> dict:
    """Copia del JSON con la sincronización nueva, eventos movidos y, si hay ventana, recortado."""
    viejo = d.get("sincronizacion") or {}
    n = copy.deepcopy(d)
    n["sincronizacion"] = sinc
    # Los eventos se guardan en tiempo del video según la sincronización vieja: se vuelven a LSL y se rehacen.
    for e in n.get("eventos") or []:
        lsl = video_a_lsl(e["t"], viejo)
        if lsl is None:
            lsl = e["t"] - viejo.get("video_s", 0)
        e["t"] = round(lsl_a_video(lsl, sinc), 3)
    off_viejo = (d.get("ventana") or {}).get("inicio_s", 0)
    for dim in n.get("dimensiones") or []:
        off = dim.get("inicio_s", off_viejo)
        dim["inicio_s"] = round(off, 3)
        if ventana is None:
            continue
        vals = dim.get("valores_10hz") or []
        idx = [i for i in range(len(vals)) if dentro(off + i / HZ, ventana)]
        if not idx:
            continue
        nuevo_off = off + idx[0] / HZ
        dim["valores_10hz"] = [vals[i] for i in idx]
        dim["inicio_s"] = round(nuevo_off, 3)
        dim["duracion_s"] = round((len(idx) - 1) / HZ, 6)
        dim["trazo_crudo"] = [p for p in dim.get("trazo_crudo") or [] if dentro(p["t"], ventana)]
        llenos = sum(v is not None for v in dim["valores_10hz"])
        dim["cobertura"] = round(llenos / len(dim["valores_10hz"]), 4)
    if ventana is not None:
        n["ventana"] = {"inicio_s": round(ventana[0], 3), "fin_s": round(ventana[1], 3)}
    else:
        n.setdefault("ventana", d.get("ventana"))
    n["correccion"] = {
        "fecha": datetime.now().astimezone().isoformat(timespec="seconds"),
        "script": "scripts/corregir_tet.py",
        "motivo": motivo,
        "sincronizacion_original": viejo,
        "recortado_a_la_partida": ventana is not None,
        "nota": "tiempo_video_s y los valores no cambian; la línea de tiempo que vio el niño no se puede corregir.",
    }
    return n


# ---------------------------------------------------------------------------------------------


def corregir_sesion(ruta_json: Path, sinc: dict, ventana_partida: tuple[float, float] | None, motivo: str,
                    salida: Path) -> list[str]:
    """Escribe la sesión corregida en `salida`; devuelve las líneas para el registro."""
    log = []
    d = json.loads(ruta_json.read_text(encoding="utf-8"))
    base = ruta_json.name[:-5]
    salida.mkdir(parents=True, exist_ok=True)

    ruta_10 = ruta_json.with_name(base + "_10hz.csv")
    filas_10 = None
    if ruta_10.exists():
        cols, filas = leer_csv(ruta_10)
        filas_10 = corregir_series(filas, sinc, ventana_partida)
        escribir_csv(salida / ruta_10.name, cols, filas_10)
        log.append(f"{ruta_10.name}: {len(filas)} → {len(filas_10)} filas.")
    ruta_v = ruta_json.with_name(base + "_ventanas.csv")
    if ruta_v.exists():
        cols, filas = leer_csv(ruta_v)
        if ventana_partida is not None and filas_10 is not None:
            nuevas = rehacer_ventanas(filas_10, cols, paso_ventanas(filas), sinc)
        else:
            nuevas = corregir_series(filas, sinc, ventana_partida)
        escribir_csv(salida / ruta_v.name, cols, nuevas)
        log.append(f"{ruta_v.name}: {len(filas)} → {len(nuevas)} filas.")
    ruta_t = ruta_json.with_name(base + "_toques.csv")
    if ruta_t.exists():
        cols, filas = leer_csv(ruta_t)
        nuevas = corregir_series(filas, sinc, ventana_partida)
        escribir_csv(salida / ruta_t.name, cols, nuevas)
        log.append(f"{ruta_t.name}: {len(filas)} → {len(nuevas)} filas.")
    nuevo = corregir_json(d, sinc, ventana_partida, motivo)
    # Sin BOM y con sangría de 1, como JSON.stringify(data, null, 1) de la app.
    (salida / ruta_json.name).write_text(json.dumps(nuevo, ensure_ascii=False, indent=1),
                                         encoding="utf-8", newline="\n")
    log.append(f"{ruta_json.name}: sincronización «{sinc['modelo']}» con {len(sinc['puntos'])} puntos.")
    return log


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Corrige los tiempos LSL de sesiones TET ya exportadas.")
    p.add_argument("carpeta", type=Path, help="carpeta de la captura (p. ej. ../test_files/exp007)")
    p.add_argument("--json", type=Path, action="append", help="corregir solo este JSON de TET (se puede repetir)")
    fuente = p.add_mutually_exclusive_group()
    fuente.add_argument("--destellos", help="segundo del video de cada destello, en el orden de las filas sync; - si falta")
    fuente.add_argument("--desfase", type=float, help="sumar estos segundos a video_s (desfase fijo, sin video)")
    p.add_argument("--modelo", choices=("auto", "primero"), default="auto",
                   help="auto: por tramos con 2 o más destellos; primero: desfase fijo con el primero")
    p.add_argument("--recortar", action="store_true", help="dejar solo las filas de la partida (primer a último destello)")
    p.add_argument("--forzar", action="store_true", help="escribir aunque la corrección sea menor de un cuadro")
    p.add_argument("-o", "--salida", type=Path, help=f"carpeta de salida (por defecto <carpeta del JSON>/{SALIDA})")
    args = p.parse_args(argv)
    # La consola de Windows no siempre es UTF-8.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    # Los ya corregidos no se vuelven a corregir.
    jsons = args.json or [j for j in ig.buscar_archivos(args.carpeta)["tet"] if SALIDA not in j.parts]
    if not jsons:
        raise SystemExit(f"No hay JSON de TET (TET_*.json) en {args.carpeta}.")
    sync, origen_sync = filas_sync(args.carpeta)

    for ruta_json in jsons:
        d = json.loads(ruta_json.read_text(encoding="utf-8"))
        viejo = d.get("sincronizacion") or {}
        log = [f"Corrección de {ruta_json.name} ({datetime.now().astimezone().isoformat(timespec='seconds')})",
               f"Sincronización original: video_s={viejo.get('video_s')}, lsl_s={viejo.get('lsl_s')}, "
               f"modelo={viejo.get('modelo', 'un_punto (versión vieja)')}."]
        fin_video = None
        if args.desfase is not None:
            if viejo.get("lsl_s") is None:
                raise SystemExit("--desfase necesita una sesión con lsl_s; usa --destellos.")
            puntos = [{"etiqueta": "sync", "video_s": viejo.get("video_s", 0) + args.desfase,
                       "lsl_s": viejo["lsl_s"], "origen": "manual"}]
            motivo = f"desfase manual de {args.desfase:+.3f} s en video_s"
            sync_lsl = [viejo["lsl_s"]]
        else:
            if not sync:
                raise SystemExit("No hay filas sync (ni en el CSV de eventos ni en el XDF): no se puede corregir.")
            sync_lsl = [t for t, _ in sync]
            log.append(f"Filas sync de {origen_sync}: " + ", ".join(f"{e}={t:.3f}" for t, e in sync))
            if args.destellos:
                V = leer_destellos(args.destellos, len(sync))
                origen, motivo = "manual", "destellos indicados a mano"
            else:
                video = buscar_video(args.carpeta, d.get("grabacion"))
                if video is None:
                    raise SystemExit("No hay video en la carpeta: da los destellos con --destellos.")
                try:
                    ts, M, _ = ig.leer_video(video)
                except ImportError:
                    raise SystemExit("Falta OpenCV: pip install opencv-python-headless (o usa --destellos).")
                det = ig.destellos(ts, M, sync_lsl)
                if det is None:
                    raise SystemExit("No se encontró el recuadro del destello en el video: usa --destellos.")
                V, origen, motivo = det["V"], "auto", f"destellos detectados en {video.name}"
                fin_video = ig.fin_video(ts)
            puntos = [{"etiqueta": e, "video_s": v, "lsl_s": t, "origen": origen}
                      for (t, e), v in zip(sync, V) if v is not None]
            faltan = [e for (_, e), v in zip(sync, V) if v is None]
            log.append("Destellos: " + ", ".join(f"{x['etiqueta']}={x['video_s']:.3f}" for x in puntos)
                       + (f"; sin destello: {', '.join(faltan)}" if faltan else ""))
        try:
            sinc = armar_sincronizacion(puntos, args.modelo)
        except ValueError as e:
            raise SystemExit(str(e))
        if sinc["modelo"] == "tramos":
            log.append(f"Por tramos: ritmo {sinc['ritmo_por_tramo']}, diferencia de intervalo máx. "
                       f"{sinc['dif_intervalo_max_s']} s, residuo de la recta {sinc['residuo_recta_max_ms']} ms.")

        # Cuánto cambia el tiempo LSL en el tramo trazado.
        dims = d.get("dimensiones") or []
        off = (d.get("ventana") or {}).get("inicio_s", 0)
        fin_trazo = max((dim.get("inicio_s", off) + (dim.get("duracion_s") or 0) for dim in dims), default=off)
        muestras = np.linspace(off, fin_trazo, 50)
        cambios = [video_a_lsl(t, sinc) - (video_a_lsl(t, viejo) or 0) for t in muestras] if viejo.get("lsl_s") is not None else []
        if cambios:
            log.append(f"Cambio de tiempo_lsl_s: de {min(cambios):+.3f} a {max(cambios):+.3f} s.")
        if fin_video is None:
            fin_video = (d.get("ventana") or {}).get("fin_s") or fin_trazo

        ventana = None
        if args.recortar:
            ini = max(0.0, lsl_a_video(min(sync_lsl), sinc))
            fin = min(lsl_a_video(max(sync_lsl), sinc), fin_video) if len(sync_lsl) >= 2 else fin_video
            ventana = (ini, ini + np.floor((fin - ini) * HZ + 1e-6) / HZ)
            log.append(f"Recorte a la partida: {ventana[0]:.3f}–{ventana[1]:.3f} s del video.")

        if cambios and max(abs(c) for c in cambios) < UN_CUADRO_S and ventana is None and not args.forzar:
            log.append("La corrección es menor de un cuadro: no hace falta. No se escribió nada (usa --forzar).")
            print("\n".join(log) + "\n")
            continue
        salida = args.salida or ruta_json.parent / SALIDA
        log += corregir_sesion(ruta_json, sinc, ventana, motivo, salida)
        if cambios and max(abs(c) for c in cambios) > 0.1:
            log.append(f"Ojo: durante la sesión, los iconos de la línea de tiempo del niño salieron corridos unos "
                       f"{abs(float(np.mean(cambios))):.1f} s respecto al video; eso no se puede corregir.")
        log.append(f"Archivos corregidos en {salida}")
        texto = "\n".join(log) + "\n"
        print(texto)
        with (salida / "correccion.txt").open("a", encoding="utf-8") as f:
            f.write(texto + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
