# Temporal Experience Tracing (TET) — versión con video

[🇬🇧 English](README.md) · 🇪🇸 Español

Aplicación web progresiva (PWA), funcional sin conexión, para el **trazado de experiencia temporal (TET)** con video, desarrollada para un proyecto de doctorado de la Universidad Tecnológica de Pereira (UTP, Colombia).

El estudio compara el engagement de niños al jugar un juego gamificado de rehabilitación cognitiva en **realidad mixta (Meta Quest)** frente a **tablet**. El engagement se mide de dos formas:

- **EEG** (OpenBCI Cyton, eventos del juego por Lab Streaming Layer, LSL).
- **TET** (adaptado de Jachs et al., 2022): después de jugar, el niño ve en una tablet la grabación de su partida y traza cómo se sentía en cada momento, una dimensión a la vez.

Esta aplicación es la herramienta de trazado. Corre en una **tablet Android sin conexión a internet** y produce archivos CSV/JSON que se pueden alinear con el EEG mediante tiempos LSL.

> **App en línea:** <https://gitorivera.github.io/tet-app/> (solo la versión compilada, publicada desde el repositorio público aparte [`gitorivera/tet-app`](https://github.com/gitorivera/tet-app)).

## Características

- Pantalla de configuración del investigador: código del participante, condición, dimensiones (nombre, pregunta, etiquetas, modo trazo o deslizador), video del juego y CSV de eventos.
- Pantalla de trazado para el niño: controles grandes, grabación a 10 Hz, línea de tiempo con los eventos clave del juego y práctica con una grabación de ejemplo incluida.
- **Sincronización por tramos video ↔ LSL** con varios destellos blancos que el juego dibuja y marca con LSL; detección automática de destellos en el video y tabla de revisión.
- **Ventana de trazado**: el niño ve y traza solo desde el primer destello de sincronía hasta el último (recorte virtual; el archivo de video no cambia).
- Exportación: tres CSV y un JSON por sesión, ZIP de las sesiones guardadas y envío desde la tablet.
- Sesiones guardadas en IndexedDB; funciona sin conexión una vez instalada.
- Script auxiliar que convierte una grabación LSL `.xdf` en el CSV de eventos que lee la app.

## Estructura del repositorio

| Ruta | Contenido |
|---|---|
| [`tet-video/`](tet-video/) | La aplicación (Vite + TypeScript, pruebas, scripts). |
| [`SPEC-tet-video.md`](SPEC-tet-video.md) | Especificación completa. |
| [`GAME-SPECS.md`](GAME-SPECS.md) | Lo que debe hacer el juego (destellos, marcadores, nombres de eventos) para poder sincronizar las trazas. |
| [`ESTADO.md`](ESTADO.md) | Estado actual del proyecto y pendientes. |
| [`CLAUDE.md`](CLAUDE.md) | Notas de trabajo y cambios al SPEC autorizados por el investigador. |
| [`reference/prototype.html`](reference/prototype.html) | Prototipo de un solo archivo, solo como referencia de comportamiento. |
| [`test_files/`](test_files/) | Una grabación real de la Quest, su XDF y su CSV de eventos, para pruebas. |

## Primeros pasos

Requiere **Node.js 20 o posterior** (se desarrolló con Node 24 LTS). Dentro de `tet-video/`:

```bash
npm install        # solo la primera vez
npm run dev        # servidor de desarrollo (sin service worker)
npm test           # Vitest
npm run build      # tsc + vite build + service worker
npm run preview    # sirve dist/ (con service worker)
```

Convertir una grabación XDF en el CSV de eventos (Python 3 con `pyxdf`):

```bash
python scripts/xdf_a_eventos.py ../test_files/<archivo>.xdf -o eventos.csv
python -m unittest discover -s scripts -p "test_*.py"
```

Publicar la app compilada en GitHub Pages (exige que no haya cambios sin commit y acceso SSH):

```bash
bash scripts/deploy-pages.sh
```

## Tecnologías

Vite 8, TypeScript (modo estricto), `vite-plugin-pwa`, Vitest. Dependencias de ejecución: solo [`idb`](https://github.com/jakearchibald/idb) y [`fflate`](https://github.com/101arrowz/fflate). Las fuentes (Baloo 2, Nunito, OFL) se sirven localmente.

## Estado

Las fases 1 a 10 están construidas y revisadas; faltan la prueba en la tablet real y el piloto con niños. Ver [`ESTADO.md`](ESTADO.md).

## Idioma

La interfaz de la app, los comentarios del código y los documentos del proyecto están en español; este README se ofrece en inglés y en español.

## Referencia

Jachs, B., Camino Garcia, M., Canales-Johnson, A., & Bekinschtein, T. A. (2022). *Drawing the experience dynamics of meditation*. bioRxiv. https://doi.org/10.1101/2022.03.04.482237

## Licencia

[MIT](LICENSE) © 2026 Jorge Rivera.
