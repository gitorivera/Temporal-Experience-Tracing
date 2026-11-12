#!/usr/bin/env python3
"""Pruebas de xdf_a_bids.py. No necesitan LabRecorder: el XDF se simula."""
from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import xdf_a_bids as x  # noqa: E402


NOMBRE = "sub-001_ses-01_task-colorquest_acq-quest_run-001_eeg"


class TestEntidades(unittest.TestCase):
    def test_nombre_completo(self):
        ent = x.entidades_de(NOMBRE)
        self.assertEqual(ent["sub"], "001")
        self.assertEqual(ent["ses"], "01")
        self.assertEqual(ent["task"], "colorquest")
        self.assertEqual(ent["acq"], "quest")
        self.assertEqual(ent["run"], "001")
        self.assertEqual(ent["sufijo"], "eeg")

    def test_sin_acq_ni_run(self):
        ent = x.entidades_de("sub-pilot01_ses-01_task-colorquest_beh")
        self.assertEqual(ent["sufijo"], "beh")
        self.assertNotIn("acq", ent)

    def test_nombre_que_no_es_bids(self):
        with self.assertRaises(x.ErrorBids):
            x.entidades_de("block_Default")

    def test_base(self):
        self.assertEqual(x.base_de(NOMBRE), "sub-001_ses-01_task-colorquest_acq-quest_run-001")

    def test_raiz_bids(self):
        with tempfile.TemporaryDirectory() as d:
            xdf = Path(d) / "bids" / "sourcedata" / "sub-001" / "ses-01" / "eeg" / "a.xdf"
            xdf.parent.mkdir(parents=True)
            xdf.touch()
            self.assertEqual(x.raiz_bids(xdf), Path(d).resolve() / "bids")

    def test_raiz_bids_sin_sourcedata(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(x.ErrorBids):
                x.raiz_bids(Path(d) / "a.xdf")

    def test_columna_sin_tildes(self):
        self.assertEqual(x.columna("Diversión"), "diversion")
        self.assertEqual(x.columna("Presencia / Inmersión"), "presencia_inmersion")


class TestEtiquetas(unittest.TestCase):
    def test_etiquetas_reales(self):
        casos = {
            "sync_1": ("sync", "1"),
            "inicio partida": ("inicio_partida", "n/a"),
            "fin partida": ("fin_partida", "n/a"),
            "inicio nivel 2": ("inicio_nivel", "2"),
            "acierto objetivo 3": ("acierto", "3"),
            "error objetivo 1": ("error", "1"),
            "premio puntos 50": ("premio", "50"),
        }
        for etiqueta, esperado in casos.items():
            self.assertEqual(x.tipo_y_valor(etiqueta), esperado, etiqueta)

    def test_etiqueta_desconocida(self):
        self.assertEqual(x.tipo_y_valor("pausa larga 7"), ("pausa_larga", "7"))

    def test_eventos_con_cero_movido(self):
        filas = x.filas_eventos([(1001.0, "acierto objetivo 3"), (1000.5, "sync_1")], t0=1000.0)
        self.assertEqual([f["onset"] for f in filas], ["0.5000", "1.0000"])
        self.assertEqual(filas[0]["trial_type"], "sync")
        self.assertEqual(filas[1]["value"], "3")


class TestBrainVision(unittest.TestCase):
    def test_ida_y_vuelta(self):
        datos = np.arange(12, dtype=float).reshape(6, 2) * 1.5
        with tempfile.TemporaryDirectory() as d:
            vhdr = Path(d) / "prueba.vhdr"
            x.escribir_brainvision(vhdr, datos, 250.0, ["Fp1", "O,2"], ["µV", "µV"])
            self.assertTrue(vhdr.with_suffix(".eeg").exists())
            self.assertTrue(vhdr.with_suffix(".vmrk").exists())
            leidos, fs, canales = x.leer_brainvision(vhdr)
            np.testing.assert_allclose(leidos, datos, rtol=1e-6)
            self.assertAlmostEqual(fs, 250.0, places=6)
            self.assertEqual(canales, ["Fp1", "O,2"])

    def test_cabecera_tiene_lo_que_pide_brainvision(self):
        with tempfile.TemporaryDirectory() as d:
            vhdr = Path(d) / "prueba.vhdr"
            x.escribir_brainvision(vhdr, np.zeros((4, 1)), 100.0, ["C1"], ["µV"])
            texto = vhdr.read_text(encoding="utf-8")
            self.assertIn("DataFormat=BINARY", texto)
            self.assertIn("DataOrientation=MULTIPLEXED", texto)
            self.assertIn("BinaryFormat=IEEE_FLOAT_32", texto)
            self.assertIn("SamplingInterval=10000.000000", texto)

    def test_canales_que_no_cuadran(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(x.ErrorBids):
                x.escribir_brainvision(Path(d) / "a.vhdr", np.zeros((4, 2)), 100.0, ["C1"], ["µV"])


class TestTrazas(unittest.TestCase):
    def filas(self, con_lsl=True):
        def fila(dim, video, lsl, valor):
            return {"dimension": dim, "tiempo_video_s": str(video),
                    "tiempo_lsl_s": str(lsl) if con_lsl else "", "valor": str(valor),
                    "pasada": "1"}
        return [fila("Diversión", 10.0, 1010.0, 0.5), fila("Esfuerzo", 10.0, 1010.0, 0.25),
                fila("Diversión", 10.1, 1010.1, 0.6), fila("Esfuerzo", 10.1, 1010.1, 0.35)]

    def test_tabla_ancha(self):
        avisos: list[str] = []
        columnas, filas, origen = x.trazas_anchas(self.filas(), 1000.0, avisos.append)
        self.assertEqual(columnas, ["onset", "diversion", "esfuerzo"])
        self.assertEqual(origen, "lsl")
        self.assertEqual(len(filas), 2)
        self.assertEqual(filas[0]["onset"], "10.0000")
        self.assertEqual(filas[0]["diversion"], "0.5000")
        self.assertEqual(filas[1]["esfuerzo"], "0.3500")
        self.assertEqual(avisos, [])

    def test_sin_lsl_usa_el_tiempo_del_video(self):
        _, filas, origen = x.trazas_anchas(self.filas(con_lsl=False), 0.0, lambda _: None)
        self.assertEqual(origen, "video")
        self.assertEqual(filas[0]["onset"], "10.0000")

    def test_filas_incompletas_avisan(self):
        avisos: list[str] = []
        filas = self.filas() + [{"dimension": "Fatiga", "tiempo_lsl_s": "", "valor": ""}]
        _, salida, _ = x.trazas_anchas(filas, 1000.0, avisos.append)
        self.assertEqual(len(salida), 2)
        self.assertEqual(len(avisos), 1)

    def test_ventanas_duran_hasta_la_siguiente(self):
        filas = [{"dimension": "Diversión", "tiempo_lsl_s": "1000.0", "valor": "0.5"},
                 {"dimension": "Diversión", "tiempo_lsl_s": "1001.0", "valor": "0.6"}]
        _, eventos = x.eventos_tet(filas, 1000.0, con_pasada=False, hasta_la_siguiente=True)
        self.assertEqual(eventos[0]["duration"], "1.0000")
        self.assertEqual(eventos[1]["duration"], "0")

    def test_toques_son_instantaneos(self):
        filas = [{"dimension": "Diversión", "tiempo_lsl_s": "1000.0", "valor": "0.5",
                  "pasada": "2", "ms_desde_inicio_sesion": "17813"}]
        columnas, eventos = x.eventos_tet(filas, 1000.0, con_pasada=True,
                                          extra=("ms_desde_inicio_sesion",))
        self.assertEqual(eventos[0]["duration"], "0")
        self.assertEqual(eventos[0]["pass"], "2")
        self.assertIn("ms_desde_inicio_sesion", columnas)


class TestScans(unittest.TestCase):
    def test_agrega_y_reemplaza(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "sub-001_ses-01_scans.tsv"
            x.actualizar_scans(ruta, "eeg/a.vhdr", "2026-11-12T09:00:00")
            x.actualizar_scans(ruta, "eeg/b.vhdr", "2026-11-12T10:00:00")
            x.actualizar_scans(ruta, "eeg/a.vhdr", "2026-11-12T11:00:00")
            columnas, filas = x.leer_tsv(ruta)
            self.assertEqual(columnas, ["filename", "acq_time"])
            self.assertEqual([f["filename"] for f in filas], ["eeg/a.vhdr", "eeg/b.vhdr"])
            self.assertEqual(filas[0]["acq_time"], "2026-11-12T11:00:00")


def _xdf_falso(con_eeg=True, con_marcadores=True):
    """Un módulo pyxdf de mentira con un EEG de 2 canales a 100 Hz y dos marcadores."""
    streams = []
    if con_eeg:
        n = 500
        streams.append({
            "info": {
                "name": ["eeg_stream"], "type": ["EEG"], "channel_count": ["2"],
                "nominal_srate": ["100"], "manufacturer": ["OpenBCI"],
                "desc": [{"channels": [{"channel": [
                    {"label": ["C1"], "unit": ["microvolts"]},
                    {"label": ["C2"], "unit": ["microvolts"]},
                ]}]}],
            },
            "time_stamps": 1000.0 + np.arange(n) / 100.0,
            "time_series": np.arange(n * 2, dtype=float).reshape(n, 2),
        })
    if con_marcadores:
        streams.append({
            "info": {"name": ["JuegoEventos"], "type": ["Markers"], "channel_count": ["1"],
                     "nominal_srate": ["0"]},
            "time_stamps": np.array([1000.5, 1001.0]),
            "time_series": [["sync_1"], ["acierto objetivo 3"]],
        })
    cabecera = {"info": {"datetime": ["2026-11-12T09:00:00-05:00"]}}
    modulo = types.ModuleType("pyxdf")
    modulo.load_xdf = lambda ruta, **kw: (streams, cabecera)  # type: ignore[attr-defined]
    return modulo


class TestConversionCompleta(unittest.TestCase):
    def preparar(self, nombre=NOMBRE, con_tet=True):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        raiz = Path(self.tmp.name) / "bids"
        x.escribir_json(raiz / "dataset_description.json",
                        {"Name": "prueba", "BIDSVersion": "1.9.0", "DatasetType": "raw"})
        ent = x.entidades_de(nombre)
        carpeta = (raiz / "sourcedata" / f"sub-{ent['sub']}" / f"ses-{ent['ses']}"
                   / ent["sufijo"] / "run-001_acq-quest")
        carpeta.mkdir(parents=True)
        (carpeta / f"{nombre}.xdf").write_bytes(b"XDF de mentira")
        if con_tet:
            traces = carpeta / "traces"
            traces.mkdir()
            cabeza = "participante,condicion,modo,dimension,orden,tiempo_video_s,tiempo_lsl_s,valor\r\n"
            (traces / "TET_P001_RM_10hz.csv").write_text(
                cabeza
                + "P001,RM,botones,Diversión,1,10.000,1001.000,0.5000\r\n"
                + "P001,RM,botones,Diversión,1,10.100,1001.100,0.6000\r\n",
                encoding="utf-8-sig")
            (traces / "TET_P001_RM_ventanas.csv").write_text(
                cabeza + "P001,RM,botones,Diversión,1,10.000,1001.000,0.5000\r\n",
                encoding="utf-8-sig")
            (traces / "TET_P001_RM_toques.csv").write_text(
                "participante,condicion,modo,dimension,orden,pasada,tiempo_video_s,tiempo_lsl_s,"
                "valor,ms_desde_inicio_sesion\r\n"
                "P001,RM,botones,Diversión,1,1,10.000,1001.000,0.5000,17813\r\n",
                encoding="utf-8-sig")
            (traces / "TET_P001_RM.json").write_text(
                json.dumps({"participante": "P001", "sincronizacion": {"lsl_s": 1001.0}}),
                encoding="utf-8")
        return raiz, carpeta / f"{nombre}.xdf"

    def convertir(self, xdf, raiz, **extra):
        opciones = types.SimpleNamespace(sobrescribir=False, ritmo="nominal", referencia=None,
                                         fabricante=None, modelo=None, red_hz=None, sin_tet=False)
        for k, v in extra.items():
            setattr(opciones, k, v)
        sys.modules["pyxdf"] = _xdf_falso(**extra.pop("xdf", {})) if "xdf" in extra else _xdf_falso()
        self.addCleanup(sys.modules.pop, "pyxdf", None)
        return x.convertir_pasada(xdf, raiz, opciones, log=lambda *_: None)

    def test_sidecar_completo_con_los_campos_fijos(self):
        raiz, xdf = self.preparar()
        x.escribir_json(raiz / "sourcedata" / x.DEFAULTS_EEG, {
            "TaskName": "se-pisa-con-el-de-la-pasada",
            "InstitutionName": "UTP",
            "EEGReference": "CMS/DRL (BioSemi)",
            "PowerLineFrequency": 60,
            "SoftwareFilters": "n/a",
        })
        self.convertir(xdf, raiz)
        base = x.base_de(NOMBRE)
        meta = json.loads((raiz / "sub-001" / "ses-01" / "eeg" / f"{base}_eeg.json")
                          .read_text(encoding="utf-8"))
        # El sidecar de la pasada queda completo, sin depender de la herencia.
        for clave in ("TaskName", "SamplingFrequency", "EEGReference", "PowerLineFrequency",
                      "SoftwareFilters"):
            self.assertIn(clave, meta)
        self.assertEqual(meta["InstitutionName"], "UTP")
        self.assertEqual(meta["TaskName"], "colorquest")
        # Lo que se pide en la línea de comandos manda sobre los campos fijos.
        self.convertir(xdf, raiz, sobrescribir=True, referencia="SRB (OpenBCI)")
        meta = json.loads((raiz / "sub-001" / "ses-01" / "eeg" / f"{base}_eeg.json")
                          .read_text(encoding="utf-8"))
        self.assertEqual(meta["EEGReference"], "SRB (OpenBCI)")

    def test_acq_time_sin_desfase_de_huso(self):
        raiz, xdf = self.preparar()
        self.convertir(xdf, raiz)
        _, scans = x.leer_tsv(raiz / "sub-001" / "ses-01" / "sub-001_ses-01_scans.tsv")
        # BIDS pide AAAA-MM-DDTHH:MM:SS, sin «-05:00» al final.
        self.assertEqual(scans[0]["acq_time"], "2026-11-12T09:00:00")

    def test_escribe_todo_el_conjunto(self):
        raiz, xdf = self.preparar()
        avisos = self.convertir(xdf, raiz)
        self.assertEqual(avisos, [])
        base = x.base_de(NOMBRE)
        eeg = raiz / "sub-001" / "ses-01" / "eeg"
        for sufijo in (".vhdr", ".eeg", ".vmrk"):
            self.assertTrue((eeg / f"{base}_eeg{sufijo}").exists(), sufijo)
        datos, fs, canales = x.leer_brainvision(eeg / f"{base}_eeg.vhdr")
        self.assertEqual(datos.shape, (500, 2))
        self.assertAlmostEqual(fs, 100.0)
        self.assertEqual(canales, ["C1", "C2"])

        sidecar = json.loads((eeg / f"{base}_eeg.json").read_text(encoding="utf-8"))
        self.assertEqual(sidecar["SamplingFrequency"], 100.0)
        self.assertEqual(sidecar["EEGChannelCount"], 2)
        self.assertEqual(sidecar["Manufacturer"], "OpenBCI")
        self.assertAlmostEqual(sidecar["RecordingDuration"], 5.0)

        columnas, canales_tsv = x.leer_tsv(eeg / f"{base}_channels.tsv")
        self.assertEqual(columnas[:3], ["name", "type", "units"])
        self.assertEqual(len(canales_tsv), 2)
        self.assertEqual(canales_tsv[0]["type"], "EEG")

        _, eventos = x.leer_tsv(eeg / f"{base}_events.tsv")
        self.assertEqual([e["onset"] for e in eventos], ["0.5000", "1.0000"])
        self.assertEqual(eventos[0]["trial_type"], "sync")

        _, scans = x.leer_tsv(raiz / "sub-001" / "ses-01" / "sub-001_ses-01_scans.tsv")
        self.assertEqual(scans[0]["filename"], f"eeg/{base}_eeg.vhdr")
        self.assertTrue(scans[0]["acq_time"].startswith("2026-11-12T09:00:00"))

    def test_derivados_de_tet_en_el_reloj_del_eeg(self):
        raiz, xdf = self.preparar()
        self.convertir(xdf, raiz)
        base = x.base_de(NOMBRE)
        tet = raiz / "derivatives" / "tet" / "sub-001" / "ses-01" / "beh"
        columnas, filas = x.leer_tsv(tet / f"{base}_desc-tet_timeseries.tsv")
        self.assertEqual(columnas, ["onset", "diversion"])
        # El EEG empieza en 1000,0 y la traza en 1001,0: un segundo después.
        self.assertEqual(filas[0]["onset"], "1.0000")
        self.assertEqual(filas[0]["diversion"], "0.5000")

        meta = json.loads((tet / f"{base}_desc-tet_timeseries.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["SamplingFrequency"], 10.0)
        self.assertEqual(meta["StartTime"], 1.0)
        self.assertEqual(meta["TimeSource"], "lsl")

        _, toques = x.leer_tsv(tet / f"{base}_desc-tettoques_events.tsv")
        self.assertEqual(toques[0]["pass"], "1")
        self.assertTrue((tet / f"{base}_desc-tet_sesion.json").exists())

    def test_avisa_si_las_trazas_son_de_otra_pasada(self):
        raiz, xdf = self.preparar()
        # El EEG falso va de 1000 a 1005 s; estas trazas caen mucho después.
        traces = xdf.parent / "traces"
        viejo = (traces / "TET_P001_RM_10hz.csv").read_text(encoding="utf-8-sig")
        (traces / "TET_P001_RM_10hz.csv").write_text(
            viejo.replace("1001.0", "2517.9"), encoding="utf-8-sig")
        avisos = self.convertir(xdf, raiz)
        self.assertEqual(len(avisos), 1)
        self.assertIn("no se cruzan", avisos[0])

    def test_no_sobrescribe_sin_permiso(self):
        raiz, xdf = self.preparar()
        self.convertir(xdf, raiz)
        with self.assertRaises(x.ErrorBids):
            self.convertir(xdf, raiz)
        self.convertir(xdf, raiz, sobrescribir=True)

    def test_eeg_que_falta_es_error(self):
        raiz, xdf = self.preparar()
        sys.modules["pyxdf"] = _xdf_falso(con_eeg=False)
        self.addCleanup(sys.modules.pop, "pyxdf", None)
        opciones = types.SimpleNamespace(sobrescribir=False, ritmo="nominal", referencia=None,
                                         fabricante=None, modelo=None, red_hz=None, sin_tet=True)
        with self.assertRaises(x.ErrorBids) as cm:
            x.convertir_pasada(xdf, raiz, opciones, log=lambda *_: None)
        self.assertIn("_beh", str(cm.exception))

    def test_pasada_sin_eeg(self):
        nombre = "sub-002_ses-01_task-colorquest_acq-tablet_run-001_beh"
        raiz, xdf = self.preparar(nombre=nombre, con_tet=False)
        sys.modules["pyxdf"] = _xdf_falso(con_eeg=False)
        self.addCleanup(sys.modules.pop, "pyxdf", None)
        opciones = types.SimpleNamespace(sobrescribir=False, ritmo="nominal", referencia=None,
                                         fabricante=None, modelo=None, red_hz=None, sin_tet=True)
        x.convertir_pasada(xdf, raiz, opciones, log=lambda *_: None)
        base = x.base_de(nombre)
        beh = raiz / "sub-002" / "ses-01" / "beh"
        _, eventos = x.leer_tsv(beh / f"{base}_events.tsv")
        # Sin EEG el cero es el primer marcador.
        self.assertEqual([e["onset"] for e in eventos], ["0.0000", "0.5000"])
        self.assertFalse((beh / f"{base}_eeg.vhdr").exists())
        # TaskName se hereda del task-<task>_beh.json de la raíz: aquí no va un sidecar suelto.
        self.assertFalse((beh / f"{base}_beh.json").exists())
        _, scans = x.leer_tsv(raiz / "sub-002" / "ses-01" / "sub-002_ses-01_scans.tsv")
        self.assertEqual(scans[0]["filename"], f"beh/{base}_events.tsv")


if __name__ == "__main__":
    unittest.main()
