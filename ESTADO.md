# Estado del proyecto

Última actualización: 2026-10-05.

## Fases (SPEC §12)

| Fase | Estado | Commit |
|---|---|---|
| 1. Base del proyecto (Vite, PWA sin conexión, fuentes, tokens) | Revisada | `64c08ce` Phase 1 is builded |
| 2. Lógica de datos con pruebas | Revisada | `770f3ac` phase 2 builded |
| 3. Reproductores (`VideoPlayer`, `VirtualPlayer`) | **Construida, pendiente de revisión en navegador** | se sube junto con este archivo |
| 4. Pantalla de configuración | Sin empezar | — |
| 5. Pantalla de trazado | Sin empezar | — |
| 6. Pantalla final y exportaciones | Sin empezar | — |
| 7. IndexedDB y sesiones guardadas | Sin empezar | — |
| 8. Pulido para tablet | Sin empezar | — |

Pruebas: 123 de 123 pasan (`npm test`). El chequeo de tipos y el build no dan errores.

## Dónde quedamos

La fase 3 está construida, pero **el investigador aún no la ha probado en un navegador real**. Siguiente paso:

1. En el computador nuevo: instalar Node.js, y dentro de `tet-video/` correr `npm install` y luego `npm run dev`.
2. Abrir la dirección que muestra Vite. La primera tarjeta, «Probar reproductores (fase 3, temporal)», permite:
   - cargar un video, o abrir la práctica (40 s) o la grabación de ejemplo (120 s);
   - reproducir y pausar, arrastrar la barra para saltar y cambiar la velocidad;
   - ver el tiempo, los saltos y el aviso de fin.
3. Probar con un MP4 y con un WebM grabado con MediaRecorder (duración `Infinity`), a ser posible en la tablet Android.
4. Si todo está bien, el investigador hace el commit de la fase 3 (o pide que se haga) y se pasa a la fase 4.

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
