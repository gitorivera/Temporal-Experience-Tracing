#!/usr/bin/env python3
"""Copia los videos de la Quest 3 al PC por cable USB (ADB), sin pasar por la red.

Las grabaciones que se hacen con Meta Horizon Link (Windows) quedan en el visor, en
/sdcard/Documents/Casting_Video_<milisegundos>.mp4; las del menú «Grabar video» de la Quest, en
/sdcard/Oculus/VideoShots/. El script busca en las dos. Necesita el modo desarrollador de la
Quest, el cable USB-C conectado y ADB (Android platform-tools).

Uso (dentro de tet-video/):
    python scripts/quest_videos.py sesion ../test_files/exp008            # lo de siempre, tras una captura
    python scripts/quest_videos.py sesion ../test_files/exp008 --borrar   # además lo borra del visor
    python scripts/quest_videos.py estado
    python scripts/quest_videos.py listar [--carpeta ../test_files/exp008]
    python scripts/quest_videos.py copiar ../test_files/exp008 [--video NOMBRE | --ultimo]
    python scripts/quest_videos.py borrar NOMBRE --confirmar [--carpeta ...]

«sesion» elige el video cuyo tramo de tiempo se cruza con el del XDF de la carpeta (la cabecera del
XDF trae la hora de inicio y la fecha de modificación marca el final), lo copia sin recomprimir a
<carpeta>/original/, comprueba que llegó completo (mismo tamaño), deja junto al XDF una copia sin
audio (el primer paquete de audio de Link deja el video en error en Chrome; ver mp4_sin_audio.py),
comprueba que se lea (OpenCV), trae el NDJSON de eventos que el juego dejó en el visor
(/sdcard/Android/data/com.UTP.ColorQuest/files/events_<participante>_<fecha UTC>.ndjson) y corre
integridad.py.
La hora solo sirve para elegir el archivo: la sincronización fina sigue siendo por los destellos.
Nunca borra del visor un archivo sin una copia del mismo tamaño en el PC. Al borrar el video de una
captura se borra también su NDJSON (si ya está copiado); de lo que no esté copiado solo avisa.

Para la tablet con ColorQuest hay otro script, `tablet_videos.py`: usa este mismo código con otra
carpeta remota (ver la clase `Dispositivo`).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

REINTENTOS = 3
# Si ningún video se cruza con el XDF, se acepta el más cercano a menos de esta distancia.
MAX_DISTANCIA = timedelta(minutes=10)
# Ninguna grabación de una sesión dura más que esto; sirve para saber si el nombre y la fecha de
# modificación están en el mismo reloj (la tablet escribe el nombre en UTC).
MAX_DURACION = timedelta(hours=6)
RAIZ_PRUEBAS = Path(__file__).resolve().parents[2] / "test_files"
# Subcarpeta de la captura donde queda el archivo tal como salió del visor.
ORIGINAL = "original"


class ErrorAparato(Exception):
    """Algo impide seguir; el mensaje dice qué hacer."""


# Nombre anterior, por si algún script lo usa.
ErrorQuest = ErrorAparato


@dataclass(frozen=True)
class Dispositivo:
    """Lo que cambia de un aparato a otro: dónde graba y cómo nombrarlo en los mensajes.

    `tablet_videos.py` define el perfil de la tablet; el resto del script es el mismo.
    """

    corto: str                  # va detrás de «la» en los mensajes: «la Quest», «la tablet»
    lugar: str                  # «el visor», «la tablet»
    lugar_de: str               # «del visor», «de la tablet»
    carpetas: tuple[str, ...]   # patrones de las carpetas donde quedan las grabaciones
    carpetas_texto: str         # cómo nombrarlas en los avisos
    datos: tuple[str, ...]      # patrones de los archivos de datos del juego (NDJSON de eventos)
    conectar: str               # qué hacer si el aparato no aparece
    autorizar: str              # qué hacer si no autorizó este PC
    descripcion: str            # ayuda de la línea de comandos


QUEST = Dispositivo(
    corto="Quest",
    lugar="el visor",
    lugar_de="del visor",
    carpetas=("/sdcard/Documents/Casting_Video_*.mp4", "/sdcard/Oculus/VideoShots/*.mp4"),
    carpetas_texto="ni en Documents ni en Oculus/VideoShots",
    datos=("/sdcard/Android/data/com.UTP.ColorQuest/files/*.ndjson",),
    conectar="Conecta el cable USB-C (el de Link), ponte el visor y acepta «Permitir depuración USB» "
             "y «Permitir el acceso a los datos».",
    autorizar="ponte el visor y acepta «Permitir depuración USB» (marca «Permitir siempre desde este computador»).",
    descripcion="Copia los videos de la Quest 3 al PC por cable USB (ADB).",
)


# ---------------------------------------------------------------------------------------------
# ADB


Runner = Callable[[list[str]], "tuple[int, str]"]


def buscar_adb() -> str:
    """adb del PATH o de las carpetas habituales del SDK de Android en Windows."""
    en_path = shutil.which("adb")
    if en_path:
        return en_path
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    for cand in (local / "Android" / "platform-tools" / "adb.exe", local / "Android" / "Sdk" / "platform-tools" / "adb.exe"):
        if cand.exists():
            return str(cand)
    raise ErrorAparato("No se encontró adb. Instala Android platform-tools o indícalo con --adb RUTA.")


def runner_real(adb: str, serial: str | None = None) -> Runner:
    def run(args: list[str]) -> tuple[int, str]:
        cmd = [adb, *(["-s", serial] if serial else []), *args]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        except subprocess.TimeoutExpired:
            return 1, "adb no respondió en 10 minutos"
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    return run


def leer_dispositivos(texto: str) -> list[tuple[str, str]]:
    """(serie, estado) de la salida de `adb devices`."""
    out = []
    for linea in texto.splitlines():
        partes = linea.split()
        if len(partes) >= 2 and partes[0] != "List" and not linea.startswith("*"):
            out.append((partes[0], partes[1]))
    return out


def aviso_version(texto: str) -> str | None:
    """Mensaje si hay dos ADB de versiones distintas peleándose por el servidor."""
    if "doesn't match this client" in texto or "server version" in texto and "match" in texto:
        return ("Hay otro ADB de otra versión corriendo (p. ej. el de Meta Quest Developer Hub). "
                "Ciérralo, o ejecuta «adb kill-server» y vuelve a intentar.")
    return None


# ---------------------------------------------------------------------------------------------
# Videos del visor


@dataclass
class ArchivoRemoto:
    ruta: str
    tamano: int
    fin: datetime
    inicio: datetime | None

    @property
    def nombre(self) -> str:
        return self.ruta.rsplit("/", 1)[-1]

    def tramo(self) -> tuple[datetime, datetime]:
        return (self.inicio or self.fin, self.fin)


def inicio_desde_nombre(nombre: str) -> datetime | None:
    """Hora de inicio según el nombre, si el grabador la pone.

    Reconoce el epoch en milisegundos (Casting_Video_<ms> de Link) y las fechas con hora
    (AAAAMMDD-HHMMSS del menú de la Quest, AAAA-MM-DD_HH-MM-SS y parecidas de Android).
    """
    m = re.search(r"(?<!\d)(\d{12,14})(?!\d)", nombre)
    if m:
        try:
            return datetime.fromtimestamp(int(m.group(1)) / 1000).astimezone()
        except (ValueError, OSError, OverflowError):
            return None
    m = re.search(r"(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_T ](\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})", nombre)
    if m:
        try:
            return datetime(*(int(x) for x in m.groups())).astimezone()
        except ValueError:
            return None
    return None


def ajustar_inicio(inicio: datetime | None, fin: datetime) -> datetime | None:
    """Pone la hora del nombre en el mismo reloj que la fecha de modificación.

    El nombre y la fecha de modificación tienen que encerrar una duración razonable (de 0 a
    MAX_DURACION). La tablet escribe el nombre en UTC y el archivo se modifica en hora local, así
    que se prueba a mover el nombre en medias horas (los husos) hasta que cuadre. Si ni así cuadra,
    el nombre no sirve para saber cuándo empezó y se descarta (queda solo el final).
    """
    if inicio is None:
        return None
    for n in sorted(range(-28, 29), key=abs):
        cand = inicio + timedelta(minutes=30 * n)
        if timedelta(0) <= fin - cand <= MAX_DURACION:
            return cand
    return None


def leer_stat(texto: str) -> list[ArchivoRemoto]:
    """Líneas «tamaño mtime ruta» de `stat -c '%s %Y %n'`; ignora errores y patrones sin archivos."""
    out = []
    for linea in texto.splitlines():
        m = re.match(r"^(\d+) (\d+) (/.+)$", linea.strip())
        if not m:
            continue
        ruta = m.group(3)
        fin = datetime.fromtimestamp(int(m.group(2))).astimezone()
        inicio = ajustar_inicio(inicio_desde_nombre(ruta.rsplit("/", 1)[-1]), fin)
        out.append(ArchivoRemoto(ruta, int(m.group(1)), fin, inicio))
    return sorted(out, key=lambda v: v.fin, reverse=True)


def intervalo_xdf(ruta: Path) -> tuple[datetime, datetime]:
    """(inicio, fin) de la grabación de LabRecorder: cabecera <datetime> y fecha de modificación."""
    fin = datetime.fromtimestamp(ruta.stat().st_mtime).astimezone()
    with ruta.open("rb") as f:
        cabecera = f.read(4096).decode("utf-8", errors="replace")
    m = re.search(r"<datetime>([^<]+)</datetime>", cabecera)
    if m:
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
            try:
                inicio = datetime.strptime(m.group(1).strip(), fmt)
                return (inicio if inicio.tzinfo else inicio.astimezone()), fin
            except ValueError:
                pass
    return fin, fin


def cruce(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> float:
    """Segundos que se cruzan dos tramos (0 si no se tocan)."""
    return max(0.0, (min(a[1], b[1]) - max(a[0], b[0])).total_seconds())


def distancia(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> timedelta:
    if cruce(a, b) > 0:
        return timedelta(0)
    return min(abs(a[0] - b[1]), abs(b[0] - a[1]))


def elegir_video(videos: list[ArchivoRemoto], tramo: tuple[datetime, datetime]) -> tuple[ArchivoRemoto | None, list[str]]:
    """El video que más se cruza con el tramo del XDF; si ninguno, el más cercano. Devuelve avisos."""
    avisos: list[str] = []
    con_cruce = sorted((v for v in videos if cruce(v.tramo(), tramo) > 0), key=lambda v: cruce(v.tramo(), tramo), reverse=True)
    if con_cruce:
        elegido = con_cruce[0]
        if len(con_cruce) > 1 and cruce(con_cruce[1].tramo(), tramo) > 0.5 * cruce(elegido.tramo(), tramo):
            avisos.append("Hay otro video que también se cruza con la captura: "
                          + ", ".join(v.nombre for v in con_cruce[1:]) + ". Si no es el correcto, usa --video.")
        return elegido, avisos
    cercanos = sorted(videos, key=lambda v: distancia(v.tramo(), tramo))
    if cercanos and distancia(cercanos[0].tramo(), tramo) <= MAX_DISTANCIA:
        d = distancia(cercanos[0].tramo(), tramo).total_seconds()
        avisos.append(f"Ningún video se cruza con la captura; se usa el más cercano ({d:.0f} s de distancia). "
                      "¿Están bien las horas del visor y del PC?")
        return cercanos[0], avisos
    return None, avisos


def tramo_captura(carpeta: Path, video: ArchivoRemoto) -> tuple[datetime, datetime]:
    """Tramo de toda la captura: el del video elegido y, si hay XDF, también el suyo."""
    tramos = [video.tramo()]
    xdf = sorted(carpeta.glob("*.xdf"))
    if xdf:
        tramos.append(intervalo_xdf(xdf[0]))
    return min(t[0] for t in tramos), max(t[1] for t in tramos)


class Aparato:
    """Operaciones sobre el aparato (visor o tablet) con un `run(args) -> (código, salida)` de ADB."""

    def __init__(self, run: Runner, d: Dispositivo = QUEST):
        self.run = run
        self.d = d

    def comprobar(self) -> str:
        """Serie del aparato conectado y autorizado; si no, ErrorAparato con lo que hay que hacer."""
        code, out = self.run(["devices", "-l"])
        aviso = aviso_version(out)
        if aviso:
            raise ErrorAparato(aviso)
        if code != 0:
            raise ErrorAparato(f"adb falló: {out.strip()}")
        disp = leer_dispositivos(out)
        if not disp:
            raise ErrorAparato(f"No hay ninguna {self.d.corto} conectada. {self.d.conectar}")
        if len(disp) > 1:
            raise ErrorAparato("Hay varios dispositivos conectados: " + ", ".join(s for s, _ in disp)
                               + ". Elige uno con --serie.")
        serie, estado = disp[0]
        if estado == "unauthorized":
            raise ErrorAparato(f"La {self.d.corto} no autorizó este PC: {self.d.autorizar}")
        if estado != "device":
            raise ErrorAparato(f"La {self.d.corto} está en estado «{estado}». Desconecta y vuelve a conectar el cable.")
        return serie

    def libre(self) -> str | None:
        code, out = self.run(["shell", "df -h /sdcard | tail -1"])
        partes = out.split()
        return f"{partes[3]} libres de {partes[1]}" if code == 0 and len(partes) >= 4 else None

    def listar(self, patrones: tuple[str, ...] | None = None) -> list[ArchivoRemoto]:
        """Archivos del aparato que casan con los patrones (por omisión, los videos)."""
        cmd = "stat -c '%s %Y %n' " + " ".join(patrones or self.d.carpetas) + " 2>/dev/null"
        _, out = self.run(["shell", cmd])
        return leer_stat(out)

    def listar_datos(self) -> list[ArchivoRemoto]:
        """Archivos de datos del juego (los NDJSON de eventos), los más nuevos primero."""
        return self.listar(self.d.datos) if self.d.datos else []

    def traer(self, archivo: ArchivoRemoto, destino: Path, log: Callable[[str], None] = print) -> Path:
        """Copia un archivo a `destino` pasando por un `.part`: comprueba el tamaño y reintenta."""
        destino.parent.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(destino.parent).free < archivo.tamano:
            raise ErrorAparato(f"No hay espacio en el disco del PC para copiar {archivo.nombre}.")
        parcial = destino.with_name(destino.name + ".part")
        for intento in range(1, REINTENTOS + 1):
            parcial.unlink(missing_ok=True)
            code, out = self.run(["pull", archivo.ruta, str(parcial)])
            tam = parcial.stat().st_size if parcial.exists() else -1
            if code == 0 and tam == archivo.tamano:
                parcial.replace(destino)
                return destino
            log(f"Intento {intento} de {REINTENTOS} fallido ({out.strip().splitlines()[-1] if out.strip() else 'sin salida'}; "
                f"{tam} de {archivo.tamano} bytes). ¿Se movió el cable?")
        parcial.unlink(missing_ok=True)
        raise ErrorAparato(f"No se pudo copiar {archivo.nombre} completo tras {REINTENTOS} intentos.")

    def copiar_datos(self, tramo: tuple[datetime, datetime], carpeta: Path,
                     log: Callable[[str], None] = print) -> list[Path]:
        """Trae a la carpeta de la captura los NDJSON del juego que se cruzan con su tramo.

        El NDJSON empieza cuando el niño empieza la sesión, ya con la grabación andando, así que
        su tramo (nombre en UTC → fecha de modificación) cae dentro del de la captura. Si hubo
        varias sesiones del juego en una misma grabación, se traen todas. Para borrarlos del
        aparato, `borrar_datos`.
        """
        copiados: list[Path] = []
        for a in self.listar_datos():
            if cruce(a.tramo(), tramo) <= 0:
                continue
            destino = carpeta / a.nombre
            if destino.exists():
                if destino.stat().st_size == a.tamano:
                    log(f"{a.nombre} ya estaba en la carpeta.")
                    copiados.append(destino)
                else:
                    log(f"[AVISO] Ya hay un {a.nombre} en la carpeta con otro tamaño: no se copia.")
                continue
            copiados.append(self.traer(a, destino, log))
            log(f"Copiado {a.nombre} ({a.tamano / 1e3:.0f} kB) a {carpeta}.")
        return copiados

    def copiar(self, video: ArchivoRemoto, carpeta: Path, log: Callable[[str], None] = print) -> Path:
        """Copia el archivo tal cual a <carpeta>/original/; comprueba el tamaño y reintenta si se corta."""
        destino = carpeta / ORIGINAL / video.nombre
        destino.parent.mkdir(parents=True, exist_ok=True)
        antiguo = carpeta / video.nombre
        if not destino.exists() and antiguo.exists() and antiguo.stat().st_size == video.tamano:
            # Copiado con la versión anterior del script, junto al XDF: pasa a original/.
            antiguo.replace(destino)
            log(f"{video.nombre} ya estaba copiado: se movió a {ORIGINAL}/.")
        if destino.exists():
            if destino.stat().st_size == video.tamano:
                log(f"{destino.name} ya está en la carpeta con el mismo tamaño: no se copia otra vez.")
                return destino
            raise ErrorAparato(f"Ya hay un {destino.name} en la carpeta con otro tamaño. Bórralo o muévelo antes.")
        # El doble, más un poco: al lado queda la copia sin audio que abre la app TET.
        if shutil.disk_usage(carpeta).free < video.tamano * 2.1:
            raise ErrorAparato("No hay espacio suficiente en el disco del PC para copiar el video.")
        self.traer(video, destino, log)
        log(f"Copiado {video.nombre} ({video.tamano / 1e6:.1f} MB) a {destino.parent}.")
        return destino

    def borrar(self, archivo: ArchivoRemoto) -> None:
        ruta = archivo.ruta.replace("'", "'\\''")
        code, out = self.run(["shell", f"rm -- '{ruta}'"])
        if code != 0:
            raise ErrorAparato(f"No se pudo borrar {archivo.nombre} {self.d.lugar_de}: {out.strip()}")

    def borrar_datos(self, tramo: tuple[datetime, datetime], carpetas: list[Path],
                     log: Callable[[str], None] = print) -> list[str]:
        """Borra los NDJSON de esa captura, con la misma regla que el video.

        Solo borra el que ya tenga en el PC una copia del mismo tamaño (`carpetas` es dónde
        buscarla); de los demás solo avisa. Va junto con el borrado del video: si el video de la
        captura se borra del aparato, su registro del juego también.
        """
        borrados: list[str] = []
        for a in self.listar_datos():
            if cruce(a.tramo(), tramo) <= 0:
                continue
            local = copia_local(a, carpetas)
            if local is None:
                log(f"[AVISO] {a.nombre} no está copiado en el PC: no se borra {self.d.lugar_de}.")
                continue
            self.borrar(a)
            log(f"[OK]    {a.nombre} borrado {self.d.lugar_de} (copia en {local}).")
            borrados.append(a.nombre)
        return borrados


def preparar_para_tet(original: Path, carpeta: Path, log: Callable[[str], None] = print) -> Path:
    """Deja en la carpeta, con el mismo nombre, la copia sin audio que abre la app TET."""
    import mp4_sin_audio

    destino = carpeta / original.name
    if destino.exists() and destino.stat().st_size < original.stat().st_size:
        log(f"{destino.name} sin audio ya estaba en la carpeta.")
        return destino
    try:
        n = mp4_sin_audio.quitar_audio(original, destino)
    except mp4_sin_audio.ErrorMp4 as e:
        raise ErrorAparato(f"No se pudo quitar el audio de {original.name}: {e}")
    log(f"{destino.name}: {'sin audio, para TET' if n else 'no tenía audio; copia idéntica'} (el original sigue en {ORIGINAL}/).")
    return destino


def copia_local(video: ArchivoRemoto, carpetas: list[Path]) -> Path | None:
    """Una copia en el PC con el mismo nombre y tamaño, si la hay."""
    for c in carpetas:
        if not c.exists():
            continue
        for p in c.rglob(video.nombre):
            if p.is_file() and p.stat().st_size == video.tamano:
                return p
    return None


def verificar_video(ruta: Path) -> str:
    """Resumen del video con OpenCV; ErrorQuest si no se puede leer. Sin OpenCV, solo avisa."""
    try:
        import cv2
    except ImportError:
        return "sin OpenCV no se comprobó que el video se pueda leer (pip install opencv-python-headless)"
    cap = cv2.VideoCapture(str(ruta))
    try:
        if not cap.isOpened():
            raise ErrorAparato(f"OpenCV no puede abrir {ruta.name}: el archivo puede estar dañado.")
        w, h, fps, n = cap.get(3), cap.get(4), cap.get(5), cap.get(7)
        # Leer el último cuadro confirma que el archivo está completo.
        if n > 1:
            cap.set(cv2.CAP_PROP_POS_FRAMES, n - 2)
        ok, _ = cap.read()
        if not ok or n < 1:
            raise ErrorAparato(f"{ruta.name} no tiene cuadros legibles al final: el archivo puede estar incompleto.")
        dur = n / fps if fps > 0 else float("nan")
        return f"{int(w)}×{int(h)}, {fps:.2f} cuadros/s, {int(n)} cuadros, unos {dur:.1f} s"
    finally:
        cap.release()


def fmt_hora(d: datetime | None) -> str:
    return d.strftime("%Y-%m-%d %H:%M:%S") if d else "?"


# ---------------------------------------------------------------------------------------------
# Comandos


def cmd_estado(q: Aparato) -> int:
    serie = q.comprobar()
    print(f"[OK]    La {q.d.corto} está conectada y autorizada (serie {serie}).")
    libre = q.libre()
    if libre:
        print(f"        Almacenamiento {q.d.lugar_de}: {libre}.")
    videos = q.listar()
    print(f"        {len(videos)} videos en {q.d.lugar} ({sum(v.tamano for v in videos) / 1e9:.2f} GB).")
    return 0


def cmd_listar(q: Aparato, carpeta: Path | None) -> int:
    q.comprobar()
    videos = q.listar()
    elegido = None
    if carpeta is not None:
        xdf = sorted(carpeta.glob("*.xdf"))
        if xdf:
            tramo = intervalo_xdf(xdf[0])
            elegido, avisos = elegir_video(videos, tramo)
            print(f"Captura {xdf[0].name}: de {fmt_hora(tramo[0])} a {fmt_hora(tramo[1])}.")
            for a in avisos:
                print(f"[AVISO] {a}")
            if elegido is None:
                print(f"[AVISO] Ningún video de {q.d.lugar} corresponde a la hora de esta captura.")
    if not videos:
        print(f"No hay videos en {q.d.lugar}.")
    for v in videos:
        marca = "→" if v is elegido else " "
        print(f"{marca} {fmt_hora(v.inicio)} a {fmt_hora(v.fin)}  {v.tamano / 1e6:8.1f} MB  {v.ruta}")
    return 0


def resolver_video(q: Aparato, carpeta: Path, nombre: str | None, ultimo: bool) -> ArchivoRemoto:
    videos = q.listar()
    if not videos:
        raise ErrorAparato(f"No hay videos en {q.d.lugar} ({q.d.carpetas_texto}).")
    if nombre:
        v = next((v for v in videos if v.nombre == nombre or v.ruta == nombre), None)
        if v is None:
            raise ErrorAparato(f"No hay ningún video llamado {nombre} en {q.d.lugar} (mira «listar»).")
        return v
    if ultimo:
        return videos[0]
    xdf = sorted(carpeta.glob("*.xdf"))
    if not xdf:
        raise ErrorAparato(f"La carpeta {carpeta} no tiene XDF: indica el video con --video NOMBRE o --ultimo.")
    tramo = intervalo_xdf(xdf[0])
    print(f"Captura {xdf[0].name}: de {fmt_hora(tramo[0])} a {fmt_hora(tramo[1])}.")
    v, avisos = elegir_video(videos, tramo)
    for a in avisos:
        print(f"[AVISO] {a}")
    if v is None:
        raise ErrorAparato(f"Ningún video de {q.d.lugar} corresponde a la hora de la captura. "
                           "Mira «listar» y usa --video.")
    print(f"Video de la captura: {v.nombre} (de {fmt_hora(v.inicio)} a {fmt_hora(v.fin)}).")
    return v


def cmd_copiar(q: Aparato, carpeta: Path, nombre: str | None, ultimo: bool) -> Path:
    q.comprobar()
    v = resolver_video(q, carpeta, nombre, ultimo)
    local = preparar_para_tet(q.copiar(v, carpeta), carpeta)
    print(f"[OK]    {local.name}: {verificar_video(local)}.")
    return local


def cmd_borrar(q: Aparato, nombre: str, confirmar: bool, carpetas: list[Path]) -> int:
    q.comprobar()
    v = next((v for v in q.listar() if v.nombre == nombre or v.ruta == nombre), None)
    if v is None:
        raise ErrorAparato(f"No hay ningún video llamado {nombre} en {q.d.lugar}.")
    local = copia_local(v, carpetas)
    if local is None:
        raise ErrorAparato(f"No hay una copia de {v.nombre} con el mismo tamaño en el PC: "
                           f"no se borra {q.d.lugar_de}.")
    if not confirmar:
        raise ErrorAparato(f"Hay copia en {local}. Para borrarlo {q.d.lugar_de}, repite con --confirmar.")
    q.borrar(v)
    if any(x.ruta == v.ruta for x in q.listar()):
        raise ErrorAparato(f"{v.nombre} sigue en {q.d.lugar} después de borrarlo.")
    print(f"[OK]    {v.nombre} borrado {q.d.lugar_de} (copia en {local}).")
    # Con el video se va también el NDJSON de esa captura, si está copiado en el PC.
    q.borrar_datos(v.tramo(), carpetas)
    return 0


def cmd_sesion(q: Aparato, carpeta: Path, nombre: str | None, borrar: bool, ultimo: bool = False) -> int:
    serie = q.comprobar()
    print(f"[OK]    La {q.d.corto} está conectada (serie {serie}).")
    if not carpeta.is_dir():
        raise ErrorAparato(f"No existe la carpeta {carpeta}.")
    v = resolver_video(q, carpeta, nombre, ultimo)
    local = preparar_para_tet(q.copiar(v, carpeta), carpeta)
    print(f"[OK]    {local.name}: {verificar_video(local)}.")

    tramo = tramo_captura(carpeta, v)
    datos = q.copiar_datos(tramo, carpeta)
    if datos:
        print(f"[OK]    NDJSON del juego: {', '.join(d.name for d in datos)}.")
    elif q.d.datos:
        print(f"[AVISO] No se encontró en {q.d.lugar} ningún NDJSON del juego de esta captura "
              "(¿la partida se jugó en otro aparato, o ya se borró?).")

    import integridad
    print("\nRevisión de integridad de la carpeta:")
    inf = integridad.revisar_carpeta(carpeta)
    texto = inf.texto()
    (carpeta / "integridad.txt").write_text(texto, encoding="utf-8")
    for linea in texto.splitlines():
        if linea.startswith(("[ERROR]", "[AVISO]", "==", "Resumen")):
            print(linea)
    print(f"Informe completo en {carpeta / 'integridad.txt'}")

    if borrar:
        if copia_local(v, [carpeta / ORIGINAL]) is None:
            raise ErrorAparato(f"La copia no quedó con el mismo tamaño: no se borra {q.d.lugar_de}.")
        q.borrar(v)
        print(f"[OK]    {v.nombre} borrado {q.d.lugar_de}.")
        # Con el video se va también el registro del juego de esa captura, ya copiado aquí.
        q.borrar_datos(tramo, [carpeta])
    return 1 if inf.errores else 0


def main(argv: list[str] | None = None, run: Runner | None = None, d: Dispositivo = QUEST) -> int:
    p = argparse.ArgumentParser(description=d.descripcion)
    p.add_argument("--adb", help="ruta de adb (por defecto, el del PATH o el de platform-tools)")
    p.add_argument("--serie", help=f"serie de la {d.corto} si hay varios dispositivos conectados")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("estado", help=f"comprueba la conexión con la {d.corto}")
    pl = sub.add_parser("listar", help=f"lista los videos {d.lugar_de}")
    pl.add_argument("--carpeta", type=Path, help="marca el video que corresponde al XDF de esta carpeta")
    pc = sub.add_parser("copiar", help="copia un video a la carpeta de la captura")
    pc.add_argument("carpeta", type=Path)
    g = pc.add_mutually_exclusive_group()
    g.add_argument("--video", help=f"nombre del video en {d.lugar} (mira «listar»)")
    g.add_argument("--ultimo", action="store_true", help="el video más reciente")
    pb = sub.add_parser("borrar", help=f"borra {d.lugar_de} un video y el NDJSON de su captura, "
                                       "si ya están copiados en el PC")
    pb.add_argument("nombre")
    pb.add_argument("--confirmar", action="store_true")
    pb.add_argument("--carpeta", type=Path, action="append", help=f"dónde buscar la copia (por defecto {RAIZ_PRUEBAS})")
    ps = sub.add_parser("sesion", help="tras una captura: copia el video de la sesión y revisa la carpeta")
    ps.add_argument("carpeta", type=Path)
    gs = ps.add_mutually_exclusive_group()
    gs.add_argument("--video", help="nombre del video, si la elección por hora no sirve")
    gs.add_argument("--ultimo", action="store_true",
                    help="el video más reciente (para capturas sin XDF, como las de la tablet)")
    ps.add_argument("--borrar", action="store_true",
                    help=f"borrar {d.lugar_de} el video y el NDJSON después de copiarlos y verificarlos")
    args = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    try:
        q = Aparato(run or runner_real(args.adb or buscar_adb(), args.serie), d)
        if args.cmd == "estado":
            return cmd_estado(q)
        if args.cmd == "listar":
            return cmd_listar(q, args.carpeta)
        if args.cmd == "copiar":
            cmd_copiar(q, args.carpeta, args.video, args.ultimo)
            return 0
        if args.cmd == "borrar":
            return cmd_borrar(q, args.nombre, args.confirmar, args.carpeta or [RAIZ_PRUEBAS])
        return cmd_sesion(q, args.carpeta, args.video, args.borrar, args.ultimo)
    except ErrorAparato as e:
        print(f"[ERROR] {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
