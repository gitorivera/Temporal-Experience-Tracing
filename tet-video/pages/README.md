# TET App — Temporal Experience Tracing (compiled build)

🇬🇧 English · [🇪🇸 Español](README.es.md)

**Live app: <https://gitorivera.github.io/tet-app/>**

This repository only hosts the **compiled build** of the TET video-tracing app, served through GitHub Pages. It contains no source code and is overwritten on every release. The source lives in a separate private research repository.

## What is it?

A Progressive Web App used in a doctoral study (Universidad Tecnológica de Pereira, Colombia) comparing children's engagement in a cognitive-rehabilitation game played in mixed reality (Meta Quest) versus on a tablet. After playing, the child watches the recording of their game and traces how they felt over time, one dimension at a time (Temporal Experience Tracing, adapted from [Jachs et al., 2022](https://doi.org/10.1101/2022.03.04.482237)). The resulting traces are aligned with EEG recorded through Lab Streaming Layer.

## Using it

1. Open the link above in Chrome on an Android tablet (or any modern browser).
2. Install it: browser menu → **Install app** / **Add to Home screen**. After the first load it works **without an internet connection**.
3. As the researcher, fill in the participant code, dimensions, and load the game video and events CSV, then hand the tablet to the child.
4. At the end, download the CSV/JSON files or share them from the tablet.

## Privacy

Everything runs in the browser. Videos, traces and session data stay **on the device** (IndexedDB / local storage) and are never uploaded to any server.

## Updating

Installed copies update themselves the next time the app is opened with a connection. If a stale version appears, close and reopen the app.

## License

[MIT](LICENSE) © 2026 Jorge Rivera.
