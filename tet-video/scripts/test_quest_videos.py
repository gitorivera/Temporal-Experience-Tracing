"""Pruebas de quest_videos.py con un adb falso (sin visor).

Uso (dentro de tet-video/):  python -m unittest discover -s scripts -p "test_*.py"
"""
import contextlib
import io
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath

import quest_videos as qv

HOY = datetime(2026, 10, 28, 17, 0, 0).astimezone()
MS = int(HOY.timestamp() * 1000)
# Carpeta de datos del juego en el visor, donde deja el NDJSON de eventos.
NDJSON_QUEST = "/sdcard/Android/data/com.UTP.ColorQuest/files"


def stat_linea(nombre: str, tamano: int, fin: datetime, carpeta="/sdcard/Documents") -> str:
    return f"{tamano} {int(fin.timestamp())} {carpeta}/{nombre}"


def stat_ndjson(nombre: str, tamano: int, fin: datetime, carpeta=NDJSON_QUEST) -> str:
    return stat_linea(nombre, tamano, fin, carpeta)


class AdbFalso:
    """Responde como adb: dispositivos, stat (solo lo que casa con los patrones), pull y rm."""

    def __init__(self, devices="2G0YC5ZF8H0BZ9\tdevice product:eureka model:Quest_3\n", stat="", fallos_pull=0, bytes_pull=None):
        self.devices = devices
        self.stat = stat
        self.fallos_pull = fallos_pull
        self.bytes_pull = bytes_pull
        self.llamadas = []
        self.borrados = []

    @staticmethod
    def casa(linea: str, patrones: list[str]) -> bool:
        """Como el glob del shell: la ruta de la línea tiene que casar con algún patrón."""
        partes = linea.split(" ", 2)
        if len(partes) < 3 or not partes[2].startswith("/"):
            return False
        return any(PurePosixPath(partes[2]).match(p) for p in patrones)

    def __call__(self, args):
        self.llamadas.append(args)
        if args[0] == "devices":
            return 0, "List of devices attached\n" + self.devices
        if args[0] == "shell" and args[1].startswith("stat"):
            patrones = [p for p in args[1].split() if p.startswith("/")]
            vivos = [l for l in self.stat.splitlines()
                     if not any(b in l for b in self.borrados) and self.casa(l, patrones)]
            return 0, "\n".join(vivos)
        if args[0] == "shell" and args[1].startswith("df"):
            return 0, "/dev/fuse 448G 109G 339G 25% /storage/emulated"
        if args[0] == "shell" and args[1].startswith("rm"):
            self.borrados.append(args[1].split("'")[1])
            return 0, ""
        if args[0] == "pull":
            remoto, local = args[1], Path(args[2])
            tam = int(next(l for l in self.stat.splitlines() if l.endswith(remoto)).split()[0])
            if self.fallos_pull > 0:
                self.fallos_pull -= 1
                local.write_bytes(b"x" * (tam // 2))
                return 1, "adb: error: connection reset"
            local.write_bytes(b"x" * (self.bytes_pull if self.bytes_pull is not None else tam))
            return 0, "1 file pulled"
        return 1, "orden desconocida"


def xdf_falso(carpeta: Path, inicio: datetime, fin: datetime) -> Path:
    ruta = carpeta / "block_Default.xdf"
    ruta.write_bytes(b"XDF:\x00<?xml version=\"1.0\"?><info><version>1.0</version><datetime>"
                     + inicio.strftime("%Y-%m-%dT%H:%M:%S%z").encode() + b"</datetime></info>")
    os.utime(ruta, (fin.timestamp(), fin.timestamp()))
    return ruta


def callar(f, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        r = f(*a, **k)
    return r, out.getvalue()


class Lectura(unittest.TestCase):
    def test_dispositivos(self):
        self.assertEqual(qv.leer_dispositivos("List of devices attached\nABC\tdevice usb:1\nXYZ\tunauthorized\n\n"),
                         [("ABC", "device"), ("XYZ", "unauthorized")])
        self.assertEqual(qv.leer_dispositivos("* daemon started successfully\nList of devices attached\n"), [])

    def test_hora_desde_el_nombre(self):
        self.assertEqual(qv.inicio_desde_nombre(f"Casting_Video_{MS}.mp4"), HOY)
        self.assertEqual(qv.inicio_desde_nombre("com.oculus.vrshell-20261028-170000-0.mp4"), HOY)
        self.assertIsNone(qv.inicio_desde_nombre("video.mp4"))

    def test_stat(self):
        texto = "\n".join([
            stat_linea(f"Casting_Video_{MS}.mp4", 339_000_000, HOY + timedelta(minutes=3)),
            "stat: '/sdcard/Oculus/VideoShots/*.mp4': No such file or directory",
            stat_linea("com.oculus.vrshell-20250821-180118-0.mp4", 10, datetime(2025, 8, 21, 18, 2).astimezone(), "/sdcard/Oculus/VideoShots"),
        ])
        v = qv.leer_stat(texto)
        self.assertEqual([x.nombre for x in v], [f"Casting_Video_{MS}.mp4", "com.oculus.vrshell-20250821-180118-0.mp4"])
        self.assertEqual(v[0].tramo(), (HOY, HOY + timedelta(minutes=3)))

    def test_cabecera_del_xdf(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = xdf_falso(Path(d), HOY, HOY + timedelta(minutes=4))
            ini, fin = qv.intervalo_xdf(ruta)
            self.assertEqual(ini, HOY)
            self.assertAlmostEqual(fin.timestamp(), (HOY + timedelta(minutes=4)).timestamp(), places=0)

    def test_aviso_de_versiones(self):
        self.assertIsNotNone(qv.aviso_version("adb server version (41) doesn't match this client (39); killing..."))
        self.assertIsNone(qv.aviso_version("List of devices attached"))


class Eleccion(unittest.TestCase):
    def video(self, inicio, minutos, nombre=None):
        return qv.ArchivoRemoto(f"/sdcard/Documents/{nombre or 'v'}.mp4", 1, inicio + timedelta(minutes=minutos), inicio)

    def test_el_que_se_cruza(self):
        a = self.video(HOY - timedelta(hours=1), 3, "viejo")
        b = self.video(HOY + timedelta(seconds=6), 3.5, "partida")
        c = self.video(HOY + timedelta(minutes=5), 0.1, "prueba")
        v, avisos = qv.elegir_video([a, b, c], (HOY, HOY + timedelta(minutes=4)))
        self.assertIs(v, b)
        self.assertEqual(avisos, [])

    def test_dos_candidatos_avisa(self):
        a = self.video(HOY, 2, "uno")
        b = self.video(HOY + timedelta(minutes=2), 2, "dos")
        v, avisos = qv.elegir_video([a, b], (HOY, HOY + timedelta(minutes=4)))
        self.assertIn(v, (a, b))
        self.assertEqual(len(avisos), 1)

    def test_ninguno_cerca(self):
        a = self.video(HOY - timedelta(days=1), 3)
        v, _ = qv.elegir_video([a], (HOY, HOY + timedelta(minutes=4)))
        self.assertIsNone(v)

    def test_el_mas_cercano_si_no_se_cruzan(self):
        a = self.video(HOY + timedelta(minutes=6), 1)
        v, avisos = qv.elegir_video([a], (HOY, HOY + timedelta(minutes=4)))
        self.assertIs(v, a)
        self.assertIn("más cercano", avisos[0])


class Conexion(unittest.TestCase):
    def test_estados(self):
        for devices, texto in [("", "No hay ninguna Quest"), ("A\tunauthorized\n", "no autorizó"),
                               ("A\tdevice\nB\tdevice\n", "--serie"), ("A\toffline\n", "offline")]:
            with self.assertRaises(qv.ErrorAparato) as e:
                qv.Aparato(AdbFalso(devices=devices)).comprobar()
            self.assertIn(texto, str(e.exception))
        self.assertEqual(qv.Aparato(AdbFalso()).comprobar(), "2G0YC5ZF8H0BZ9")


class Copia(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.nombre = f"Casting_Video_{MS}.mp4"
        self.stat = stat_linea(self.nombre, 2000, HOY + timedelta(minutes=3))

    def tearDown(self):
        self.tmp.cleanup()

    def video(self, adb):
        return qv.Aparato(adb).listar()[0]

    def test_copia_completa(self):
        adb = AdbFalso(stat=self.stat)
        q = qv.Aparato(adb)
        local, _ = callar(q.copiar, self.video(adb), self.dir)
        self.assertEqual(local.stat().st_size, 2000)
        self.assertFalse(local.with_name(local.name + ".part").exists())
        # Otra vez: ya está, no se vuelve a copiar.
        n = len([c for c in adb.llamadas if c[0] == "pull"])
        callar(q.copiar, self.video(adb), self.dir)
        self.assertEqual(len([c for c in adb.llamadas if c[0] == "pull"]), n)

    def test_reintenta_si_se_corta(self):
        adb = AdbFalso(stat=self.stat, fallos_pull=2)
        local, out = callar(qv.Aparato(adb).copiar, self.video(adb), self.dir)
        self.assertEqual(local.stat().st_size, 2000)
        self.assertIn("Intento 2 de 3", out)

    def test_tamano_distinto_es_error_y_no_deja_nada(self):
        adb = AdbFalso(stat=self.stat, bytes_pull=1999)
        with self.assertRaises(qv.ErrorAparato):
            callar(qv.Aparato(adb).copiar, self.video(adb), self.dir)
        self.assertEqual(list((self.dir / qv.ORIGINAL).iterdir()), [])

    def test_no_sobrescribe_otro_archivo(self):
        (self.dir / qv.ORIGINAL).mkdir()
        (self.dir / qv.ORIGINAL / self.nombre).write_bytes(b"otro")
        adb = AdbFalso(stat=self.stat)
        with self.assertRaises(qv.ErrorAparato):
            callar(qv.Aparato(adb).copiar, self.video(adb), self.dir)
        self.assertEqual((self.dir / qv.ORIGINAL / self.nombre).read_bytes(), b"otro")

    def test_copia_va_a_original_y_mueve_la_de_antes(self):
        # Copiado con la versión anterior, junto al XDF: pasa a original/ sin volver a copiar.
        (self.dir / self.nombre).write_bytes(b"x" * 2000)
        adb = AdbFalso(stat=self.stat)
        local, out = callar(qv.Aparato(adb).copiar, self.video(adb), self.dir)
        self.assertEqual(local, self.dir / qv.ORIGINAL / self.nombre)
        self.assertFalse((self.dir / self.nombre).exists())
        self.assertEqual([c for c in adb.llamadas if c[0] == "pull"], [])

    def test_borrar_exige_copia_y_confirmacion(self):
        adb = AdbFalso(stat=self.stat)
        q = qv.Aparato(adb)
        with self.assertRaises(qv.ErrorAparato) as e:
            qv.cmd_borrar(q, self.nombre, True, [self.dir])
        self.assertIn("No hay una copia", str(e.exception))
        callar(q.copiar, self.video(adb), self.dir)
        with self.assertRaises(qv.ErrorAparato) as e:
            qv.cmd_borrar(q, self.nombre, False, [self.dir])
        self.assertIn("--confirmar", str(e.exception))
        self.assertEqual(adb.borrados, [])
        callar(qv.cmd_borrar, q, self.nombre, True, [self.dir])
        self.assertEqual(adb.borrados, [f"/sdcard/Documents/{self.nombre}"])

    def test_copiar_elige_por_el_xdf(self):
        otro = stat_linea("Casting_Video_1.mp4", 10, HOY - timedelta(days=30))
        adb = AdbFalso(stat=self.stat + "\n" + otro)
        xdf_falso(self.dir, HOY - timedelta(seconds=6), HOY + timedelta(minutes=4))
        video, _ = callar(qv.resolver_video, qv.Aparato(adb), self.dir, None, False)
        self.assertEqual(video.nombre, self.nombre)
        local, _ = callar(qv.Aparato(adb).copiar, video, self.dir)
        self.assertEqual(local.name, self.nombre)

    def test_el_ndjson_del_juego_se_trae_a_la_carpeta(self):
        # El NDJSON empieza dentro de la grabación y termina con ella.
        bueno = stat_ndjson("events_P001_20261028_220030.ndjson", 500, HOY + timedelta(minutes=3))
        viejo = stat_ndjson("events_P001_20261020_120000.ndjson", 500, HOY - timedelta(days=8))
        adb = AdbFalso(stat="\n".join([self.stat, bueno, viejo]))
        q = qv.Aparato(adb)
        v = q.listar()[0]
        # El listado de videos no debe traerse los NDJSON.
        self.assertEqual([x.nombre for x in q.listar()], [self.nombre])
        copiados, out = callar(q.copiar_datos, qv.tramo_captura(self.dir, v), self.dir)
        self.assertEqual([p.name for p in copiados], ["events_P001_20261028_220030.ndjson"])
        self.assertEqual(copiados[0].stat().st_size, 500)
        self.assertIn("Copiado events_P001_20261028_220030.ndjson", out)
        # Otra vez: ya está, no se vuelve a copiar.
        n = len([c for c in adb.llamadas if c[0] == "pull"])
        _, out = callar(q.copiar_datos, qv.tramo_captura(self.dir, v), self.dir)
        self.assertEqual(len([c for c in adb.llamadas if c[0] == "pull"]), n)
        self.assertIn("ya estaba en la carpeta", out)

    def test_un_ndjson_distinto_con_el_mismo_nombre_solo_avisa(self):
        nombre = "events_P001_20261028_220030.ndjson"
        (self.dir / nombre).write_bytes(b"otro")
        adb = AdbFalso(stat="\n".join([self.stat, stat_ndjson(nombre, 500, HOY + timedelta(minutes=3))]))
        q = qv.Aparato(adb)
        copiados, out = callar(q.copiar_datos, qv.tramo_captura(self.dir, q.listar()[0]), self.dir)
        self.assertEqual(copiados, [])
        self.assertIn("[AVISO]", out)
        self.assertEqual((self.dir / nombre).read_bytes(), b"otro")

    def test_sesion_sin_ndjson_avisa_pero_no_falla(self):
        adb = AdbFalso(stat=self.stat)
        q = qv.Aparato(adb)
        copiados, _ = callar(q.copiar_datos, qv.tramo_captura(self.dir, q.listar()[0]), self.dir)
        self.assertEqual(copiados, [])

    def test_borrar_el_video_borra_tambien_su_ndjson(self):
        ndjson = "events_P001_20261028_220030.ndjson"
        otro = "events_P001_20261020_120000.ndjson"
        adb = AdbFalso(stat="\n".join([
            self.stat,
            stat_ndjson(ndjson, 500, HOY + timedelta(minutes=3)),
            stat_ndjson(otro, 500, HOY - timedelta(days=8)),
        ]))
        q = qv.Aparato(adb)
        v = q.listar()[0]
        callar(q.copiar, v, self.dir)
        callar(q.copiar_datos, qv.tramo_captura(self.dir, v), self.dir)
        callar(qv.cmd_borrar, q, self.nombre, True, [self.dir])
        # Se fueron el video y el NDJSON de esa captura; el NDJSON viejo sigue en el visor.
        self.assertEqual(adb.borrados, [f"/sdcard/Documents/{self.nombre}", f"{NDJSON_QUEST}/{ndjson}"])
        self.assertEqual([a.nombre for a in q.listar_datos()], [otro])
        self.assertTrue((self.dir / ndjson).exists())

    def test_no_borra_un_ndjson_que_no_esta_copiado(self):
        ndjson = "events_P001_20261028_220030.ndjson"
        adb = AdbFalso(stat="\n".join([self.stat, stat_ndjson(ndjson, 500, HOY + timedelta(minutes=3))]))
        q = qv.Aparato(adb)
        callar(q.copiar, q.listar()[0], self.dir)
        _, out = callar(qv.cmd_borrar, q, self.nombre, True, [self.dir])
        self.assertEqual(adb.borrados, [f"/sdcard/Documents/{self.nombre}"])
        self.assertIn("[AVISO]", out)
        self.assertIn("no está copiado en el PC", out)

    def test_main_sin_quest_sale_con_error(self):
        code, out = callar(qv.main, ["estado"], run=AdbFalso(devices=""))
        self.assertEqual(code, 1)
        self.assertIn("[ERROR] No hay ninguna Quest", out)


if __name__ == "__main__":
    unittest.main()
