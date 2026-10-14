# Temporal Experience Tracing (TET) — video version

🇬🇧 English · [🇪🇸 Español](README.es.md)

An offline-capable Progressive Web App (PWA) for **Temporal Experience Tracing** with video, built for a doctoral research project at the Universidad Tecnológica de Pereira (UTP, Colombia).

The study compares children's engagement while playing a gamified cognitive-rehabilitation game in **mixed reality (Meta Quest)** versus on a **tablet**. Engagement is measured in two ways:

- **EEG** (OpenBCI Cyton, game events over Lab Streaming Layer, LSL).
- **TET** (adapted from Jachs et al., 2022): after playing, the child watches the recording of their own game on a tablet and traces how they felt at every moment, one dimension at a time.

This app is the tracing tool. It runs on an **Android tablet with no internet connection** and produces CSV/JSON files that can be aligned with the EEG through LSL timestamps.

> **Live app:** <https://gitorivera.github.io/tet-app/> (compiled build only, published from the separate public repository [`gitorivera/tet-app`](https://github.com/gitorivera/tet-app)).

## Features

- Researcher setup screen: participant code, condition, dimensions (name, question, labels, trace or slider mode), game video and events CSV.
- Child-facing tracing screen: large controls, 10 Hz recording, timeline with the game's key events, practice round with a built-in demo recording.
- **Piecewise video ↔ LSL synchronization** using several white flashes the game draws and marks with LSL markers; automatic flash detection in the video plus a review table.
- **Tracing window**: the child only sees and traces from the first sync flash to the last one (virtual crop, the video file is untouched).
- Exports: three CSV files plus one JSON per session, ZIP of saved sessions, sharing from the tablet.
- Sessions saved in IndexedDB; works fully offline once installed.
- Helper script that converts an LSL `.xdf` recording into the events CSV the app reads.

## Repository layout

| Path | Contents |
|---|---|
| [`tet-video/`](tet-video/) | The app (Vite + TypeScript, tests, scripts). |
| [`SPEC-tet-video.md`](SPEC-tet-video.md) | Full specification (in Spanish). |
| [`GAME-SPECS.md`](GAME-SPECS.md) | What the game must do (flashes, markers, event names) so traces can be synchronized. |
| [`ESTADO.md`](ESTADO.md) | Current project status and pending work. |
| [`CLAUDE.md`](CLAUDE.md) | Working notes and researcher-approved deviations from the spec. |
| [`reference/prototype.html`](reference/prototype.html) | Single-file prototype, behavior reference only. |
| [`test_files/`](test_files/) | A real Quest recording, its XDF and events CSV, used for testing. |

## Getting started

Requires **Node.js 20+** (developed with Node 24 LTS). Inside `tet-video/`:

```bash
npm install        # first time only
npm run dev        # development server (no service worker)
npm test           # Vitest
npm run build      # tsc + vite build + service worker
npm run preview    # serves dist/ (with service worker)
```

Convert an XDF recording to the events CSV (Python 3 with `pyxdf`):

```bash
python scripts/xdf_a_eventos.py ../test_files/<file>.xdf -o eventos.csv
python -m unittest discover -s scripts -p "test_*.py"
```

Publish the compiled app to GitHub Pages (requires a clean working tree and SSH access):

```bash
bash scripts/deploy-pages.sh
```

## Tech stack

Vite 8, TypeScript (strict), `vite-plugin-pwa`, Vitest. Runtime dependencies: only [`idb`](https://github.com/jakearchibald/idb) and [`fflate`](https://github.com/101arrowz/fflate). Fonts (Baloo 2, Nunito, OFL) are served locally.

## Status

Phases 1–10 are built and reviewed; tablet field testing and the pilot with children are pending. See [`ESTADO.md`](ESTADO.md).

## Language

The app interface, code comments and project documents are in Spanish; this README is provided in English and Spanish.

## Reference

Jachs, B., Camino Garcia, M., Canales-Johnson, A., & Bekinschtein, T. A. (2022). *Drawing the experience dynamics of meditation*. bioRxiv. https://doi.org/10.1101/2022.03.04.482237

## License

[MIT](LICENSE) © 2026 Jorge Rivera.
