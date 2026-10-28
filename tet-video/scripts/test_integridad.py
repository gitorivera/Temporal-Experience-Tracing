"""Pruebas de integridad.py con señales y videos sintéticos (sin pyxdf ni OpenCV).

Uso (dentro de tet-video/):  python -m unittest discover -s scripts -p "test_*.py"
"""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

import integridad as ig

FS = 250.0
SYNC = [1000.0, 1060.0, 1120.0, 1135.5]


def eeg(segundos=40, seed=0):
    """8 canales: ruido de 10 µV con DC distinto por canal, como un Cyton con electrodos."""
    rng = np.random.default_rng(seed)
    n = int(segundos * FS)
    return rng.normal(0, 10, (n, 8)) + np.arange(8) * 5000.0


class Emparejar(unittest.TestCase):
    def test_todos(self):
        V = [s - 997.2 for s in SYNC]
        self.assertEqual(ig.emparejar(V, SYNC), V)

    def test_destello_perdido_no_corre_a_los_demas(self):
        V = [s - 997.2 for s in SYNC]
        par = ig.emparejar([V[0], V[2], V[3]], SYNC)
        self.assertEqual(par, [V[0], None, V[2], V[3]])

    def test_destello_de_mas_se_ignora(self):
        V = [s - 997.2 for s in SYNC]
        par = ig.emparejar([5.0] + V + [100.0], SYNC)
        self.assertEqual(par, V)

    def test_sin_destellos(self):
        self.assertEqual(ig.emparejar([], SYNC), [None] * 4)


class Rachas(unittest.TestCase):
    def test_largos(self):
        on = np.array([0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1], bool)
        self.assertEqual(ig.rachas(on, 3), [(1, 3), (7, 10)])
        self.assertEqual(ig.rachas(on, 1, 3), [(1, 3), (5, 5)])


class Recuadro(unittest.TestCase):
    def test_encuentra_la_zona_que_se_enciende_al_ritmo_de_los_sync(self):
        fps = 30.0
        ts = np.arange(0, 145, 1 / fps)
        M = np.zeros((len(ts), 6, 8), np.float32)
        for s in SYNC:
            v = s - 997.233
            M[(ts >= v) & (ts < v + 0.3), 1:3, 4:6] = 1.0
        # Ruido: una celda que parpadea cada 7 s, sin relación con los sync.
        for v in np.arange(1, 140, 7.0):
            M[(ts >= v) & (ts < v + 0.2), 5, 0] = 1.0
        self.assertEqual(ig.ubicar_recuadro(ts, M, SYNC), (1, 2, 4, 5))

    def test_sin_destellos(self):
        ts = np.arange(0, 10, 1 / 30)
        self.assertIsNone(ig.ubicar_recuadro(ts, np.zeros((len(ts), 4, 4)), SYNC))


class MetricasEeg(unittest.TestCase):
    def test_alfa_y_red(self):
        X = eeg()
        t = np.arange(len(X)) / FS
        X[:, 0] += 30 * np.sin(2 * np.pi * 10 * t)
        X[:, 1] += 20 * np.sin(2 * np.pi * 60 * t)
        m = ig.metricas_eeg(X, FS)
        self.assertGreater(m["partes"]["alfa"][0], 0.5)
        self.assertAlmostEqual(m["red_rms"][1], 20 / np.sqrt(2), delta=1.5)
        self.assertLess(m["red_rms"][0], 2)
        self.assertAlmostEqual(m["dc"][3] / 1000, 15, delta=0.1)
        self.assertLess(abs(m["corr_media"]), 0.1)

    def test_saturado_y_plano(self):
        X = eeg()
        X[:1000, 2] = ig.RANGO_CYTON_UV
        X[:, 5] = 123.0
        m = ig.metricas_eeg(X, FS)
        self.assertAlmostEqual(m["saturadas"][2], 0.1)
        self.assertLess(m["rms"][5], 1)

    def test_sin_electrodos_todos_iguales(self):
        X = eeg()
        X += np.cumsum(np.random.default_rng(1).normal(0, 50, len(X)))[:, None]
        self.assertGreater(ig.metricas_eeg(X, FS)["corr_crudo"], 0.98)

    def test_huecos(self):
        t = np.arange(1000) / FS
        t[500:] += 0.5
        self.assertEqual(len(ig.huecos(t, FS)), 1)


class RevisarEeg(unittest.TestCase):
    def test_no_cubre_la_partida_es_error(self):
        X = eeg(20)
        t = 990 + np.arange(len(X)) / FS
        inf = ig.Informe()
        ig.revisar_eeg(t, t, X, FS, [], SYNC, inf)
        self.assertTrue(any("No cubre la partida" in l for l in inf.lineas))
        self.assertTrue(any("nombres de los canales" in l for l in inf.lineas))

    def test_buena(self):
        X = eeg(160)
        t = 990 + np.arange(len(X)) / FS
        inf = ig.Informe()
        ig.revisar_eeg(t, t, X, FS, [f"C{i}" for i in range(8)], SYNC, inf)
        self.assertEqual(inf.errores, 0, inf.texto())


class Marcadores(unittest.TestCase):
    def test_sync_y_tipos(self):
        rows = [(1000.0, "sync_1"), (1000.0, "inicio partida"), (1010.0, "acierto objetivo 3"), (1060.0, "sync_2")]
        inf = ig.Informe()
        self.assertEqual(ig.revisar_marcadores(rows, inf), [1000.0, 1060.0])
        self.assertEqual(inf.errores, 0)

    def test_sin_sync_es_error(self):
        inf = ig.Informe()
        ig.revisar_marcadores([(1.0, "acierto")], inf)
        self.assertEqual(inf.errores, 1)

    def test_csv_de_eventos(self):
        rows = [(1000.0, "sync_1"), (1001.5, "acierto, objetivo 3")]
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "x_eventos.csv"
            ruta.write_text('tiempo,evento\n1000.000,sync_1\n1001.500,"acierto, objetivo 3"\n', encoding="utf-8")
            inf = ig.Informe()
            ig.comparar_con_csv(rows, ruta, inf)
            self.assertIn("[OK]", inf.lineas[0])
            inf = ig.Informe()
            ig.comparar_con_csv(rows[:1], ruta, inf)
            self.assertIn("[AVISO]", inf.lineas[0])


class Tet(unittest.TestCase):
    def sesion(self, d, **extra):
        data = {
            "participante": "P1", "condicion": "RM", "version_app": "1.0.0",
            "sincronizacion": {"video_s": 0, "lsl_s": SYNC[0]},
            "dimensiones": [{"dimension": "Diversión", "duracion_s": 140, "cobertura": 1, "pasadas": 1, "saltos_video": 0}],
        }
        data.update(extra)
        ruta = Path(d) / "TET_P1.json"
        ruta.write_text(json.dumps(data), encoding="utf-8")
        for s in ("_10hz.csv", "_ventanas.csv", "_toques.csv"):
            (Path(d) / ("TET_P1" + s)).write_text("", encoding="utf-8")
        return ruta

    def test_desfase_del_primer_destello_es_error(self):
        with tempfile.TemporaryDirectory() as d:
            inf = ig.Informe()
            ig.revisar_tet(self.sesion(d), SYNC, {"V": [2.767, 62.8, 122.8, 138.3], "fin": 148.0}, inf)
            self.assertEqual(inf.errores, 1)
            self.assertTrue(any("corrido 2,767 s" in l for l in inf.lineas))
            self.assertTrue(any("versión vieja" in l for l in inf.lineas))

    def test_sesion_sincronizada(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = self.sesion(d, sincronizacion={"video_s": 2.767, "lsl_s": SYNC[0], "modelo": "tramos", "puntos": []},
                               ventana={"inicio_s": 2.767, "fin_s": 138.3})
            inf = ig.Informe()
            ig.revisar_tet(ruta, SYNC, {"V": [2.767, 62.8, 122.8, 138.3], "fin": 148.0}, inf)
            self.assertEqual((inf.errores, inf.avisos), (0, 0), inf.texto())


if __name__ == "__main__":
    unittest.main()
