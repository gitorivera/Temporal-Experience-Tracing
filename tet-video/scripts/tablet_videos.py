#!/usr/bin/env python3
"""Copia los videos de la tablet (ColorQuest) al PC por cable USB (ADB), sin pasar por la red.

La versión de tablet del juego graba la partida en su propia carpeta de datos,
/sdcard/Android/data/com.UTP.ColorQuestTablet/files (también busca un nivel de subcarpetas).
Necesita las opciones de desarrollador de la tablet con la depuración USB activada, el cable
conectado y ADB (Android platform-tools).

Uso (dentro de tet-video/):
    python scripts/tablet_videos.py sesion ../test_files/exp009            # lo de siempre, tras una captura
    python scripts/tablet_videos.py sesion ../test_files/exp009 --borrar   # además lo borra de la tablet
    python scripts/tablet_videos.py estado
    python scripts/tablet_videos.py listar [--carpeta ../test_files/exp009]
    python scripts/tablet_videos.py copiar ../test_files/exp009 [--video NOMBRE | --ultimo]
    python scripts/tablet_videos.py borrar NOMBRE --confirmar [--carpeta ...]

Hace lo mismo que `quest_videos.py` —de hecho usa su código, con otra carpeta remota y otros
mensajes—: «sesion» elige el video cuyo tramo de tiempo se cruza con el del XDF de la carpeta (la
cabecera del XDF trae la hora de inicio y la fecha de modificación marca el final), lo copia sin
recomprimir a <carpeta>/original/, comprueba que llegó completo (mismo tamaño), deja junto al XDF
una copia sin audio (ver mp4_sin_audio.py), comprueba que se lea (OpenCV), trae el NDJSON de
eventos del juego de la misma carpeta de la tablet (`events_<participante>_<fecha UTC>.ndjson`, el
que se cruza con la captura) y corre integridad.py.
Si la carpeta no tiene XDF (una captura de tablet sin LSL), elige el video con --video o --ultimo.
Los nombres de la tablet traen la hora de inicio en UTC (`screen_<algo>_AAAAMMDD_HHMMSS.mp4`); el
script la pasa al reloj del PC comparándola con la fecha de modificación (`ajustar_inicio`).
La hora solo sirve para elegir el archivo: la sincronización fina sigue siendo por los destellos.
Nunca borra de la tablet un archivo sin una copia del mismo tamaño en el PC. Al borrar el video de
una captura se borra también su NDJSON (si ya está copiado).
"""
from __future__ import annotations

import sys
from pathlib import Path

# El código común está en quest_videos.py, al lado de este archivo.
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import quest_videos as qv  # noqa: E402

# Carpeta de datos del juego en la tablet; cambia si cambia el nombre del paquete.
PAQUETE = "com.UTP.ColorQuestTablet"
CARPETA_JUEGO = f"/sdcard/Android/data/{PAQUETE}/files"

TABLET = qv.Dispositivo(
    corto="tablet",
    lugar="la tablet",
    lugar_de="de la tablet",
    carpetas=(f"{CARPETA_JUEGO}/*.mp4", f"{CARPETA_JUEGO}/*/*.mp4"),
    carpetas_texto=f"la carpeta del juego es Android/data/{PAQUETE}/files",
    datos=(f"{CARPETA_JUEGO}/*.ndjson",),
    conectar="Conecta la tablet por USB, desbloquéala, pon la conexión USB en «Transferencia de archivos» "
             "y acepta «Permitir depuración USB» (se activa en Ajustes › Opciones de desarrollador).",
    autorizar="desbloquea la tablet y acepta «Permitir depuración USB» "
              "(marca «Permitir siempre desde este computador»).",
    descripcion="Copia los videos de la tablet con ColorQuest al PC por cable USB (ADB).",
)


def main(argv: list[str] | None = None, run: qv.Runner | None = None) -> int:
    return qv.main(argv, run, TABLET)


if __name__ == "__main__":
    sys.exit(main())
