"""Pruebas de xdf_a_eventos.py sin pyxdf (streams con la forma que devuelve pyxdf.load_xdf).

Uso (dentro de tet-video/):  python3 -m unittest discover -s scripts -p "test_*.py"
"""
import tempfile
import unittest
from pathlib import Path

import xdf_a_eventos as x


def stream(name, type_="Markers", fmt="string", stamps=(), series=()):
    return {
        "info": {"name": [name], "type": [type_], "channel_format": [fmt]},
        "time_stamps": list(stamps),
        "time_series": [list(v) if isinstance(v, (list, tuple)) else [v] for v in series],
    }


EEG = stream("OpenBCI", type_="EEG", fmt="float32", stamps=[1, 2], series=[[0.1], [0.2]])
JUEGO = stream(
    "JuegoEventos",
    stamps=[1060.0, 1000.0, 1000.0, 1031.25],
    series=["sync_2", "sync_1", "inicio partida", "acierto, objetivo 3"],
)


class XdfAEventos(unittest.TestCase):
    def test_elige_el_unico_stream_de_marcadores(self):
        self.assertIs(x.pick_stream([EEG, JUEGO], None), JUEGO)

    def test_elige_por_nombre(self):
        otro = stream("Otro")
        self.assertIs(x.pick_stream([EEG, JUEGO, otro], "Otro"), otro)

    def test_nombre_inexistente(self):
        with self.assertRaises(SystemExit) as e:
            x.pick_stream([EEG, JUEGO], "Nada")
        self.assertIn("JuegoEventos", str(e.exception))

    def test_juego_eventos_por_omision_ignora_los_demas(self):
        # Como en la grabación real: JuegoEventos y ColorQuestMarkers en el mismo XDF.
        color = stream("ColorQuestMarkers", stamps=[1000.0], series=["10|session_start"])
        self.assertIs(x.pick_stream([EEG, color, JUEGO], None, ask=lambda names: 0), JUEGO)

    def test_stream_explicito_gana_a_juego_eventos(self):
        color = stream("ColorQuestMarkers")
        self.assertIs(x.pick_stream([JUEGO, color], "ColorQuestMarkers"), color)

    def test_varios_sin_terminal_pide_stream(self):
        with self.assertRaises(SystemExit) as e:
            x.pick_stream([stream("Uno"), stream("Otro")], None)
        self.assertIn("--stream", str(e.exception))

    def test_varios_con_pregunta(self):
        otro = stream("Otro")
        self.assertIs(x.pick_stream([stream("Uno"), otro], None, ask=lambda names: names.index("Otro")), otro)

    def test_pregunta_sin_respuesta_pide_stream(self):
        def eof(_prompt=""):
            raise EOFError
        original = x.input if hasattr(x, "input") else None
        x.input = eof  # input() de builtins queda tapado dentro del módulo
        try:
            with self.assertRaises(SystemExit) as e:
                x._ask_tty(["JuegoEventos", "Otro"])
        finally:
            if original is None:
                del x.input
            else:
                x.input = original
        self.assertIn("--stream", str(e.exception))

    def test_sin_marcadores(self):
        with self.assertRaises(SystemExit):
            x.pick_stream([EEG], None)

    def test_filas_ordenadas(self):
        rows = x.rows_from_stream(JUEGO)
        self.assertEqual([r[1] for r in rows], ["sync_1", "inicio partida", "acierto, objetivo 3", "sync_2"])

    def test_csv_que_lee_la_app(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "eventos.csv"
            x.write_csv(x.rows_from_stream(JUEGO), out)
            raw = out.read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
        self.assertEqual(
            raw.decode("utf-8").splitlines(),
            [
                "tiempo,evento",
                "1000.000,sync_1",
                "1000.000,inicio partida",
                '1031.250,"acierto, objetivo 3"',
                "1060.000,sync_2",
            ],
        )


if __name__ == "__main__":
    unittest.main()
