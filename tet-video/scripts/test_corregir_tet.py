"""Pruebas de corregir_tet.py con una sesión sintética como la de exp007 (sin video ni pyxdf).

Uso (dentro de tet-video/):  python -m unittest discover -s scripts -p "test_*.py"
"""
import contextlib
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import corregir_tet as c

SYNC = [(1000.0, "sync_1"), (1060.0, "sync_2"), (1120.0, "sync_3"), (1135.5, "sync_4")]
DESTELLOS = [2.767, 62.8, 122.79, 138.3]
SERIE = "participante,condicion,modo,dimension,orden,tiempo_video_s,tiempo_lsl_s,valor"
TOQUES = "participante,condicion,modo,dimension,orden,pasada,tiempo_video_s,tiempo_lsl_s,valor,ms_desde_inicio_sesion"


def puntos(V=DESTELLOS):
    return [{"etiqueta": e, "video_s": v, "lsl_s": t, "origen": "manual"} for (t, e), v in zip(SYNC, V)]


def crear_sesion(d: Path, video_s=0.0, dur=145.0):
    """Sesión vieja (sin ventana ni inicio_s) con la sincronización en video_s y 1 dimensión."""
    n = int(round(dur * 10)) + 1
    valores = [round(i / (n - 1), 4) for i in range(n)]
    lsl = lambda t: f"{1000.0 + t - video_s:.3f}"
    sesion = {
        "version_app": "1.0.0", "participante": "P1", "condicion": "RM", "inicio": "2026-10-15T16:34:21.015-05:00",
        "grabacion": "v.mp4", "sincronizacion": {"video_s": video_s, "lsl_s": 1000.0},
        "eventos": [{"t": round(video_s + 10.0, 3), "label": "acierto objetivo 3", "icon": "⭐"}],
        "configuracion": {}, "practica": {"orden": 0, "dimension": "Práctica", "valores_10hz": [0.5, 0.5]},
        "dimensiones": [{"orden": 1, "dimension": "Diversión", "duracion_s": dur, "hz": 10, "valores_10hz": valores,
                         "trazo_crudo": [{"pasada": 1, "t": 1.0, "v": 0.5, "ms": 10}, {"pasada": 1, "t": 50.0, "v": 0.7, "ms": 20}],
                         "cobertura": 1, "pasadas": 1, "saltos_video": 0}],
    }
    base = d / "TET_P1_RM_2026-10-15-16-34"
    base.with_suffix(".json").write_text(json.dumps(sesion, ensure_ascii=False, indent=1), encoding="utf-8")
    pre = "P1,RM,trazo,Diversión,1"
    filas = ["P1,RM,trazo,Práctica,0,0.000,,0.5000", "P1,RM,trazo,Práctica,0,0.100,,0.5000"]
    filas += [f"{pre},{i / 10:.3f},{lsl(i / 10)},{v:.4f}" for i, v in enumerate(valores)]
    (d / (base.name + "_10hz.csv")).write_text("﻿" + "\r\n".join([SERIE] + filas) + "\r\n", encoding="utf-8")
    vent = [f"{pre},{k:.3f},{lsl(k)},0.5000" for k in range(int(dur))]
    (d / (base.name + "_ventanas.csv")).write_text("﻿" + "\r\n".join([SERIE] + vent) + "\r\n", encoding="utf-8")
    toques = [f"P1,RM,trazo,Diversión,1,1,{t:.3f},{lsl(t)},0.5000,10" for t in (1.0, 50.0)]
    (d / (base.name + "_toques.csv")).write_text("﻿" + "\r\n".join([TOQUES] + toques) + "\r\n", encoding="utf-8")
    ev = ["tiempo,evento"] + [f"{t:.3f},{e}" for t, e in SYNC] + ["1010.000,acierto objetivo 3"]
    (d / "x_eventos.csv").write_text("\n".join(ev) + "\n", encoding="utf-8")
    return base.with_suffix(".json")


def leer(ruta: Path) -> list[dict]:
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def correr(*args) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        c.main([str(a) for a in args])
    return out.getvalue()


class Sincronizacion(unittest.TestCase):
    def test_tramos_pasa_por_los_puntos_y_extiende_los_extremos(self):
        s = c.armar_sincronizacion(puntos())
        self.assertEqual(s["modelo"], "tramos")
        for (t, _), v in zip(SYNC, DESTELLOS):
            self.assertAlmostEqual(c.video_a_lsl(v, s), t, places=6)
            self.assertAlmostEqual(c.lsl_a_video(t, s), v, places=6)
        # Antes del primer destello se extiende el primer tramo.
        r = (1060 - 1000) / (62.8 - 2.767)
        self.assertAlmostEqual(c.video_a_lsl(0, s), 1000 - 2.767 * r, places=6)

    def test_un_punto(self):
        s = c.armar_sincronizacion(puntos(), "primero")
        self.assertEqual((s["modelo"], s["video_s"], len(s["puntos"])), ("un_punto", 2.767, 1))
        self.assertAlmostEqual(c.video_a_lsl(12.767, s), 1010.0)

    def test_sesion_vieja_es_un_punto(self):
        self.assertAlmostEqual(c.video_a_lsl(5.0, {"video_s": 0, "lsl_s": 1000.0}), 1005.0)
        self.assertIsNone(c.video_a_lsl(5.0, {"video_s": 0, "lsl_s": None}))

    def test_emparejamiento_errado(self):
        with self.assertRaises(ValueError):
            c.armar_sincronizacion(puntos([2.767, 63.9, 122.79, 138.3]))

    def test_leer_destellos(self):
        self.assertEqual(c.leer_destellos("2.767, -,122.79;138.3", 4), [2.767, None, 122.79, 138.3])
        with self.assertRaises(SystemExit):
            c.leer_destellos("1,2", 4)


class Series(unittest.TestCase):
    def test_promedios_como_la_app(self):
        filas = [{"tiempo_video_s": f"{2.8 + i / 10:.3f}", "valor": str(i % 10)} for i in range(21)]
        filas[3]["valor"] = ""
        out = c.promedios(filas, 1.0)
        self.assertEqual([round(t, 3) for t, _ in out], [2.8, 3.8])
        self.assertAlmostEqual(out[0][1], (0 + 1 + 2 + 4 + 5 + 6 + 7 + 8 + 9) / 9)

    def test_corregir_series(self):
        s = c.armar_sincronizacion(puntos(), "primero")
        filas = [{"orden": "0", "tiempo_video_s": "1.000", "tiempo_lsl_s": "", "valor": "1"},
                 {"orden": "1", "tiempo_video_s": "1.000", "tiempo_lsl_s": "1001.000", "valor": "1"},
                 {"orden": "1", "tiempo_video_s": "12.767", "tiempo_lsl_s": "1012.767", "valor": "1"}]
        out = c.corregir_series(filas, s, None)
        self.assertEqual([f["tiempo_lsl_s"] for f in out], ["", "998.233", "1010.000"])
        out = c.corregir_series(filas, s, (2.767, 100.0))
        self.assertEqual(len(out), 2)  # la práctica no se recorta


class Completo(unittest.TestCase):
    def test_exp007_destellos_a_mano(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            ruta = crear_sesion(d)
            antes = ruta.read_bytes()
            correr(d, "--destellos", ",".join(map(str, DESTELLOS)))
            self.assertEqual(ruta.read_bytes(), antes, "no debe tocar el original")
            sal = d / "corregido"
            self.assertTrue((sal / "correccion.txt").exists())
            filas = [f for f in leer(sal / "TET_P1_RM_2026-10-15-16-34_10hz.csv") if f["orden"] == "1"]
            fila = next(f for f in filas if f["tiempo_video_s"] == "62.800")
            self.assertEqual(fila["tiempo_lsl_s"], "1060.000")
            self.assertEqual(len(filas), 1451)
            toque = leer(sal / "TET_P1_RM_2026-10-15-16-34_toques.csv")[1]
            self.assertAlmostEqual(float(toque["tiempo_lsl_s"]), c.video_a_lsl(50.0, c.armar_sincronizacion(puntos())), places=3)
            j = json.loads((sal / ruta.name).read_text(encoding="utf-8"))
            self.assertEqual(j["sincronizacion"]["modelo"], "tramos")
            self.assertAlmostEqual(j["eventos"][0]["t"], c.lsl_a_video(1010.0, j["sincronizacion"]), places=3)
            self.assertEqual(j["dimensiones"][0]["inicio_s"], 0)
            self.assertEqual(j["correccion"]["sincronizacion_original"], {"video_s": 0.0, "lsl_s": 1000.0})
            self.assertNotIn(b"\r\n", (sal / ruta.name).read_bytes())
            self.assertTrue((sal / "TET_P1_RM_2026-10-15-16-34_10hz.csv").read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_recortar(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            ruta = crear_sesion(d)
            correr(d, "--destellos", ",".join(map(str, DESTELLOS)), "--recortar")
            sal = d / "corregido"
            filas = [f for f in leer(sal / "TET_P1_RM_2026-10-15-16-34_10hz.csv") if f["orden"] == "1"]
            self.assertEqual((filas[0]["tiempo_video_s"], filas[-1]["tiempo_video_s"]), ("2.800", "138.200"))  # fin de la ventana: 138,267
            vent = leer(sal / "TET_P1_RM_2026-10-15-16-34_ventanas.csv")
            self.assertEqual(vent[0]["tiempo_video_s"], "2.800")
            self.assertEqual(len(vent), 136)
            self.assertEqual(len(leer(sal / "TET_P1_RM_2026-10-15-16-34_toques.csv")), 1)
            j = json.loads((sal / ruta.name).read_text(encoding="utf-8"))
            dim = j["dimensiones"][0]
            self.assertEqual(j["ventana"], {"inicio_s": 2.767, "fin_s": 138.267})
            self.assertEqual((dim["inicio_s"], len(dim["valores_10hz"]), dim["duracion_s"]), (2.8, 1355, 135.4))
            self.assertEqual(len(dim["trazo_crudo"]), 1)
            self.assertEqual(len(filas), len(dim["valores_10hz"]))

    def test_sin_cambio_no_escribe(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            crear_sesion(d, video_s=2.767)
            out = correr(d, "--destellos", "2.767,-,-,-")
            self.assertIn("no hace falta", out)
            self.assertFalse((d / "corregido").exists())

    def test_desfase_manual(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            ruta = crear_sesion(d)
            correr(d, "--desfase", "2.767")
            j = json.loads((d / "corregido" / ruta.name).read_text(encoding="utf-8"))
            self.assertEqual((j["sincronizacion"]["modelo"], j["sincronizacion"]["video_s"]), ("un_punto", 2.767))
            fila = leer(d / "corregido" / "TET_P1_RM_2026-10-15-16-34_10hz.csv")[2]
            self.assertEqual(fila["tiempo_lsl_s"], "997.233")

    def test_no_corrige_los_ya_corregidos(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            crear_sesion(d)
            correr(d, "--desfase", "2.767")
            correr(d, "--desfase", "2.767")
            self.assertFalse((d / "corregido" / "corregido").exists())


if __name__ == "__main__":
    unittest.main()
