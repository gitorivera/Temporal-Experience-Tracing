# Estado del proyecto

Última actualización: 2026-10-07.

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
| 8. Pulido para tablet | Construida; falta la prueba en la tablet real | Phase 8 ready, app created |
| 9. Sincronización por tramos (lógica y script XDF) | Construida; espera revisión | `9edcb8f` first changes for tet-app LSL syncronization (más los ajustes del 2026-10-07, sin commit) |

Pruebas: 206 de 206 pasan (`npm test`); las 11 del script Python también (`python -m unittest discover -s scripts -p "test_*.py"`). El chequeo de tipos y el build no dan errores.

Las decisiones aceptadas de las fases 2, 4, 5, 6 y 7 están en CLAUDE.md.

Entorno: en el Mac del investigador, Node.js v26 instalado con Homebrew (`/opt/homebrew/bin`). Para retomar: dentro de `tet-video/`, `npm run dev` (el servidor no queda corriendo entre sesiones).

## Dónde quedamos (para empezar la próxima sesión)

### Para retomar (2026-10-07)

1. **Esperando la revisión y el mensaje de commit del investigador** para la fase 9 y los cambios de hoy. Nada de lo de hoy tiene commit.
2. **Siguiente: fase 10**, con el método de detección nuevo del SPEC §16.4 (recuadro fijo del destello; ver «Decisiones del 2026-10-07»). Probarla con `test_files/RM.mp4`: debe dar V = 7,127; 67,143; 127,142 y 151,067 s (±1 cuadro).
3. Sigue pendiente la prueba en la tablet Android (ver «Fase 8: lo que falta»).
4. Más adelante: grabaciones de partidas completas (unos 5 min) y con el casco EEG, para la fase 11.

### Decisiones del 2026-10-07 (investigador)

- **Método de detección cambiado** (SPEC §16.4 reescrito; también la línea de la fase 10 en §16.7). En vez de la cuadrícula de 8×6: (1) ubicar el recuadro del destello, automáticamente (píxeles que pasan a blanco casi puro durante 0,1 a 0,8 s, zona compacta y cuadrada cuyos pulsos coinciden con los `sync`) o tocándolo en el visor; (2) medir en cada cuadro la fracción de blanco dentro del recuadro (racha > 0,8 durante 0,1 a 0,8 s); (3) refinar cuadro por cuadro. Tiempos por `mediaTime`, nunca por número de cuadro ÷ fps, porque el video tiene duración de cuadro variable. El recuadro se recuerda en `localStorage`, en coordenadas relativas.
- **Stream del XDF: `JuegoEventos`.** `xdf_a_eventos.py` lo usa por omisión e ignora los demás, como `ColorQuestMarkers`. `--stream` permite elegir otro. GAME-SPECS §7 actualizado. 11 pruebas del script pasan.
- **`test_files/` no se sube:** agregada al `.gitignore` nuevo de la raíz. Es solo para nuestras pruebas: `RM.mp4` y `sub-P001_ses-S001_task-Default_run-001_beh.xdf`.

### Herramientas usadas en la prueba (no son parte del proyecto)

El análisis del video se hizo con OpenCV (`opencv-python-headless`) en un entorno virtual temporal, fuera del repositorio. Si hace falta repetirlo, se recrea con `python -m venv venv` y `venv/Scripts/python -m pip install opencv-python-headless numpy`. La idea es leer cada cuadro con `cv2.VideoCapture`, tomar su tiempo con `CAP_PROP_POS_MSEC` y medir el blanco en el recuadro (399, 58, 70×70). La calidad se calculó con `src/data/sync.ts` corriendo en Node 24, que ejecuta TypeScript sin compilar.

### Prueba con una grabación real de RM (2026-10-07, sin EEG)

Archivos en `test_files/` (sin commit): `RM.mp4` (Meta Horizon, 832×464, 167 s, unos 30 fps con duración de cuadro variable de 10 a 45 ms) y el XDF de LabRecorder con dos streams de marcadores, `JuegoEventos` (143 filas, 4 `sync`) y `ColorQuestMarkers` (detallado). La partida dura 144 s: `sync_1` al iniciar, `sync_2` y `sync_3` cada 60 s y `sync_4` al final.

- **Destellos en el video:** cuadrado blanco de 70×70 px fijo en (399, 58), el 8 % del ancho del cuadro. Midiendo el blanco dentro de ese recuadro aparecen exactamente 4 destellos de 9 o 10 cuadros (unos 300 ms), sin falsos positivos: V = 7,127; 67,143; 127,142 y 151,067 s.
- **Calidad con `sync.ts`:** diferencias de intervalo de +15,9, +0,3 y −32,3 ms; ritmo de 0,99974, 0,99999 y 1,00135; residuo de la recta de 16,5 ms. Con un solo destello, el error en los demás es de 16 ms o menos, es decir, menos de un cuadro. **Esta grabación no tiene deriva ni saltos medibles.**
- **La cuadrícula de 8×6 de §16.4 no sirve con este video:** el destello ocupa una fracción pequeña de cada celda, y el movimiento de la cabeza y las esferas producen muchas subidas de brillo más grandes. El investigador aprobó cambiar el método (ver «Decisiones del 2026-10-07»).
- **`xdf_a_eventos.py` con el XDF real:** exporta las 143 filas de `JuegoEventos` (ahora sin necesidad de `--stream`). Sin `--stream`, en Windows terminaba con un traceback (`EOFError`) porque la entrada redirigida a `NUL` cuenta como terminal. Arreglado: ahora termina con el mensaje que pide `--stream`. Tiene prueba.

### Fase 9 (2026-10-07): construida, espera revisión

Lo hecho en el commit `9edcb8f` y comprobado el 2026-10-07:

- `src/data/sync.ts` (nuevo): `SyncPoint`, traducción lineal por tramos en ambos sentidos (`videoToLsl`, `lslToVideo`), extensión del primer y último tramo, `syncQuality` (ritmo por tramo, diferencia de intervalo con límite 0,5 s, residuo de la recta global), `syncJson` (bloque §16.6). Las sesiones guardadas antes de la v2 (sin `puntos`) siguen funcionando como un punto. Si los puntos son incoherentes, se cae al primer punto para que una sesión guardada siempre se pueda exportar.
- `events.ts` devuelve todas las filas sync (`syncs`); `export.ts` usa `syncJson`; la pantalla final describe el modelo usado. La configuración sigue con un solo destello (el campo actual) y avisa si el CSV trae varios: la detección y la tabla de revisión son la fase 10.
- `scripts/xdf_a_eventos.py` y sus pruebas.

Ajustes del 2026-10-07 (sin commit):

- `syncQuality` marcaba como válidos dos `sync` con el mismo tiempo LSL (marcador repetido), mientras que el modelo los rechazaba y caía en silencio a un solo punto. Ahora los dos usan el mismo criterio. Tiene prueba.
- Prueba nueva: la app lee el CSV que escribe el script (etiqueta con coma entre comillas, CRLF).
- El script se probó con `pyxdf` 1.17.5 real sobre un XDF de prueba hecho a mano (un stream EEG y uno de marcadores): eligió solo el de marcadores, ordenó las filas y contó 3 sync. Falta probarlo con un XDF real de LabRecorder.


**Primera versión terminada (2026-10-06), commit «First version finished, need for LSL timing».** Las 8 fases están construidas y la app está publicada en https://gitorivera.github.io/tet-app/.

### Sincronización con varios destellos (v2): especificación aprobada

Contexto dado por el investigador (2026-10-06):
- El EEG y los eventos del juego van por LSL a un computador que los registra. Después de cada partida, el niño traza en TET mientras ve el video de su partida. Luego se buscan en el EEG patrones que correspondan a las trazas.
- El video de la Quest se graba con el celular, con la app Meta Horizon (transmisión). La versión de tablet del juego aún no existe.
- La partida típica dura unos 5 minutos. El juego puede mostrar un destello y enviar el marcador LSL en el mismo cuadro, y el jugador pulsa un botón «Iniciar partida» que puede disparar el primer destello.

Documentos escritos (commit «Specifications for game and tet app syncroniztion created»):
- **`GAME-SPECS.md`** (nuevo, pedido por el investigador): cambios recomendados en el juego. Destellos `sync_1` al pulsar «Iniciar partida», uno cada 60 s y uno al final; 300 ms; cuadrado blanco con marco negro, fijo a la cabeza y arriba del centro (no en una esquina, por el recorte de la transmisión); marcador en el mismo cuadro; nombres de eventos; stream LSL; grabación; exportación a CSV; lista de comprobación.
- **SPEC §16** (nuevo) y una línea en §8.2: traducción video ↔ LSL **lineal por tramos** entre destellos, controles de calidad (coherencia de intervalos, ritmo por tramo, residuo de la recta global), detección automática de destellos, tabla de revisión con ajuste cuadro a cuadro, y ampliación del bloque `sincronizacion` del JSON (las columnas de los CSV no cambian). Fases nuevas 9, 10 y 11.

Siguientes pasos:

1. **Aprobado (2026-10-06):** destello cada 60 s, 300 ms, arriba del centro de la vista; el cambio del JSON de §16.6 (anotado en CLAUDE.md); y el script `scripts/xdf_a_eventos.py`, que se hace en la fase 9.
2. ~~Siguiente: fase 9~~ Hecha (ver arriba). Luego la fase 10 (detección y revisión) y la fase 11 (prueba con grabaciones reales; la primera se hizo el 2026-10-07).
3. Sigue pendiente la prueba en la tablet Android instalada desde GitHub Pages (ver «Fase 8: lo que falta»).

**Arreglo de «Compartir» confirmado (2026-10-06):** el investigador compartió los CSV por AirDrop desde su MacBook. Se empieza la fase 8.

### Fase 8 (2026-10-06): lo construido

Commit «Phase 8 ready, app created». Archivos: `src/device.ts` (nuevo), `src/screens/setup.ts`, `src/screens/tracing.ts`, `src/screens/done.ts`, `src/state.ts`, `src/styles.css`, `tests/device.test.ts` (nuevo).

- **Pantalla completa y orientación horizontal** al pulsar «Comenzar sesión» (desde el gesto del botón). Se sale de la pantalla completa al volver a la configuración. Si el navegador no puede bloquear la orientación y la tablet está vertical, la pantalla del niño muestra «Gira la tablet».
- **Pantalla encendida** con Screen Wake Lock durante la pantalla de trazado (`ScreenAwake`); se vuelve a pedir al regresar de segundo plano. Tiene pruebas.
- **Salida del investigador** (decisión del investigador: mantener pulsado): mantener pulsado 2 s el indicador «2 de 4» (o «Práctica») abre «Opciones del investigador», con «Seguir con la sesión» o «Terminar la sesión aquí». Un toque corto no hace nada. Si se abre durante una grabación, la pasada se anula (si se sigue, el niño la repite). Al terminar, la pantalla final avisa «El investigador terminó la sesión antes de tiempo: N de M dimensiones», y la sesión queda incompleta en la tabla.
- **Accesibilidad:** el deslizador tiene `role="slider"`, `aria-valuenow` (0 a 100), `aria-label` con la pregunta y `aria-disabled` fuera de la grabación. No hay animaciones; `prefers-reduced-motion` ya las desactiva todas.
- Probado en Brave sin interfaz: pantalla completa activa en la sesión y desactivada al volver; toque corto sin efecto y pulsación larga que abre la tarjeta; salida con la sesión guardada como «Incompleta (0 de 2)»; aviso de girar en vertical. La consola no mostró errores.

### Fase 8: lo que falta (necesita la tablet Android)

- **Publicación en GitHub Pages (decisión del investigador):** por `http://192.168.1.2:5173` la página no es un «contexto seguro» (sin service worker, sin instalación, sin Wake Lock), así que se publica con HTTPS. La app compilada va a un repositorio **público aparte**, `gitorivera/tet-app`, con `bash scripts/deploy-pages.sh`; el código sigue en este repositorio privado. URL: https://gitorivera.github.io/tet-app/ (el investigador debe activar Pages: Settings → Pages → Deploy from a branch → `main`, `/ (root)`).
  - 2026-10-06: primera publicación (el commit `67840db` compilado) en `gitorivera/tet-app`; Pages activado, https://gitorivera.github.io/tet-app/ responde. Para publicar una versión nueva: hacer el commit y correr `bash scripts/deploy-pages.sh` dentro de `tet-video/` (toma el autor del último commit).
- Luego, en la tablet: instalar como app, probar sin conexión, el tacto en ambos modos, la rotación, un MP4 y un WebM de MediaRecorder, un video muy corto (< 5 s) y uno muy largo (> 30 min), y abrir los CSV.
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

- Ver «Fase 8: lo que falta» más arriba.
- `src/device.ts`: `enterSessionMode`, `exitSessionMode`, `ScreenAwake`. `scripts/deploy-pages.sh`: publicación en GitHub Pages.
