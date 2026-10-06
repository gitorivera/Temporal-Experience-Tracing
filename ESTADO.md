# Estado del proyecto

Última actualización: 2026-10-05.

## Fases (SPEC §12)

| Fase | Estado | Commit |
|---|---|---|
| 1. Base del proyecto (Vite, PWA sin conexión, fuentes, tokens) | Revisada | `64c08ce` Phase 1 is builded |
| 2. Lógica de datos con pruebas | Revisada | `770f3ac` phase 2 builded |
| 3. Reproductores (`VideoPlayer`, `VirtualPlayer`) | Revisada en navegador | `7ed4cdd` y `fa1ad7a` Video players working, phase 3 builded |
| 4. Pantalla de configuración | Revisada | Phase 4 builded, configuration is ready |
| 5. Pantalla de trazado | Sin empezar | — |
| 6. Pantalla final y exportaciones | Sin empezar | — |
| 7. IndexedDB y sesiones guardadas | Sin empezar | — |
| 8. Pulido para tablet | Sin empezar | — |

Pruebas: 145 de 145 pasan (`npm test`). El chequeo de tipos y el build no dan errores.

## Dónde quedamos

**Fase 3 revisada (2026-10-05).** En el Mac se instaló Node.js (v26, con Homebrew) y se corrieron `npm install` y `npm run dev`. El investigador probó los reproductores en un navegador real con el banco de pruebas temporal: carga de video, práctica (40 s), grabación de ejemplo (120 s), reproducir y pausar, saltos con la barra, cambio de velocidad y aviso de fin. Todo funcionó.

**Fase 4 revisada (2026-10-05).** El investigador comprobó en el navegador que la pantalla de configuración se ve bien y que «Comenzar sesión» lleva al marcador de la fase 5. **Siguiente paso: fase 5, la pantalla de trazado.**

Lo que se revisó:

1. Los campos del SPEC §6 con sus valores por defecto; recargar la página y comprobar que se recuerda todo menos el código del participante.
2. Cargar un video: debe mostrar nombre y duración, o un error claro (probar con un archivo que no sea video). «Quitar» vuelve a la grabación de ejemplo.
3. Cargar un CSV de eventos: cuántos eventos leyó, si encontró la fila sync, filas descartadas y, con video, cuántos caen dentro del video según el segundo del destello (cambia al editar ese campo). Probar con un CSV vacío o sin columna de tiempo.
4. El aviso sobre la coma decimal junto al campo del CSV.
5. «Comenzar sesión» sin código o sin dimensiones: lista de errores. Con todo bien: pasa a la pantalla de trazado provisional, que muestra el plan (orden de dimensiones, sincronización, número de eventos). «Volver» regresa a la configuración.

## Decisiones de la fase 4 (para que el investigador las confirme)

- La configuración se recuerda en `localStorage` (clave `tet-video:config`) y se guarda con cada cambio, no solo al comenzar. El SPEC prohíbe `localStorage` para *datos de sesión*; la configuración no lo es, y así se lee sin esperas al abrir la app. Si falta o está dañada, se usan los valores por defecto.
- Las filas de dimensión vacías se ignoran. Una fila **a medio llenar** impide comenzar (con un mensaje que la nombra), para no descartar en silencio algo que el investigador escribió. Tampoco se admiten dos dimensiones con el mismo nombre (sin distinguir mayúsculas).
- Las dimensiones se pueden subir, bajar y quitar. «Restaurar las de ejemplo» pide un segundo toque.
- Los campos numéricos aceptan punto o coma decimal. El segundo del destello se redondea a 2 decimales.
- Sin video se usa la grabación de ejemplo con sus propios eventos (`DEMO_EVENTS`) y sin sincronización (`video_s = 0`, sin LSL), como en el prototipo. Si hay un CSV cargado, la pantalla avisa que no se usará.
- Si el destello queda después del final del video se muestra un aviso, pero no impide comenzar.
- La tabla de sesiones guardadas aparece como marcador; se construye en la fase 7.

## Mapa del código ya escrito

- `src/trace/trace.ts`: clase `Trace` (buffer a 10 Hz con `setRange`, `beginPass`/`sample` para grabar, cobertura) y `resample` (promedio por ventanas).
- `src/data/events.ts`: lectura del CSV de eventos, `iconFor`, sincronización (`eventToVideo`, `videoToLsl`, `toVideoEvents`).
- `src/data/export.ts`: los 4 archivos de salida (`buildAllFiles`), `fileBase`, `isoLocal`.
- `src/practice.ts`: perfil de velocidad, posición de la pelota, `practiceCorrelation`.
- `src/config.ts`: recordar la configuración (`loadSavedConfig`, `saveConfig`, `sanitizeConfig`), `validateConfig` y el orden de dimensiones (`dimensionOrder`, `shuffled`). Sin DOM, con pruebas.
- `src/state.ts`: tipos `Config`, `SessionData`, `DimensionRecord`, `RawPoint`, la configuración por defecto y `SessionPlan` (`setPlan`/`takePlan`): lo que la configuración entrega a la pantalla de trazado, incluido el reproductor.
- `src/players/`: la interfaz `Player`, `VideoPlayer` (con `loadVideo` y `resolveDuration`), `VirtualPlayer` y `scenes.ts` (práctica, grabación de ejemplo, `DEMO_EVENTS`).
- `src/screens/setup.ts`: formulario completo de la fase 4. `tracing.ts` y `done.ts` siguen como marcadores; `tracing.ts` muestra el plan recibido y destruye el reproductor al salir.
- `tests/`: pruebas de cada módulo.

## Para la fase 5

- `mountTracing` recibe todo con `takePlan()`. Es dueño de `plan.player` y debe llamar a `destroy()` al salir. La práctica se crea aparte con `createPracticePlayer()` si `plan.config.practica`.
- Falta fijar `inicio` (`isoLocal(new Date())`) y el reloj de `ms_desde_inicio_sesion` al empezar la sesión.
