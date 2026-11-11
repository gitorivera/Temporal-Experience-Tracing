"""Pruebas de tablet_videos.py con un adb falso (sin tablet).

Comprueba lo que cambia frente a quest_videos.py: la carpeta del juego, los mensajes de la tablet
y la hora sacada de los nombres que usan los grabadores de Android. Lo demás (copia, reintentos,
borrado seguro) ya está probado en test_quest_videos.py, de donde salen el adb falso y las ayudas.

Uso (dentro de tet-video/):  python -m unittest discover -s scripts -p "test_*.py"
"""
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import quest_videos as qv
import tablet_videos as tv
from test_quest_videos import HOY, AdbFalso, callar, stat_linea, xdf_falso

TABLET_DEVICES = "R52RB0ABCDE\tdevice product:gta4l model:SM_X200\n"


def stat_tablet(nombre: str, tamano: int, fin: datetime, carpeta: str = tv.CARPETA_JUEGO) -> str:
    return stat_linea(nombre, tamano, fin, carpeta)


def aparato(adb: AdbFalso) -> qv.Aparato:
    return qv.Aparato(adb, tv.TABLET)


class Carpeta(unittest.TestCase):
    def test_busca_en_la_carpeta_del_juego(self):
        self.assertEqual(tv.CARPETA_JUEGO, "/sdcard/Android/data/com.UTP.ColorQuestTablet/files")
        adb = AdbFalso(devices=TABLET_DEVICES)
        aparato(adb).listar()
        cmd = next(c[1] for c in adb.llamadas if c[0] == "shell" and c[1].startswith("stat"))
        self.assertIn(f"{tv.CARPETA_JUEGO}/*.mp4", cmd)
        self.assertIn(f"{tv.CARPETA_JUEGO}/*/*.mp4", cmd)
        # No debe mirar las carpetas del visor.
        self.assertNotIn("Oculus", cmd)

    def test_lee_los_videos_de_la_carpeta_del_juego(self):
        nombre = "ColorQuest_2026-11-11_15-04-46.mp4"
        adb = AdbFalso(devices=TABLET_DEVICES, stat=stat_tablet(nombre, 500, HOY + timedelta(minutes=3)))
        videos = aparato(adb).listar()
        self.assertEqual([v.ruta for v in videos], [f"{tv.CARPETA_JUEGO}/{nombre}"])


class HoraDelNombre(unittest.TestCase):
    def test_nombres_de_android(self):
        esperado = datetime(2026, 11, 11, 15, 4, 46).astimezone()
        for nombre in ("ColorQuest_2026-11-11_15-04-46.mp4", "ColorQuest_20261111_150446.mp4",
                       "grabacion-20261111-150446.mp4", "2026-11-11T15.04.46.mp4"):
            with self.subTest(nombre=nombre):
                self.assertEqual(qv.inicio_desde_nombre(nombre), esperado)

    def test_sin_hora_en_el_nombre(self):
        self.assertIsNone(qv.inicio_desde_nombre("partida.mp4"))
        self.assertIsNone(qv.inicio_desde_nombre("ColorQuest_2026-13-45_99-99-99.mp4"))

    def test_el_nombre_en_utc_se_pasa_a_la_hora_del_archivo(self):
        # Caso real: screen_JITO_20261111_203424.mp4 con el archivo modificado a las 15:41 locales
        # (Colombia, UTC-5): el nombre va en UTC, así que el video empezó a las 15:34 locales.
        fin = datetime(2026, 11, 11, 15, 41, 26).astimezone()
        v = qv.leer_stat(stat_tablet("screen_JITO_20261111_203424.mp4", 32_000_000, fin))[0]
        self.assertEqual(v.inicio, datetime(2026, 11, 11, 15, 34, 24).astimezone())
        self.assertEqual(v.tramo(), (v.inicio, fin))

    def test_un_nombre_que_no_cuadra_deja_solo_el_final(self):
        fin = datetime(2026, 11, 11, 15, 41, 26).astimezone()
        v = qv.leer_stat(stat_tablet("ColorQuest_20200101_000000.mp4", 10, fin))[0]
        self.assertIsNone(v.inicio)
        self.assertEqual(v.tramo(), (fin, fin))


class Mensajes(unittest.TestCase):
    def test_dicen_tablet_y_no_visor(self):
        for devices, texto in [("", "No hay ninguna tablet"), ("A\tunauthorized\n", "La tablet no autorizó"),
                               ("A\toffline\n", "La tablet está en estado «offline»")]:
            with self.assertRaises(qv.ErrorAparato) as e:
                aparato(AdbFalso(devices=devices)).comprobar()
            self.assertIn(texto, str(e.exception))
            self.assertNotIn("visor", str(e.exception))

    def test_estado_y_listar(self):
        adb = AdbFalso(devices=TABLET_DEVICES, stat=stat_tablet("ColorQuest_20261111_150446.mp4", 500, HOY))
        code, out = callar(tv.main, ["estado"], run=adb)
        self.assertEqual(code, 0)
        self.assertIn("La tablet está conectada y autorizada (serie R52RB0ABCDE)", out)
        self.assertIn("1 videos en la tablet", out)
        code, out = callar(tv.main, ["listar"], run=adb)
        self.assertIn(tv.CARPETA_JUEGO, out)

    def test_sin_tablet_sale_con_error(self):
        code, out = callar(tv.main, ["estado"], run=AdbFalso(devices=""))
        self.assertEqual(code, 1)
        self.assertIn("[ERROR] No hay ninguna tablet", out)
        self.assertIn("Opciones de desarrollador", out)

    def test_sin_videos_nombra_la_carpeta_del_juego(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(qv.ErrorAparato) as e:
                qv.resolver_video(aparato(AdbFalso(devices=TABLET_DEVICES)), Path(d), None, False)
            self.assertIn("No hay videos en la tablet", str(e.exception))
            self.assertIn(tv.PAQUETE, str(e.exception))


class Ndjson(unittest.TestCase):
    """El NDJSON del juego queda en la misma carpeta que el video, en la tablet."""

    def test_patron_en_la_carpeta_del_juego(self):
        self.assertEqual(tv.TABLET.datos, (f"{tv.CARPETA_JUEGO}/*.ndjson",))

    def test_trae_el_de_la_captura_y_no_los_otros(self):
        # Caso real del 11 de noviembre: el video empieza a las 15:34 (nombre 20:34 UTC) y el
        # NDJSON a las 15:38:54 (nombre 20:38:54 UTC); los dos terminan a las 15:41.
        fin = datetime(2026, 11, 11, 15, 41, 26).astimezone()
        lineas = [
            stat_tablet("screen_JITO_20261111_203424.mp4", 32_030_888, fin),
            stat_tablet("events_JITO_20261111_203854.ndjson", 183_695, fin),
            stat_tablet("events_JITO_20261111_201319.ndjson", 152_496,
                        datetime(2026, 11, 11, 15, 15, 0).astimezone()),
        ]
        adb = AdbFalso(devices=TABLET_DEVICES, stat="\n".join(lineas))
        q = aparato(adb)
        with tempfile.TemporaryDirectory() as d:
            carpeta = Path(d)
            video = q.listar()[0]
            self.assertEqual(video.nombre, "screen_JITO_20261111_203424.mp4")
            copiados, _ = callar(q.copiar_datos, qv.tramo_captura(carpeta, video), carpeta)
            self.assertEqual([p.name for p in copiados], ["events_JITO_20261111_203854.ndjson"])
            self.assertEqual(copiados[0].stat().st_size, 183_695)


class CopiaYBorrado(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.nombre = f"screen_JITO_{HOY:%Y%m%d_%H%M%S}.mp4"
        self.adb = AdbFalso(devices=TABLET_DEVICES,
                            stat=stat_tablet(self.nombre, 2000, HOY + timedelta(minutes=3)))

    def tearDown(self):
        self.tmp.cleanup()

    def test_elige_por_el_xdf_y_copia_a_original(self):
        xdf_falso(self.dir, HOY - timedelta(seconds=6), HOY + timedelta(minutes=4))
        q = aparato(self.adb)
        video, _ = callar(qv.resolver_video, q, self.dir, None, False)
        self.assertEqual(video.nombre, self.nombre)
        local, _ = callar(q.copiar, video, self.dir)
        self.assertEqual(local, self.dir / qv.ORIGINAL / self.nombre)
        self.assertEqual(local.stat().st_size, 2000)

    def test_borra_de_la_tablet_solo_con_copia_y_confirmacion(self):
        q = aparato(self.adb)
        with self.assertRaises(qv.ErrorAparato) as e:
            qv.cmd_borrar(q, self.nombre, True, [self.dir])
        self.assertIn("no se borra de la tablet", str(e.exception))
        callar(q.copiar, q.listar()[0], self.dir)
        with self.assertRaises(qv.ErrorAparato) as e:
            qv.cmd_borrar(q, self.nombre, False, [self.dir])
        self.assertIn("--confirmar", str(e.exception))
        self.assertEqual(self.adb.borrados, [])
        _, out = callar(qv.cmd_borrar, q, self.nombre, True, [self.dir])
        self.assertEqual(self.adb.borrados, [f"{tv.CARPETA_JUEGO}/{self.nombre}"])
        self.assertIn("borrado de la tablet", out)


if __name__ == "__main__":
    unittest.main()
