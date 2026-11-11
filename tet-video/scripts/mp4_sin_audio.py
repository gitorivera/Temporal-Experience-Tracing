#!/usr/bin/env python3
"""Quita la pista de audio de un MP4 sin recomprimir el video.

Las grabaciones de Meta Horizon Link (Casting_Video_*.mp4) traen como primer paquete de audio
uno de 2 bytes que Chrome no puede decodificar: el navegador deja todo el video en error y la app
TET no puede reproducirlo ni buscar los destellos. Quitar la pista de sonido lo arregla.

Solo se reescribe el índice del archivo (la caja `moov`): se borran las pistas de sonido (`trak`
con `hdlr` = `soun`) y, si el índice va antes de los datos, se corrigen los desplazamientos de los
fragmentos (`stco`/`co64`) de las pistas que quedan. Los datos (`mdat`) se copian byte a byte.

Uso (dentro de tet-video/):
    python scripts/mp4_sin_audio.py ENTRADA.mp4 SALIDA.mp4
"""
from __future__ import annotations

import argparse
import shutil
import struct
import sys
from pathlib import Path
from typing import BinaryIO, Iterator

# Cajas que contienen otras cajas, en el camino hasta hdlr y stco/co64.
CONTENEDORAS = {b"trak", b"mdia", b"minf", b"stbl"}


class ErrorMp4(Exception):
    pass


def cajas_archivo(f: BinaryIO, fin: int) -> Iterator[tuple[int, int, int, bytes]]:
    """(desplazamiento, tamaño, largo de la cabecera, tipo) de las cajas de primer nivel."""
    off = 0
    while off < fin:
        f.seek(off)
        cab = f.read(8)
        if len(cab) < 8:
            raise ErrorMp4(f"Caja truncada en el byte {off}.")
        tam, tipo = struct.unpack(">I4s", cab)
        largo = 8
        if tam == 1:
            tam = struct.unpack(">Q", f.read(8))[0]
            largo = 16
        elif tam == 0:
            tam = fin - off
        if tam < largo or off + tam > fin:
            raise ErrorMp4(f"Caja «{tipo.decode('latin1')}» con tamaño inválido en el byte {off}.")
        yield off, tam, largo, tipo
        off += tam


def cajas_bytes(buf: bytes | bytearray, ini: int, fin: int) -> Iterator[tuple[int, int, int, bytes]]:
    """Lo mismo dentro de un bloque ya leído (el moov)."""
    off = ini
    while off + 8 <= fin:
        tam, tipo = struct.unpack_from(">I4s", buf, off)
        largo = 8
        if tam == 1:
            tam = struct.unpack_from(">Q", buf, off + 8)[0]
            largo = 16
        elif tam == 0:
            tam = fin - off
        if tam < largo or off + tam > fin:
            raise ErrorMp4(f"Caja «{tipo.decode('latin1')}» con tamaño inválido dentro del índice.")
        yield off, tam, largo, tipo
        off += tam


def buscar(buf: bytes | bytearray, ini: int, fin: int, tipo: bytes) -> Iterator[tuple[int, int, int]]:
    """Cajas `tipo` dentro de [ini, fin), bajando por las contenedoras."""
    for off, tam, largo, t in cajas_bytes(buf, ini, fin):
        if t == tipo:
            yield off, tam, largo
        if t in CONTENEDORAS:
            yield from buscar(buf, off + largo, off + tam, tipo)


def tipo_de_pista(buf: bytes | bytearray, ini: int, fin: int) -> str:
    """Tipo de manejador de una trak: 'vide', 'soun', …"""
    for off, _, largo in buscar(buf, ini, fin, b"hdlr"):
        return bytes(buf[off + largo + 8:off + largo + 12]).decode("latin1")
    return "?"


def mover_fragmentos(buf: bytearray, ini: int, fin: int, delta: int) -> None:
    """Resta `delta` a los desplazamientos de stco/co64 dentro de [ini, fin)."""
    for off, _, largo in buscar(buf, ini, fin, b"stco"):
        n = struct.unpack_from(">I", buf, off + largo + 4)[0]
        for k in range(n):
            p = off + largo + 8 + 4 * k
            struct.pack_into(">I", buf, p, struct.unpack_from(">I", buf, p)[0] - delta)
    for off, _, largo in buscar(buf, ini, fin, b"co64"):
        n = struct.unpack_from(">I", buf, off + largo + 4)[0]
        for k in range(n):
            p = off + largo + 8 + 8 * k
            struct.pack_into(">Q", buf, p, struct.unpack_from(">Q", buf, p)[0] - delta)


def pistas(ruta: Path) -> list[str]:
    """Tipos de las pistas del MP4, en orden."""
    with ruta.open("rb") as f:
        fin = f.seek(0, 2)
        for off, tam, largo, tipo in cajas_archivo(f, fin):
            if tipo == b"moov":
                f.seek(off)
                buf = f.read(tam)
                return [tipo_de_pista(buf, o + l, o + t) for o, t, l, ti in cajas_bytes(buf, largo, tam) if ti == b"trak"]
    raise ErrorMp4("El archivo no tiene índice (caja moov): no es un MP4 completo.")


def quitar_audio(origen: Path, destino: Path) -> int:
    """Escribe `destino` sin las pistas de sonido. Devuelve cuántas se quitaron (0: copia idéntica)."""
    with origen.open("rb") as f:
        fin = f.seek(0, 2)
        top = list(cajas_archivo(f, fin))
        tipos = [t for _, _, _, t in top]
        if b"moof" in tipos:
            raise ErrorMp4("Es un MP4 fragmentado: este script no lo admite.")
        if tipos.count(b"moov") != 1:
            raise ErrorMp4("El archivo no tiene exactamente un índice (caja moov).")
        i_moov = tipos.index(b"moov")
        m_off, m_tam, m_largo, _ = top[i_moov]
        f.seek(m_off)
        moov = f.read(m_tam)

        hijos = list(cajas_bytes(moov, m_largo, m_tam))
        quitadas = [h for h in hijos if h[3] == b"trak" and tipo_de_pista(moov, h[0] + h[2], h[0] + h[1]) == "soun"]
        if not quitadas:
            shutil.copyfile(origen, destino)
            return 0
        if len(quitadas) == sum(1 for h in hijos if h[3] == b"trak"):
            raise ErrorMp4("El archivo solo tiene pistas de sonido.")
        cuerpo = bytearray()
        for off, tam, _, _ in hijos:
            if all(off != q[0] for q in quitadas):
                cuerpo += moov[off:off + tam]
        nuevo_tam = 8 + len(cuerpo)
        delta = m_tam - nuevo_tam
        # Si el índice va antes de los datos, los datos se corren `delta` bytes hacia atrás.
        if any(t == b"mdat" for _, _, _, t in top[i_moov + 1:]):
            mover_fragmentos(cuerpo, 0, len(cuerpo), delta)
        nuevo_moov = struct.pack(">I4s", nuevo_tam, b"moov") + bytes(cuerpo)

        parcial = destino.with_name(destino.name + ".part")
        with parcial.open("wb") as out:
            for off, tam, _, tipo in top:
                if tipo == b"moov":
                    out.write(nuevo_moov)
                    continue
                f.seek(off)
                restante = tam
                while restante > 0:
                    bloque = f.read(min(restante, 16 * 1024 * 1024))
                    if not bloque:
                        raise ErrorMp4("El archivo terminó antes de lo que dice su índice.")
                    out.write(bloque)
                    restante -= len(bloque)
        parcial.replace(destino)
        return len(quitadas)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Quita la pista de audio de un MP4 sin recomprimir el video.")
    p.add_argument("entrada", type=Path)
    p.add_argument("salida", type=Path)
    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if args.entrada.resolve() == args.salida.resolve():
        print("[ERROR] La salida debe ser otro archivo: el original se conserva.")
        return 1
    try:
        n = quitar_audio(args.entrada, args.salida)
    except ErrorMp4 as e:
        print(f"[ERROR] {e}")
        return 1
    print(f"{args.salida}: {'se quitaron ' + str(n) + ' pistas de audio' if n else 'no tenía audio; copia idéntica'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
