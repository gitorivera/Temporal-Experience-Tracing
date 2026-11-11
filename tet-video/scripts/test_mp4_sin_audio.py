"""Pruebas de mp4_sin_audio.py con MP4 sintéticos (solo la estructura de cajas, sin códecs).

Uso (dentro de tet-video/):  python -m unittest discover -s scripts -p "test_*.py"
"""
import struct
import tempfile
import unittest
from pathlib import Path

import mp4_sin_audio as m


def caja(tipo: bytes, *hijos: bytes) -> bytes:
    cuerpo = b"".join(hijos)
    return struct.pack(">I4s", 8 + len(cuerpo), tipo) + cuerpo


def hdlr(tipo: bytes) -> bytes:
    return caja(b"hdlr", b"\x00" * 8 + tipo + b"\x00" * 12)


def stco(offsets: list[int]) -> bytes:
    return caja(b"stco", b"\x00" * 4 + struct.pack(">I", len(offsets)) + b"".join(struct.pack(">I", o) for o in offsets))


def co64(offsets: list[int]) -> bytes:
    return caja(b"co64", b"\x00" * 4 + struct.pack(">I", len(offsets)) + b"".join(struct.pack(">Q", o) for o in offsets))


def trak(tipo: bytes, tabla: bytes) -> bytes:
    return caja(b"trak", caja(b"tkhd", b"\x00" * 20), caja(b"mdia", hdlr(tipo), caja(b"minf", caja(b"stbl", tabla))))


VIDEO = b"V" * 100
AUDIO = b"A" * 40


def armar(moov_al_final: bool, tabla=stco) -> tuple[bytes, int]:
    """MP4 con un mdat (video y luego audio) y un moov con una pista de cada tipo."""
    ftyp = caja(b"ftyp", b"isom\x00\x00\x02\x00")

    def moov(base: int) -> bytes:
        return caja(b"moov", caja(b"mvhd", b"\x00" * 20), trak(b"vide", tabla([base])), trak(b"soun", tabla([base + len(VIDEO)])))

    if moov_al_final:
        base = len(ftyp) + 8
        return ftyp + caja(b"mdat", VIDEO + AUDIO) + moov(base), base
    tam_moov = len(moov(0))
    base = len(ftyp) + tam_moov + 8
    return ftyp + moov(base) + caja(b"mdat", VIDEO + AUDIO), base


def offsets_de_video(ruta: Path) -> list[int]:
    datos = ruta.read_bytes()
    with ruta.open("rb") as f:
        moov = next((o, t, l) for o, t, l, ti in m.cajas_archivo(f, len(datos)) if ti == b"moov")
    buf = datos[moov[0]:moov[0] + moov[1]]
    out = []
    for o, t, l, ti in m.cajas_bytes(buf, moov[2], moov[1]):
        if ti == b"trak":
            for so, _, sl in m.buscar(buf, o + l, o + t, b"stco"):
                out.append(struct.unpack_from(">I", buf, so + sl + 8)[0])
            for so, _, sl in m.buscar(buf, o + l, o + t, b"co64"):
                out.append(struct.unpack_from(">Q", buf, so + sl + 8)[0])
    return out


class SinAudio(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def probar(self, moov_al_final: bool, tabla=stco):
        datos, base = armar(moov_al_final, tabla)
        origen, destino = self.dir / "o.mp4", self.dir / "d.mp4"
        origen.write_bytes(datos)
        self.assertEqual(m.pistas(origen), ["vide", "soun"])
        self.assertEqual(m.quitar_audio(origen, destino), 1)
        self.assertEqual(m.pistas(destino), ["vide"])
        salida = destino.read_bytes()
        # El desplazamiento de la pista de video apunta a sus datos, que no cambiaron.
        (off,) = offsets_de_video(destino)
        self.assertEqual(salida[off:off + len(VIDEO)], VIDEO)
        self.assertIn(VIDEO + AUDIO, salida)
        self.assertFalse((self.dir / "d.mp4.part").exists())
        return base, off

    def test_indice_al_final_no_mueve_los_datos(self):
        base, off = self.probar(True)
        self.assertEqual(off, base)

    def test_indice_al_principio_corrige_los_desplazamientos(self):
        base, off = self.probar(False)
        self.assertLess(off, base)

    def test_co64(self):
        self.probar(True, co64)
        self.probar(False, co64)

    def test_sin_audio_copia_identica(self):
        ftyp = caja(b"ftyp", b"isom")
        datos = ftyp + caja(b"mdat", VIDEO) + caja(b"moov", trak(b"vide", stco([len(ftyp) + 8])))
        origen, destino = self.dir / "o.mp4", self.dir / "d.mp4"
        origen.write_bytes(datos)
        self.assertEqual(m.quitar_audio(origen, destino), 0)
        self.assertEqual(destino.read_bytes(), datos)

    def test_archivo_truncado(self):
        datos, _ = armar(True)
        origen = self.dir / "o.mp4"
        origen.write_bytes(datos[:-10])
        with self.assertRaises(m.ErrorMp4):
            m.quitar_audio(origen, self.dir / "d.mp4")


if __name__ == "__main__":
    unittest.main()
