#!/usr/bin/env python3
"""Exporta el CSV de eventos que lee la app TET desde un XDF de LabRecorder (GAME-SPECS §7).

Toma el stream de marcadores del juego y escribe un CSV `tiempo,evento` con los tiempos LSL
(ya corregidos por pyxdf a un reloj común), ordenado por tiempo, con punto decimal.

Uso:
    pip install pyxdf
    python scripts/xdf_a_eventos.py sesion_P01.xdf --stream JuegoEventos -o eventos_P01.csv

Sin --stream usa el único stream de tipo Markers del archivo; si hay varios, pide elegir
(o, si no hay terminal, muestra los nombres y termina). Sin -o escribe <xdf>_eventos.csv.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

SYNC_RE = re.compile(r"^(sync|sincron)", re.IGNORECASE)


def _field(info: dict, key: str) -> str:
    """En pyxdf cada campo de `info` es una lista con un solo valor."""
    value = info.get(key, [""])
    return str(value[0] if isinstance(value, list) and value else value)


def marker_streams(streams: list[dict]) -> list[dict]:
    """Streams de marcadores: de tipo Markers o con canales de texto."""
    out = []
    for s in streams:
        info = s.get("info", {})
        if _field(info, "type").lower() == "markers" or _field(info, "channel_format").lower() == "string":
            out.append(s)
    return out


def stream_name(s: dict) -> str:
    return _field(s.get("info", {}), "name")


def pick_stream(streams: list[dict], name: str | None, ask=None) -> dict:
    """Elige el stream por nombre, el único de marcadores, o pregunta con `ask(nombres) -> índice`."""
    markers = marker_streams(streams)
    if name is not None:
        for s in streams:
            if stream_name(s) == name:
                return s
        names = ", ".join(stream_name(s) for s in streams) or "(ninguno)"
        raise SystemExit(f"No hay un stream llamado «{name}». Streams del archivo: {names}")
    if not markers:
        raise SystemExit("El archivo no tiene streams de marcadores (tipo Markers).")
    if len(markers) == 1:
        return markers[0]
    names = [stream_name(s) for s in markers]
    if ask is None:
        raise SystemExit("Hay varios streams de marcadores; elige uno con --stream: " + ", ".join(names))
    return markers[ask(names)]


def rows_from_stream(s: dict) -> list[tuple[float, str]]:
    """(tiempo, etiqueta) ordenados por tiempo. Una muestra con varios canales se une con «|»."""
    rows = []
    for t, sample in zip(s.get("time_stamps", []), s.get("time_series", [])):
        values = sample if isinstance(sample, (list, tuple)) else [sample]
        label = "|".join(str(v) for v in values).strip()
        if label:
            rows.append((float(t), label))
    rows.sort(key=lambda r: r[0])
    return rows


def write_csv(rows: list[tuple[float, str]], path: Path) -> None:
    # Sin BOM y con punto decimal; el módulo csv pone comillas si una etiqueta trae comas.
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["tiempo", "evento"])
        for t, label in rows:
            w.writerow([f"{t:.3f}", label])


def _ask_tty(names: list[str]) -> int:
    print("Hay varios streams de marcadores:")
    for i, n in enumerate(names, 1):
        print(f"  {i}. {n}")
    while True:
        answer = input("¿Cuál exportar? (número): ").strip()
        if answer.isdigit() and 1 <= int(answer) <= len(names):
            return int(answer) - 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Exporta el CSV de eventos para la app TET desde un XDF.")
    p.add_argument("xdf", type=Path, help="archivo .xdf de LabRecorder")
    p.add_argument("--stream", help="nombre del stream de marcadores del juego")
    p.add_argument("-o", "--output", type=Path, help="CSV de salida (por defecto <xdf>_eventos.csv)")
    args = p.parse_args(argv)

    try:
        import pyxdf  # solo se necesita para leer el archivo
    except ImportError:
        raise SystemExit("Falta pyxdf: instálalo con  pip install pyxdf")

    streams, _ = pyxdf.load_xdf(str(args.xdf))
    stream = pick_stream(streams, args.stream, _ask_tty if sys.stdin.isatty() else None)
    rows = rows_from_stream(stream)
    out = args.output or args.xdf.with_name(args.xdf.stem + "_eventos.csv")
    write_csv(rows, out)

    syncs = sum(1 for _, label in rows if SYNC_RE.match(label))
    print(f"{out}: {len(rows)} filas del stream «{stream_name(stream)}», {syncs} de sincronización.")
    if syncs == 0:
        print("Aviso: no hay filas sync; la app TET no podrá calcular el tiempo LSL.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
