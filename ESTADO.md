# Estado del proyecto

Última actualización: 2026-10-05.

## Fases (SPEC §12)

| Fase | Estado | Commit |
|---|---|---|
| 1. Base del proyecto (Vite, PWA sin conexión, fuentes, tokens) | Revisada | `64c08ce` Phase 1 is builded |
| 2. Lógica de datos con pruebas | Revisada | `770f3ac` phase 2 builded |
| 3. Reproductores (`VideoPlayer`, `VirtualPlayer`) | Revisada en navegador | `7ed4cdd` y «Video players working, phase 3 builded» |
| 4. Pantalla de configuración | **En curso** | — |
| 5. Pantalla de trazado | Sin empezar | — |
| 6. Pantalla final y exportaciones | Sin empezar | — |
| 7. IndexedDB y sesiones guardadas | Sin empezar | — |
| 8. Pulido para tablet | Sin empezar | — |

Pruebas: 123 de 123 pasan (`npm test`). El chequeo de tipos y el build no dan errores.

## Dónde quedamos

**La fase 3 quedó revisada (2026-10-05).** En el Mac se instaló Node.js (v26, con Homebrew), se corrieron `npm install` y `npm run dev`, y el investigador probó los reproductores en un navegador real con el banco de pruebas temporal: carga de video, práctica (40 s), grabación de ejemplo (120 s), reproducir y pausar, saltos con la barra, cambio de velocidad y aviso de fin. Todo funcionó.

**Fase 4 (pantalla de configuración): en curso.**

## Pendientes para la fase 4

- **Eliminar el banco de pruebas temporal**: `src/screens/playerLab.ts` y su llamada en `src/screens/setup.ts`. Las muestras de estilos de la fase 1 que hay en `setup.ts` también se reemplazan por el formulario real.
- Mostrar el aviso sobre la coma decimal junto al campo del CSV de eventos (ver CLAUDE.md).
- Al cargar el video, usar `loadVideo()` de `src/players/videoPlayer.ts`: ya devuelve la duración o un `VideoLoadError` con un mensaje en español.
- Al cargar los eventos, usar `parseEvents()` y `toVideoEvents()` de `src/data/events.ts`. `parseEvents()` informa cuántos eventos leyó, si encontró la fila sync y cuántas filas descartó.

## Mapa del código ya escrito

- `src/trace/trace.ts`: clase `Trace` (buffer a 10 Hz con `setRange`, `beginPass`/`sample` para grabar, cobertura) y `resample` (promedio por ventanas).
- `src/data/events.ts`: lectura del CSV de eventos, `iconFor`, sincronización (`eventToVideo`, `videoToLsl`, `toVideoEvents`).
- `src/data/export.ts`: los 4 archivos de salida (`buildAllFiles`), `fileBase`, `isoLocal`.
- `src/practice.ts`: perfil de velocidad, posición de la pelota, `practiceCorrelation`.
- `src/state.ts`: tipos `Config`, `SessionData`, `DimensionRecord`, `RawPoint` y la configuración por defecto.
- `src/players/`: la interfaz `Player`, `VideoPlayer` (con `loadVideo` y `resolveDuration`), `VirtualPlayer` y `scenes.ts` (práctica, grabación de ejemplo, `DEMO_EVENTS`).
- `src/screens/`: las tres pantallas, por ahora como marcadores de posición; además `playerLab.ts`, que es temporal.
- `tests/`: pruebas de cada módulo.
