# TET App — Temporal Experience Tracing (versión compilada)

[🇬🇧 English](README.md) · 🇪🇸 Español

**App en línea: <https://gitorivera.github.io/tet-app/>**

Este repositorio solo aloja la **versión compilada** de la app de trazado TET con video, servida con GitHub Pages. No contiene código fuente y se reemplaza en cada publicación. El código fuente está en otro repositorio privado de la investigación.

## ¿Qué es?

Una aplicación web progresiva (PWA) usada en un estudio de doctorado (Universidad Tecnológica de Pereira, Colombia) que compara el engagement de niños en un juego de rehabilitación cognitiva jugado en realidad mixta (Meta Quest) frente a tablet. Después de jugar, el niño ve la grabación de su partida y traza cómo se sentía a lo largo del tiempo, una dimensión a la vez (Temporal Experience Tracing, adaptado de [Jachs et al., 2022](https://doi.org/10.1101/2022.03.04.482237)). Las trazas resultantes se alinean con el EEG registrado por Lab Streaming Layer.

## Cómo usarla

1. Abre el enlace de arriba en Chrome en una tablet Android (o en cualquier navegador moderno).
2. Instálala: menú del navegador → **Instalar app** / **Agregar a la pantalla de inicio**. Después de la primera carga funciona **sin conexión a internet**.
3. Como investigador, escribe el código del participante y las dimensiones, carga el video del juego y el CSV de eventos, y entrega la tablet al niño.
4. Al final, descarga los archivos CSV/JSON o compártelos desde la tablet.

## Privacidad

Todo se ejecuta en el navegador. Los videos, las trazas y los datos de sesión se quedan **en el dispositivo** (IndexedDB / almacenamiento local) y nunca se suben a ningún servidor.

## Actualizaciones

Las copias instaladas se actualizan solas la próxima vez que se abre la app con conexión. Si aparece una versión vieja, cierra y vuelve a abrir la app.

## Licencia

[MIT](LICENSE) © 2026 Jorge Rivera.
