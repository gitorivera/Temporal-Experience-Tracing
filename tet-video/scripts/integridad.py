#!/usr/bin/env python3
"""Revisa la integridad de una captura: XDF de LabRecorder (EEG y marcadores), video de la Quest y archivos TET.

Uso (dentro de tet-video/):
    pip install pyxdf numpy opencv-python-headless
    python scripts/integridad.py ../test_files/exp007

Busca en la carpeta: un .xdf, un video (.mp4, .webm, .mov, .mkv), el CSV de eventos (*_eventos.csv)
y los JSON de TET (en la carpeta o en traces/). Lo que falte se salta con un aviso; sin OpenCV
no se revisa el video. Imprime el informe y lo guarda en <carpeta>/integridad.txt.

Cada línea lleva una marca: [OK], [AVISO] (revisar) o [ERROR] (el dato no sirve así).
Termina con código 1 si hubo algún error.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from xdf_a_eventos import DEFAULT_STREAM, SYNC_RE, rows_from_stream, stream_name

VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}
# Rango de entrada del OpenBCI Cyton con ganancia 24: ±187,5 mV.
RANGO_CYTON_UV = 187500.0
BANDAS = {"delta": (1, 4), "theta": (4, 8), "alfa": (8, 13), "beta": (13, 30), "gamma": (30, 45)}


class Informe:
    """Líneas del informe con su marca; cuenta los errores y avisos."""

    def __init__(self) -> None:
        self.lineas: list[str] = []
        self.errores = 0
        self.avisos = 0

    def titulo(self, texto: str) -> None:
        self.lineas += ["", f"== {texto} =="]

    def ok(self, texto: str) -> None:
        self.lineas.append(f"[OK]    {texto}")

    def aviso(self, texto: str) -> None:
        self.avisos += 1
        self.lineas.append(f"[AVISO] {texto}")

    def error(self, texto: str) -> None:
        self.errores += 1
        self.lineas.append(f"[ERROR] {texto}")

    def info(self, texto: str) -> None:
        self.lineas.append(f"        {texto}")

    def texto(self) -> str:
        resumen = f"Resumen: {self.errores} errores, {self.avisos} avisos."
        return "\n".join(self.lineas + ["", resumen]) + "\n"


def fmt(x: float, dec: int = 3) -> str:
    """Número con coma decimal, como el resto de los textos para el investigador."""
    return f"{x:.{dec}f}".replace(".", ",")


# ---------------------------------------------------------------------------------------------
# Archivos de la carpeta


def buscar_archivos(carpeta: Path) -> dict:
    todos = [p for p in carpeta.rglob("*") if p.is_file()]
    xdf = sorted(p for p in todos if p.suffix.lower() == ".xdf")
    videos = sorted(p for p in todos if p.suffix.lower() in VIDEO_EXT)
    eventos = sorted(p for p in todos if p.name.lower().endswith("_eventos.csv"))
    tet = sorted(p for p in todos if p.suffix.lower() == ".json" and p.name.startswith("TET_"))
    return {"xdf": xdf, "video": videos, "eventos": eventos, "tet": tet}


# ---------------------------------------------------------------------------------------------
# Marcadores


def tipo_evento(label: str) -> str:
    """Primera palabra de la etiqueta («acierto objetivo 3» → acierto, «sync_2» → sync)."""
    return re.split(r"[\s_|,]", label.strip(), maxsplit=1)[0].lower()


def revisar_marcadores(rows: list[tuple[float, str]], inf: Informe) -> list[float]:
    """Revisa el stream del juego; devuelve los tiempos LSL de las filas sync, en orden."""
    if not rows:
        inf.error("El stream de marcadores está vacío.")
        return []
    sync = [t for t, label in rows if SYNC_RE.match(label)]
    tipos = Counter(tipo_evento(label) for _, label in rows)
    inf.ok(f"{len(rows)} marcadores: " + ", ".join(f"{n} {k}" for k, n in tipos.most_common()))
    dur = rows[-1][0] - rows[0][0]
    inf.info(f"Partida de {fmt(dur, 1)} s (del primer al último marcador).")
    if len(sync) == 0:
        inf.error("No hay filas sync: no se puede sincronizar el video con LSL.")
    elif len(sync) == 1:
        inf.aviso("Solo hay una fila sync: no se puede medir la deriva del video.")
    else:
        inf.ok(f"{len(sync)} filas sync; intervalos (s): " + "; ".join(fmt(d) for d in np.diff(sync)))
    return sync


def comparar_con_colorquest(rows: list[tuple[float, str]], otros: list[tuple[float, str]], inf: Informe) -> None:
    """Compara inicio y fin de JuegoEventos con session_start / session_end de ColorQuestMarkers."""
    ini = [t for t, label in otros if "session_start" in label]
    fin = [t for t, label in otros if "session_end" in label]
    if not ini or not fin:
        return
    d_ini = abs(ini[0] - rows[0][0]) * 1000
    d_fin = abs(fin[-1] - rows[-1][0]) * 1000
    if max(d_ini, d_fin) <= 50:
        inf.ok(f"Coincide con ColorQuestMarkers (inicio a {fmt(d_ini, 0)} ms, fin a {fmt(d_fin, 0)} ms).")
    else:
        inf.aviso(f"ColorQuestMarkers difiere: inicio a {fmt(d_ini, 0)} ms, fin a {fmt(d_fin, 0)} ms.")


def comparar_con_csv(rows: list[tuple[float, str]], ruta: Path, inf: Informe) -> None:
    """El CSV de eventos debe tener las mismas filas que el XDF (es lo que se carga en TET)."""
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        filas = [(float(r["tiempo"]), r["evento"]) for r in csv.DictReader(f)]
    if not filas or len(filas) != len(rows):
        inf.aviso(f"{ruta.name}: {len(filas)} filas; el XDF tiene {len(rows)}. ¿Es de otra captura?")
        return
    dif = max(abs(a[0] - b[0]) for a, b in zip(filas, rows))
    iguales = all(a[1] == b[1] for a, b in zip(filas, rows))
    if dif <= 0.002 and iguales:
        inf.ok(f"{ruta.name} coincide con el XDF ({len(filas)} filas).")
    else:
        inf.aviso(f"{ruta.name} no coincide con el XDF (diferencia máx. {fmt(dif * 1000, 0)} ms).")


# ---------------------------------------------------------------------------------------------
# EEG


def filtrar_fft(x: np.ndarray, fs: float, lo: float, hi: float) -> np.ndarray:
    """Pasa-banda ideal por FFT (sin desfase), por columnas. Basta para medir; no es para análisis."""
    # Sin la tendencia lineal, para que la deriva lenta no se cuele por los bordes de la FFT.
    k = np.arange(len(x))[:, None]
    coef = np.polyfit(k[:, 0], x, 1)
    x = x - (k * coef[0] + coef[1])
    F = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / fs)
    F[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(F, n=len(x), axis=0)


def welch(x: np.ndarray, fs: float, nper: int) -> tuple[np.ndarray, np.ndarray]:
    """Densidad espectral por Welch (Hann, 50 % de traslape), por columnas."""
    w = np.hanning(nper)
    segs = [x[i:i + nper] - x[i:i + nper].mean(axis=0) for i in range(0, len(x) - nper + 1, nper // 2)]
    P = np.mean([np.abs(np.fft.rfft(s * w[:, None], axis=0)) ** 2 for s in segs], axis=0)
    P /= fs * (w ** 2).sum()
    P[1:-1] *= 2
    return np.fft.rfftfreq(nper, 1 / fs), P


def potencia(f: np.ndarray, P: np.ndarray, lo: float, hi: float) -> np.ndarray:
    m = (f >= lo) & (f < hi)
    return P[m].sum(axis=0) * (f[1] - f[0])


def metricas_eeg(X: np.ndarray, fs: float, red_hz: float = 60.0, rango_uv: float = RANGO_CYTON_UV,
                 tramo: np.ndarray | None = None) -> dict:
    """Métricas por canal de EEG en µV (muestras × canales).

    Se filtra la grabación entera y se mide solo en `tramo` (máscara de muestras), para que
    los bordes del recorte no ensucien las métricas.
    """
    hp = filtrar_fft(X, fs, 1, fs / 2)
    banda = filtrar_fft(X, fs, 1, 40)
    red_todo = filtrar_fft(X, fs, red_hz - 1, red_hz + 1) if fs / 2 > red_hz + 1 else None
    if tramo is not None:
        X, hp, banda = X[tramo], hp[tramo], banda[tramo]
        red_todo = None if red_todo is None else red_todo[tramo]
    n, nch = X.shape
    nper = int(min(4 * fs, n))
    f, P = welch(hp, fs, nper)
    total = potencia(f, P, 1, 45)
    total = np.where(total > 0, total, np.nan)
    partes = {k: potencia(f, P, lo, hi) / total for k, (lo, hi) in BANDAS.items()}
    red = red_todo.std(axis=0) if red_todo is not None else np.full(nch, np.nan)
    w = int(fs)
    nv = n // w
    pp = np.array([np.ptp(banda[i * w:(i + 1) * w], axis=0) for i in range(nv)]) if nv else np.zeros((0, nch))
    # Un canal plano da NaN en la correlación; nansum lo deja fuera.
    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.corrcoef(hp.T) if nch > 1 else np.ones((1, 1))
        corr_crudo = np.corrcoef((X - X.mean(axis=0)).T) if nch > 1 else np.ones((1, 1))
    fuera = lambda C: (np.nansum(C) - np.trace(C)) / max(nch * (nch - 1), 1)
    return {
        "dc": X.mean(axis=0),
        "rms": hp.std(axis=0),
        "saturadas": (np.abs(X) >= 0.95 * rango_uv).mean(axis=0),
        "repetidas": (np.diff(X, axis=0) == 0).mean(axis=0),
        "red_rms": red,
        "partes": partes,
        "ventanas_malas": (pp > 100).mean(axis=0) if nv else np.zeros(nch),
        "corr_media": fuera(corr),
        "corr_crudo": fuera(corr_crudo),
    }


def huecos(t: np.ndarray, fs: float) -> list[tuple[float, float]]:
    """(inicio, duración) de los saltos de más de 3 muestras entre tiempos consecutivos."""
    d = np.diff(t)
    return [(float(t[i]), float(d[i])) for i in np.where(d > 3 / fs)[0]]


def revisar_eeg(t: np.ndarray, t_crudo: np.ndarray, X: np.ndarray, fs_nom: float, nombres: list[str],
                sync: list[float], inf: Informe, red_hz: float = 60.0) -> None:
    n, nch = X.shape
    tramo = None
    dur = t[-1] - t[0]
    fs_ef = (n - 1) / dur if dur > 0 else float("nan")
    inf.info(f"{nch} canales, {n} muestras, {fmt(dur, 1)} s, nominal {fmt(fs_nom, 0)} Hz.")
    if abs(fs_ef / fs_nom - 1) <= 0.01:
        inf.ok(f"Ritmo efectivo {fmt(fs_ef)} Hz (usar los tiempos LSL, no contar muestras).")
    else:
        inf.aviso(f"Ritmo efectivo {fmt(fs_ef)} Hz, lejos del nominal: ¿muestras perdidas?")
    hs = huecos(t, fs_nom)
    if hs:
        inf.error(f"{len(hs)} huecos en el EEG; el mayor de {fmt(max(h[1] for h in hs))} s en t={fmt(hs[0][0])}.")
    else:
        inf.ok("Sin huecos.")
    if len(t_crudo) > 2:
        k = np.arange(len(t_crudo))
        res = t_crudo - np.polyval(np.polyfit(k, t_crudo, 1), k)
        inf.info(f"Jitter de los tiempos crudos: {fmt(res.std() * 1000, 1)} ms (máx. {fmt(np.abs(res).max() * 1000, 1)} ms); pyxdf lo corrige.")
    if len(sync) >= 1:
        antes, despues = sync[0] - t[0], t[-1] - sync[-1]
        if antes >= 0 and despues >= 0:
            inf.ok(f"Cubre la partida: empieza {fmt(antes, 1)} s antes del primer sync y termina {fmt(despues, 1)} s después del último.")
        else:
            inf.error(f"No cubre la partida (margen antes {fmt(antes, 1)} s, después {fmt(despues, 1)} s).")
        m = (t >= sync[0]) & (t <= sync[-1]) if len(sync) > 1 else np.ones(n, bool)
        if m.sum() > 2 * fs_nom:
            tramo = m
            inf.info("Las métricas de señal son del tramo de la partida (primer a último sync).")
    if not nombres or all(not s for s in nombres):
        inf.aviso("El XDF no trae los nombres de los canales (ponlos en OpenBCI GUI).")
        nombres = [f"ch{i + 1}" for i in range(nch)]
    else:
        inf.ok("Canales: " + ", ".join(nombres))

    m = metricas_eeg(X, fs_nom, red_hz, tramo=tramo)
    if m["corr_crudo"] > 0.98:
        inf.error(f"Todos los canales se mueven igual en crudo (correlación {fmt(m['corr_crudo'], 3)}): parece que no hay electrodos o la referencia está suelta.")
    inf.info("canal   DC mV   RMS µV  red µV  >100µV  delta theta alfa beta gamma")
    for i, nombre in enumerate(nombres):
        p = {k: m["partes"][k][i] * 100 for k in BANDAS}
        inf.info(f"{nombre:<7}{m['dc'][i] / 1000:7.1f}{m['rms'][i]:9.1f}{m['red_rms'][i]:8.1f}{m['ventanas_malas'][i] * 100:7.0f}%"
                 f"  {p['delta']:4.0f}% {p['theta']:4.0f}% {p['alfa']:3.0f}% {p['beta']:3.0f}% {p['gamma']:4.0f}%")
    # Cada problema en una línea con los canales que lo tienen.
    grupos: dict[str, list[str]] = {}
    graves: set[str] = set()

    def anotar(motivo: str, canal: str, grave: bool = False) -> None:
        grupos.setdefault(motivo, []).append(canal)
        if grave:
            graves.add(motivo)

    for i, nombre in enumerate(nombres):
        if m["saturadas"][i] > 0.001:
            # Pegado al borde del rango: lo demás que se mida en ese canal no significa nada.
            anotar("saturado (más del 0,1 % de las muestras en el borde del rango)", nombre, True)
            continue
        if m["rms"][i] < 1 or m["repetidas"][i] > 0.05:
            anotar("plano: sin señal", nombre, True)
        elif m["rms"][i] > 50:
            anotar("RMS mayor de 50 µV", nombre)
        if m["ventanas_malas"][i] > 0.2:
            anotar("más del 20 % de las ventanas de 1 s pasan de 100 µV", nombre)
        if m["partes"]["beta"][i] + m["partes"]["gamma"][i] > 0.4:
            anotar("beta+gamma mayor del 40 % (músculo o mal contacto)", nombre)
        if m["partes"]["delta"][i] > 0.6:
            anotar("delta mayor del 60 % (movimiento u ojos)", nombre)
    for motivo, canales in grupos.items():
        (inf.error if motivo in graves else inf.aviso)(f"{', '.join(canales)}: {motivo}.")
    if not grupos:
        inf.ok("Ningún canal saturado, plano ni con exceso de artefactos.")
    red_max = np.nanmax(m["red_rms"])
    if red_max > 5:
        inf.aviso(f"Ruido de red de {fmt(red_hz, 0)} Hz de hasta {fmt(red_max, 1)} µV RMS: revisar tierra (BIAS), referencia y cargadores; el análisis necesita notch.")
    else:
        inf.ok(f"Ruido de red de {fmt(red_hz, 0)} Hz bajo (máx. {fmt(red_max, 1)} µV RMS).")
    if m["corr_media"] > 0.6 and m["corr_crudo"] <= 0.98:
        inf.aviso(f"Correlación media entre canales de {fmt(m['corr_media'], 2)} (filtrado): ruido común o movimiento.")


# ---------------------------------------------------------------------------------------------
# Video y destellos


def rachas(on: np.ndarray, min_len: int = 1, max_len: int | None = None) -> list[tuple[int, int]]:
    """(inicio, fin inclusive) de las rachas de True con largo entre min_len y max_len."""
    out = []
    padded = np.concatenate([[False], on, [False]])
    d = np.diff(padded.astype(int))
    for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
        if b - a >= min_len and (max_len is None or b - a <= max_len):
            out.append((int(a), int(b - 1)))
    return out


def emparejar(V: list[float], L: list[float]) -> list[float | None]:
    """Para cada sync L, el destello V que le corresponde (o None).

    Como en la app (fase 10): cada par (destello, sync) propone un desfase; gana el que empareja
    más syncs, con tolerancia de 0,5 s + 0,5 % de la distancia al ancla.
    """
    mejor: list[float | None] = [None] * len(L)
    mejor_n, mejor_err = 0, float("inf")
    V_arr = np.asarray(V, float)
    if len(V_arr) == 0:
        return mejor
    for v0 in V:
        for l0 in L:
            par: list[float | None] = []
            err = 0.0
            for l in L:
                esperado = v0 + (l - l0)
                k = int(np.argmin(np.abs(V_arr - esperado)))
                e = abs(V_arr[k] - esperado)
                if e <= 0.5 + 0.005 * abs(l - l0):
                    par.append(float(V_arr[k]))
                    err += e
                else:
                    par.append(None)
            n = sum(p is not None for p in par)
            if n > mejor_n or (n == mejor_n and err < mejor_err):
                mejor, mejor_n, mejor_err = par, n, err
    return mejor


def ubicar_recuadro(ts: np.ndarray, M: np.ndarray, sync: list[float], umbral: float = 0.8) -> tuple[int, int, int, int] | None:
    """Celdas de la cuadrícula (filas y0..y1, columnas x0..x1) donde está el destello.

    `M` es la fracción de píxeles blancos por celda y cuadro. Cada celda cuyos encendidos
    (rachas de 3 a 25 cuadros) emparejan con casi todos los sync vota por su desfase; gana el
    desfase con más celdas, y el recuadro es el rectángulo que las contiene.
    """
    necesarios = max(2, len(sync) - 1)
    votos: dict[float, list[tuple[int, int]]] = {}
    for y in range(M.shape[1]):
        for x in range(M.shape[2]):
            ons = [ts[a] for a, _ in rachas(M[:, y, x] > umbral, 3, 25)]
            if len(ons) < necesarios or len(ons) > 50 * len(sync):
                continue
            par = emparejar(ons, sync)
            pares = [(v, l) for v, l in zip(par, sync) if v is not None]
            if len(pares) >= necesarios:
                desfase = round(float(np.median([v - l for v, l in pares])), 1)
                votos.setdefault(desfase, []).append((y, x))
    if not votos:
        return None
    celdas = max(votos.values(), key=len)
    ys = [c[0] for c in celdas]
    xs = [c[1] for c in celdas]
    return min(ys), max(ys), min(xs), max(xs)


def fin_video(ts: np.ndarray) -> float:
    """Final del último cuadro: su inicio más la duración típica de un cuadro."""
    return float(ts[-1] + np.median(np.diff(ts))) if len(ts) > 1 else float(ts[-1])


def destellos(ts: np.ndarray, M: np.ndarray, sync: list[float]) -> dict | None:
    """Ubica el recuadro y devuelve el destello de cada sync (`V`, None si falta); None sin recuadro."""
    caja = ubicar_recuadro(ts, M, sync)
    if caja is None:
        return None
    y0, y1, x0, x1 = caja
    blanco = M[:, y0:y1 + 1, x0:x1 + 1].mean(axis=(1, 2))
    # 0,75 para no partir un destello cuando un texto encima lo deja en el borde del 80 %.
    rs = rachas(blanco >= 0.75, 3, 30)
    V_todos = [float(ts[a]) for a, _ in rs]
    return {"caja": caja, "blanco": blanco, "rachas": rs, "V_todos": V_todos, "V": emparejar(V_todos, sync)}


def leer_video(ruta: Path, bloque: int = 16):
    """Tiempos de cada cuadro y fracción de blancos (>220) por celda de bloque×bloque píxeles."""
    import cv2

    cap = cv2.VideoCapture(str(ruta))
    if not cap.isOpened():
        raise OSError("OpenCV no pudo abrir el video")
    ts, M = [], []
    tam = None
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        ts.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000)
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        H, W = g.shape
        tam = (W, H)
        h, w = H // bloque * bloque, W // bloque * bloque
        M.append((g[:h, :w] > 220).reshape(h // bloque, bloque, w // bloque, bloque).mean(axis=(1, 3)).astype(np.float32))
    cap.release()
    return np.array(ts), np.array(M), tam


def revisar_video(ruta: Path, sync: list[float], inf: Informe) -> dict | None:
    """Devuelve {'V': destello por sync o None, 'fin': último cuadro} para revisar TET."""
    try:
        import cv2  # noqa: F401
    except ImportError:
        inf.aviso("Sin OpenCV no se revisa el video: pip install opencv-python-headless")
        return None
    try:
        ts, M, tam = leer_video(ruta)
    except OSError as e:
        inf.error(f"{ruta.name}: {e}.")
        return None
    if len(ts) < 2:
        inf.error(f"{ruta.name}: no tiene cuadros legibles.")
        return None
    d = np.diff(ts)
    fps = (len(ts) - 1) / (ts[-1] - ts[0])
    inf.info(f"{tam[0]}×{tam[1]}, {len(ts)} cuadros, {fmt(ts[-1], 3)} s, {fmt(fps, 2)} cuadros/s efectivos.")
    largos = int((d > 2.5 / fps).sum())
    if largos:
        inf.aviso(f"{largos} saltos de más de 2,5 cuadros; el mayor de {fmt(d.max() * 1000, 0)} ms.")
    else:
        inf.ok(f"Sin cuadros perdidos (el intervalo mayor es de {fmt(d.max() * 1000, 0)} ms).")
    if not sync:
        inf.aviso("Sin filas sync no se buscan los destellos.")
        return {"V": [], "fin": fin_video(ts)}
    det = destellos(ts, M, sync)
    if det is None:
        inf.error("No se encontró el recuadro del destello (ninguna zona se enciende al ritmo de los sync).")
        return {"V": [None] * len(sync), "fin": fin_video(ts)}
    y0, y1, x0, x1 = det["caja"]
    b = 16
    inf.ok(f"Recuadro del destello en x {x0 * b}–{(x1 + 1) * b}, y {y0 * b}–{(y1 + 1) * b} px.")
    blanco, rs, V_todos, V = det["blanco"], det["rachas"], det["V_todos"], det["V"]
    for k, (v, l) in enumerate(zip(V, sync), 1):
        if v is None:
            inf.error(f"sync {k} (LSL {fmt(l)}): no se encontró su destello.")
            continue
        a, e = next(r for r in rs if ts[r[0]] == v)
        pico = blanco[a:e + 1].max()
        texto = f"sync {k}: destello en V={fmt(v)} s, {e - a + 1} cuadros, blanco máx. {fmt(pico * 100, 0)} %"
        if pico < 0.85:
            inf.aviso(texto + " (algo tapa el recuadro: ¿texto del juego encima?).")
        else:
            inf.ok(texto + ".")
    extra = len(V_todos) - sum(v is not None for v in V)
    if extra:
        inf.aviso(f"{extra} destellos de más en el recuadro, sin sync que les corresponda.")
    pares = [(v, l) for v, l in zip(V, sync) if v is not None]
    if len(pares) >= 2:
        Vp = np.array([p[0] for p in pares])
        Lp = np.array([p[1] for p in pares])
        dif = (np.diff(Vp) - np.diff(Lp)) * 1000
        pend = np.polyfit(Lp, Vp, 1)
        res = np.abs(Vp - np.polyval(pend, Lp)).max() * 1000
        texto = (f"Diferencias de intervalo video−LSL: " + "; ".join(fmt(x, 0) for x in dif)
                 + f" ms; ritmo {fmt(pend[0], 5)}; residuo de la recta {fmt(res, 1)} ms")
        if np.abs(dif).max() > 500:
            inf.error(texto + ". Más de 0,5 s: la app no acepta la sincronización por tramos.")
        elif np.abs(dif).max() > 100 or res > 100:
            inf.aviso(texto + ". Hay deriva o saltos: usar la sincronización por tramos.")
        else:
            inf.ok(texto + ".")
    return {"V": V, "fin": fin_video(ts)}


# ---------------------------------------------------------------------------------------------
# TET


def revisar_tet(ruta: Path, sync: list[float], video: dict | None, inf: Informe) -> None:
    d = json.loads(ruta.read_text(encoding="utf-8"))
    inf.info(f"{d.get('participante')} · {d.get('condicion')} · {d.get('inicio')} · video «{d.get('grabacion')}» · app {d.get('version_app')}")
    base = ruta.name[:-5]
    faltan = [s for s in ("_10hz.csv", "_ventanas.csv", "_toques.csv") if not (ruta.parent / (base + s)).exists()]
    if faltan:
        inf.aviso("Faltan los CSV: " + ", ".join(base + s for s in faltan))
    else:
        inf.ok("Están los 3 CSV y el JSON.")
    if "ventana" not in d:
        inf.aviso("El JSON no trae «ventana»: la sesión se hizo con una versión vieja de la app (actualízala en ese equipo).")
    sinc = d.get("sincronizacion") or {}
    if "modelo" in sinc:
        inf.info(f"Sincronización: {sinc.get('modelo')}, {len(sinc.get('puntos') or [])} puntos.")
    vs, ls = sinc.get("video_s"), sinc.get("lsl_s")
    if vs is None or ls is None:
        inf.aviso("La sesión no tiene sincronización: tiempo_lsl_s queda vacío.")
    elif video and video.get("V") and sync:
        k = int(np.argmin([abs(l - ls) for l in sync]))
        v_det = video["V"][k]
        if abs(sync[k] - ls) > 0.01:
            inf.aviso(f"lsl_s={fmt(ls)} no coincide con ninguna fila sync del XDF.")
        elif v_det is None:
            inf.aviso("No se detectó el destello del sync que usa TET; no se puede comprobar el desfase.")
        else:
            desfase = v_det - vs
            if abs(desfase) <= 0.05:
                inf.ok(f"El destello que usa TET coincide con el detectado (diferencia {fmt(abs(desfase) * 1000, 0)} ms).")
            else:
                inf.error(f"TET usó video_s={fmt(vs)}, pero el destello está en {fmt(v_det)}: tiempo_lsl_s está corrido "
                          f"{fmt(desfase)} s. Corrección: lsl = {fmt(ls)} + (tiempo_video_s − {fmt(v_det)}).")
    ventana = d.get("ventana")
    if ventana and video and video.get("V") and all(v is not None for v in video["V"][:1] + video["V"][-1:]):
        v1, vn = video["V"][0], video["V"][-1]
        if abs(ventana["inicio_s"] - v1) > 0.1 or abs(ventana["fin_s"] - vn) > 0.2:
            inf.aviso(f"Ventana de trazado {fmt(ventana['inicio_s'])}–{fmt(ventana['fin_s'])} s; los destellos van de {fmt(v1)} a {fmt(vn)} s.")
        else:
            inf.ok(f"Ventana de trazado {fmt(ventana['inicio_s'])}–{fmt(ventana['fin_s'])} s, de destello a destello.")
    practica = d.get("practica")
    if practica and practica.get("correlacion_con_velocidad") is not None:
        r = practica["correlacion_con_velocidad"]
        (inf.ok if r >= 0.5 else inf.aviso)(f"Práctica: correlación con la velocidad {fmt(r, 2)}.")
    dims = d.get("dimensiones") or []
    if not dims:
        inf.error("El JSON no tiene dimensiones trazadas.")
    for dim in dims:
        cob = dim.get("cobertura") or 0
        texto = (f"{dim.get('dimension')}: {fmt(dim.get('duracion_s') or 0, 1)} s, cobertura {fmt(cob, 2)}, "
                 f"{dim.get('pasadas')} pasadas, {dim.get('saltos_video')} saltos de video")
        (inf.ok if cob >= 0.95 else inf.aviso)(texto + ".")


# ---------------------------------------------------------------------------------------------


def nombres_canales(info: dict) -> list[str]:
    try:
        return [str(c["label"][0]) for c in info["desc"][0]["channels"][0]["channel"]]
    except (KeyError, IndexError, TypeError):
        return []


def revisar_carpeta(carpeta: Path, red_hz: float = 60.0) -> Informe:
    inf = Informe()
    inf.lineas.append(f"Integridad de la captura: {carpeta.resolve()}")
    arch = buscar_archivos(carpeta)
    for clave, nombre in (("xdf", "XDF"), ("video", "video"), ("eventos", "CSV de eventos"), ("tet", "JSON de TET")):
        if not arch[clave]:
            inf.aviso(f"No hay {nombre} en la carpeta.")
        elif len(arch[clave]) > 1 and clave in ("xdf", "video"):
            inf.aviso(f"Hay {len(arch[clave])} archivos de {nombre}; se usa {arch[clave][0].name}.")

    sync: list[float] = []
    rows: list[tuple[float, str]] = []
    if arch["xdf"]:
        ruta = arch["xdf"][0]
        try:
            import pyxdf
        except ImportError:
            raise SystemExit("Falta pyxdf: instálalo con  pip install pyxdf")
        streams, _ = pyxdf.load_xdf(str(ruta))
        crudos, _ = pyxdf.load_xdf(str(ruta), dejitter_timestamps=False)
        inf.titulo(f"XDF: {ruta.name}")
        for s in streams:
            info = s["info"]
            inf.info(f"Stream «{stream_name(s)}» ({info['type'][0]}, {info['channel_count'][0]} canales, "
                     f"{fmt(float(info['nominal_srate'][0]), 0)} Hz, {len(s['time_stamps'])} muestras)")

        inf.titulo(f"Marcadores ({DEFAULT_STREAM})")
        juego = next((s for s in streams if stream_name(s) == DEFAULT_STREAM), None)
        if juego is None:
            inf.error(f"No hay stream «{DEFAULT_STREAM}».")
        else:
            rows = rows_from_stream(juego)
            sync = revisar_marcadores(rows, inf)
            otro = next((s for s in streams if stream_name(s) == "ColorQuestMarkers"), None)
            if otro is not None and rows:
                comparar_con_colorquest(rows, rows_from_stream(otro), inf)
            for csv_ev in arch["eventos"] if rows else []:
                comparar_con_csv(rows, csv_ev, inf)

        eegs = [s for s in streams if s["info"]["type"][0].upper() == "EEG"]
        if not eegs:
            inf.titulo("EEG")
            inf.error("El XDF no tiene ningún stream de tipo EEG.")
        for s in eegs:
            inf.titulo(f"EEG: {stream_name(s)}")
            crudo = next((c for c in crudos if stream_name(c) == stream_name(s)), s)
            X = np.asarray(s["time_series"], float)
            if len(X) < 10:
                inf.error("El stream EEG está vacío.")
                continue
            revisar_eeg(np.asarray(s["time_stamps"]), np.asarray(crudo["time_stamps"]), X,
                        float(s["info"]["nominal_srate"][0]), nombres_canales(s["info"]), sync, inf, red_hz)

    video = None
    if arch["video"]:
        inf.titulo(f"Video: {arch['video'][0].name}")
        video = revisar_video(arch["video"][0], sync, inf)

    for ruta in arch["tet"]:
        inf.titulo(f"TET: {ruta.relative_to(carpeta).as_posix()}")
        revisar_tet(ruta, sync, video, inf)
    return inf


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Revisa la integridad de una captura (XDF, video y TET).")
    p.add_argument("carpeta", type=Path, help="carpeta de la captura (p. ej. ../test_files/exp007)")
    p.add_argument("--red", type=float, default=60.0, help="frecuencia de la red eléctrica en Hz (por defecto 60)")
    p.add_argument("--sin-archivo", action="store_true", help="no guardar integridad.txt")
    args = p.parse_args(argv)
    if not args.carpeta.is_dir():
        raise SystemExit(f"No existe la carpeta {args.carpeta}")
    inf = revisar_carpeta(args.carpeta, args.red)
    texto = inf.texto()
    # La consola de Windows no siempre es UTF-8.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(texto, end="")
    if not args.sin_archivo:
        salida = args.carpeta / "integridad.txt"
        salida.write_text(texto, encoding="utf-8")
        print(f"Guardado en {salida}")
    return 1 if inf.errores else 0


if __name__ == "__main__":
    sys.exit(main())
