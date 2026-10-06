# Estado del proyecto

Última actualización: 2026-10-06.

## Fases (SPEC §12)

| Fase | Estado | Commit |
|---|---|---|
| 1. Base del proyecto (Vite, PWA sin conexión, fuentes, tokens) | Revisada | `64c08ce` Phase 1 is builded |
| 2. Lógica de datos con pruebas | Revisada | `770f3ac` phase 2 builded |
| 3. Reproductores (`VideoPlayer`, `VirtualPlayer`) | Revisada en navegador | `7ed4cdd` y `fa1ad7a` Video players working, phase 3 builded |
| 4. Pantalla de configuración | Revisada | `68cae27` Phase 4 builded, configuration is ready |
| 5. Pantalla de trazado | Revisada | `260975d` Phase 5 builded, raw dimensions adquired |
| 6. Pantalla final y exportaciones | Revisada | `409ace7` traces ready, download buttons ready, no multiple downloads enabled |
| 7. IndexedDB y sesiones guardadas | Revisada | `5e4a962` Phase 7 ready, persistent saving and config table; arreglo de «Compartir»: Sharing files enabled |
| 8. Pulido para tablet | **En curso** | — |

Pruebas: 181 de 181 pasan (`npm test`). El chequeo de tipos y el build no dan errores.

Las decisiones aceptadas de las fases 2, 4, 5, 6 y 7 están en CLAUDE.md.

Entorno: en el Mac del investigador, Node.js v26 instalado con Homebrew (`/opt/homebrew/bin`). Para retomar: dentro de `tet-video/`, `npm run dev` (el servidor no queda corriendo entre sesiones).

## Dónde quedamos (para empezar la próxima sesión)

**Arreglo de «Compartir» confirmado (2026-10-06):** el investigador compartió los CSV por AirDrop desde su MacBook. Se empieza la fase 8.

### Historia del fallo de «Compartir» (2026-10-05)

- **Primer intento:** en la MacBook del investigador, «Compartir los 4 archivos» de la pantalla final mostró «No se pudo compartir». Causa probable: Chrome y los navegadores basados en él solo permiten compartir ciertos tipos (los `.csv` sí, los `.json` no), y el envío es todo o nada; además, el tipo `;charset=utf-8` puede no reconocerse. Arreglo: «Compartir» envía solo los 3 CSV, con el tipo `text/csv` sin parámetros, y el JSON se descarga con su botón. El aviso muestra ahora el motivo técnico.
- **Segundo intento:** el aviso mostró `InvalidStateError: An earlier share has not yet completed`, es decir, se pidió un envío mientras otro seguía abierto (doble toque, o el menú de macOS quedó abierto detrás de la ventana). Arreglo: `shareFiles` no lanza un segundo envío mientras el primero no termina y devuelve `'compartido' | 'cancelado' | 'ocupado'`. El botón se deshabilita durante el envío y, si está ocupado, el aviso explica que hay que cerrar o terminar el menú abierto. Tiene pruebas en `tests/download.test.ts`.
- Nota: el ZIP («Exportar todas las sesiones») no tuvo ningún fallo. La confusión inicial fue sobre cuál botón falló.

### Revisión de la fase 7 (hecha)

El investigador confirmó que las sesiones se guardan, que la tabla se ve bien y que la frase de la correlación aparece.

Pruebas previas: se comprobó en Brave sin interfaz el criterio de aceptación del SPEC §14: en una sesión de 3 dimensiones se respondieron 2 y se recargó la pestaña. La sesión apareció en la tabla como «Incompleta (2 de 3 dimensiones)», y su `_10hz.csv` trae 1201 filas de cada una de las 2 dimensiones. También se probaron el ZIP (una carpeta con los 4 archivos) y «Borrar» con dos toques. La consola no mostró errores.

Lo que se revisó:

1. Hacer una sesión y, a mitad, recargar o cerrar la pestaña. Al volver, la tabla «Sesiones guardadas en este dispositivo» la muestra como incompleta, con sus dimensiones descargables.
2. Terminar una sesión: la pantalla final dice «Sesión guardada en este dispositivo», y «Nueva sesión» ya no pide confirmación.
3. En la tabla: participante (con «(ejemplo)» si se usó la grabación de ejemplo), condición, fecha, estado, los 4 botones de descarga, «Compartir» si el navegador lo permite y «Borrar», que pide un segundo toque.
4. «Exportar todas las sesiones (ZIP)»: una carpeta por sesión con sus 4 archivos.
5. El aviso sobre el almacenamiento persistente. En el navegador sin interfaz se negó; en Android, con la app instalada, Chrome suele concederlo.

## Decisiones de la fase 7 (aceptadas sin objeción; resumidas en CLAUDE.md)

- **Qué se guarda y cuándo:** la sesión entera se guarda (upsert por `id = inicio_participante`) al terminar la práctica y al terminar cada dimensión. Si se interrumpe tras la práctica, aparece como «Incompleta (0 de N)», con la práctica en el CSV a 10 Hz y en el de toques.
- **Una sesión es completa** cuando tiene todas las dimensiones planeadas. Se guarda también cuántas había planeadas, para mostrar «2 de 4».
- **Si falla el guardado** (p. ej., modo privado), el niño no se entera. La pantalla final lo avisa en rojo, abre la sección del investigador y «Nueva sesión» vuelve a pedir confirmación.
- **Nombres repetidos en el ZIP:** si dos sesiones dan el mismo nombre base (mismo participante en el mismo minuto), la carpeta de la segunda lleva «_2».
- Los archivos de la tabla se generan al tocar el botón, no al abrir la pantalla.
- No se agregó ninguna dependencia: `idb` y `fflate` ya estaban. La parte pura del almacenamiento tiene pruebas. Las llamadas a IndexedDB se probaron en el navegador, no con Vitest: probarlas ahí exigiría `fake-indexeddb`.

## Mapa del código ya escrito

- `src/trace/trace.ts`: clase `Trace` (buffer a 10 Hz con `setRange`, `beginPass`/`sample` para grabar, cobertura) y `resample` (promedio por ventanas).
- `src/trace/recorder.ts`: `DimensionRecorder`, el estado de una dimensión en la pantalla de trazado (espera, grabando, terminada; valor, trazo crudo, toques, pasadas, saltos, interrupción, comprobación de «Listo» y `toRecord`). Sin DOM, con pruebas.
- `src/trace/render.ts`: geometría compartida por la gráfica, la línea de tiempo y el deslizador (con pruebas) y su dibujo en canvas (`drawGraph`, `drawTimeline`, `drawMini`, `fitCanvas`, `readPalette`).
- `src/data/events.ts`: lectura del CSV de eventos, `iconFor`, sincronización (`eventToVideo`, `videoToLsl`, `toVideoEvents`).
- `src/data/export.ts`: los 4 archivos de salida (`buildAllFiles`), `fileBase`, `isoLocal`.
- `src/data/download.ts`: `downloadFile`, `downloadBlob`, `shareableFiles` (solo los CSV), `canShareFiles`, `shareFiles` (un envío a la vez; devuelve `compartido`/`cancelado`/`ocupado`), `shareErrorMessage`.
- `src/data/storage.ts`: IndexedDB con `idb` (`putSession`, `getSession`, `listSessions`, `deleteSession`), `requestPersistence`, y la parte pura con pruebas (`sessionId`, `toStored`, `sortSessions`, `estadoTexto`, `buildZip`, `zipName`).
- `src/practice.ts`: perfil de velocidad, posición de la pelota, `practiceCorrelation`.
- `src/summary.ts`: filas de la tabla final y la frase de la correlación de la práctica.
- `src/config.ts`: recordar la configuración, `validateConfig` y el orden de dimensiones. Sin DOM, con pruebas.
- `src/state.ts`: tipos, configuración por defecto, `SessionPlan` (`setPlan`/`takePlan`: de la configuración al trazado) y `FinishedSession` (`setFinished`/`takeFinished`: del trazado a la pantalla final, con la promesa del último guardado).
- `src/players/`: la interfaz `Player`, `VideoPlayer` (con `loadVideo` y `resolveDuration`), `VirtualPlayer` y `scenes.ts` (práctica, grabación de ejemplo, `DEMO_EVENTS`).
- `src/screens/`: `setup.ts` (formulario), `savedSessions.ts` (tabla de sesiones guardadas, montada dentro de `setup.ts`), `tracing.ts` (pantalla del niño; guarda tras cada dimensión) y `done.ts` (pantalla final).
- `tests/`: pruebas de cada módulo.

## Para la fase 8

- Pantalla completa y orientación horizontal al iniciar la sesión (desde el gesto de «Comenzar sesión»), y Screen Wake Lock durante la sesión, pidiéndolo de nuevo al volver de segundo plano (SPEC §7.9).
- Prueba en la tablet Android real, instalada como app: sin conexión, tacto, rotación, video MP4 y WebM de MediaRecorder, video muy corto (< 5 s) y muy largo (> 30 min).
- Revisión de accesibilidad y de `prefers-reduced-motion`.
- Pendiente de decidir: alguna forma, solo para el investigador, de salir a mitad de la sesión.
