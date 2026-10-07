# Estado del proyecto

Última actualización: 2026-10-07 (cierre del día).

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
| 9. Sincronización por tramos (lógica y script XDF) | Revisada | `9ec5693` Phase 9 builded, piecewise LSL sync and XDF script tested with a real RM recording |
| 10. Detección de destellos y tabla de revisión | Revisada (la detección funcionó bien con la grabación real) | `110ec08` Phase 10 built: automatic sync flash detection works on a real RM recording |
| 10b. Ventana de trazado (recorte virtual, SPEC §16.8) | Revisada (decisiones aceptadas) | `4b5964b` Video length adjusted to avoid off game experience tracing |
| 10c. Eventos que ve el niño y arreglo de las filas de dimensiones | Revisada (todo funcionó bien) | Child timeline shows only hit combos, prizes and level starts; dimension rows fit the card |

Pruebas: 247 de 247 pasan (`npm test`); las 11 del script Python también (`python -m unittest discover -s scripts -p "test_*.py"`). El chequeo de tipos y el build no dan errores.

Las decisiones aceptadas de las fases 2, 4, 5, 6 y 7 están en CLAUDE.md. Las de la fase 10 también.

Entorno: en el Mac del investigador, Node.js v26 instalado con Homebrew (`/opt/homebrew/bin`). Para retomar: dentro de `tet-video/`, `npm run dev` (el servidor no queda corriendo entre sesiones).

## Dónde quedamos (para empezar la próxima sesión)

### Para retomar (2026-10-08)

**Estado al cierre del 2026-10-07:** todo lo construido está revisado por el investigador y tiene commit (el último: «Child timeline shows only hit combos, prizes and level starts; dimension rows fit the card»). No hay cambios pendientes de revisión. Hoy se hicieron: la fase 9 (sincronización por tramos y script XDF → CSV), la prueba con la grabación real de RM, la fase 10 (detección de destellos y tabla de revisión), la ventana de trazado (recorte virtual), el filtro de eventos que ve el niño y el arreglo de las filas de dimensiones.

**Para probar rápido en este computador:** dentro de `tet-video/`, `npm run dev` y cargar `../test_files/RM.mp4` con el CSV que genera `python scripts/xdf_a_eventos.py ../test_files/sub-P001_ses-S001_task-Default_run-001_beh.xdf -o eventos.csv`. Debe decir «Se encontraron los 4 destellos» (V = 7,127; 67,143; 127,142 y 151,067 s), «de 7,13 s a 151,03 s del video» y «El niño verá 60 en la línea de tiempo». Ojo: `npm run dev` ya incluye `--host`; al detener el servidor desde Claude Code, cerrar también el proceso de Vite que queda escuchando (pasó el 2026-10-07 con los puertos 5173 y 5174).

**Etapas que faltan** (en el orden sugerido):

1. **Publicar la versión actual en GitHub Pages.** La publicada en https://gitorivera.github.io/tet-app/ es la del commit `67840db` (fase 8): no tiene la sincronización por tramos, la detección de destellos, la ventana ni el filtro de eventos. Se publica con `bash scripts/deploy-pages.sh` dentro de `tet-video/` (exige no tener cambios sin commit). Es lo primero, porque la prueba en la tablet se hace desde ahí.
2. **Fase 8, prueba en la tablet Android** (ver «Fase 8: lo que falta»): instalar como app, sin conexión, el tacto en ambos modos, la rotación, un MP4 y un WebM, un video muy corto y uno muy largo, y abrir los CSV. Ahora también: que la detección de destellos a 4× sea rápida en la tablet (en el computador, 50 s para 167 s de video), que el visor cuadro a cuadro y el marcado del recuadro funcionen con el dedo, y que la ventana de trazado arranque y termine bien.
3. **Fase 11, más grabaciones reales de la Quest:** una partida completa de unos 5 minutos (6 o 7 destellos) para confirmar la detección, ver si aparece deriva o saltos en grabaciones más largas y ajustar los umbrales si hace falta (blanco > 220, racha > 80 %, 0,1 a 0,8 s, tolerancia del emparejamiento). Conviene probar también con poca luz y con escenas muy blancas.
4. **Con el casco EEG operativo:** grabar en LabRecorder el EEG y `JuegoEventos` juntos y comprobar con `pyxdf` que quedan en el mismo reloj (GAME-SPECS §8, punto 1). Hoy solo se probó el stream de marcadores.
5. **Lista de comprobación antes del piloto** (GAME-SPECS §8): con los puntos 2 a 5 ya vistos en la prueba de RM y el 6 cubierto por la fase 10, quedan el 1 (EEG) y repetirla completa con el montaje final.
6. **Versión de tablet del juego** (condición «Tablet»): aún no existe. GAME-SPECS §6.2 tiene las recomendaciones (grabación de pantalla, el mismo destello arriba al centro). Cuando exista, probar la detección con esa grabación.
7. **Piloto con niños.**

Fuera del diseño actual (SPEC §15, por ahora): transmitir el trazo por LSL en tiempo real, grabar el video dentro de la app, y cuentas o sincronización con un servidor. El análisis posterior (buscar en el EEG los patrones que correspondan a las trazas) no está especificado: los archivos de TET ya traen `tiempo_lsl_s` para hacerlo.

### Eventos que ve el niño y filas de dimensiones (2026-10-07): revisado

**Eventos.** Pedido del investigador: la línea de tiempo se veía muy cargada (139 eventos en 2,4 min). Decidió mostrar al niño solo los combos de 3 aciertos, marcados en el tercero (`acierto objetivo 3`), los premios y los inicios de partida y de nivel. Se descartó la regla «tres aciertos seguidos» porque en la grabación de prueba un tablero se agotó por tiempo (1, 2 y otra vez 1; el `board_timeout` solo va en `ColorQuestMarkers`) y habría dado un combo falso. Es solo visual: el JSON guarda todos los eventos.
- `childEvents` en `src/data/events.ts` (con pruebas). Se aplica en `tracing.ts` solo con un video real (la grabación de ejemplo no se filtra). La configuración dice cuántos verá el niño: «El niño verá 60 en la línea de tiempo…».
- En el navegador, con `RM.mp4`: 60 de 139 (27 combos, 27 premios y 6 inicios), sin errores en la consola.
- Observación: en este juego cada premio cae en el mismo instante que su combo, así que el 🎁 tapa la ⭐ y en la práctica solo se ve el regalo (una marca por combo).
- GAME-SPECS §5 dice ahora qué ve el niño y pide conservar el número de objetivo en la etiqueta del acierto.

**Filas de dimensiones.** En la configuración, las filas de cada dimensión se salían del borde derecho de la tarjeta. Causa: un `<fieldset>` no se encoge por debajo de su contenido (`min-width: min-content`), y el ancho propio de cada `<input>` impedía que las columnas `1fr` se encogieran (por eso «Pregunta», que debe ser el doble de ancha, salía igual que las demás). Arreglo en `styles.css`: `min-width: 0` en `.dim-row`, columnas `minmax(0, …)` e inputs al 100 %. En el ancho angosto (≤ 760 px), nombre y pregunta van a todo el ancho y las dos etiquetas lado a lado (antes «Etiqueta superior» quedaba sola). Comprobado en modo oscuro a 1000 y 700 px: ninguna fila sobresale.

### Ventana de trazado (2026-10-07): revisada

Pedido del investigador: que el niño no pueda trazar antes de que llegue la señal de sincronía y empiece el juego, y que no haya trazo después del último cuadro del video. Se le explicó que recortar el archivo en la página no conviene (recodificar es lento en la tablet y altera los tiempos de los cuadros). Eligió: **recorte virtual**; el fin, en el **destello del último sync** (fin de la partida); y en los CSV, **solo las filas de la ventana**. Escrito en SPEC §16.8 y en CLAUDE.md (cambio 7).

Archivos nuevos: `src/data/window.ts` (`traceWindow`, `eventsInWindow`) y `src/players/windowedPlayer.ts` (`WindowedPlayer`: envuelve el reproductor y muestra [inicio, fin] en tiempo local, así que la pantalla de trazado no cambió), con pruebas en `tests/window.test.ts`. Cambios: `flashScan.ts` (`lastFrameEnd`: mide el final real del último cuadro), `flashReview.ts` (`videoEnd()`), `setup.ts` (calcula y muestra la ventana; entrega el reproductor recortado), `state.ts` (`SessionPlan.ventana`, `SessionData.ventana`), `tracing.ts` (eventos en tiempo de la ventana; guarda la ventana), `export.ts` (desfase en los 3 CSV y en el JSON; `ventana` e `inicio_s`) y `done.ts` (línea «Ventana de trazado»).

Decisiones tomadas (aceptadas por el investigador):
- Los extremos salen de pasar la primera y la última fila sync por la sincronización: valen aunque falte algún destello. Con una sola fila sync, el fin es el final del video; sin filas sync o con la grabación de ejemplo, el video completo.
- La duración de la ventana se recorta a un múltiplo de 0,1 s (el fin se adelanta menos de 0,1 s), para que la última fila a 10 Hz caiga justo en el fin (sin la muestra vacía que quedaba después) y la cobertura llegue a 1,0.
- El final del último cuadro solo se mide cuando hay detección de destellos (el `<video>` de la tarjeta está en la página). Sin CSV con sync, se usa la duración del navegador (en `RM.mp4`, 167,044 s por el audio, frente a 167,005 s del video).
- Los eventos se siguen exportando en tiempo del video (todos los que caen en el video); la pantalla del niño muestra solo los de la ventana.
- En el JSON, `trazo_crudo.t` pasa a tiempo del video (antes, desde 0 del video, que era lo mismo).

Pruebas: 244 de 244 en Vitest (18 nuevas: ventana, eventos, `WindowedPlayer` con reloj falso, exportación con ventana). En el navegador con `RM.mp4` y su CSV, a 2×: la configuración muestra «de 7,13 s a 151,03 s del video (2:23)»; antes de «Empezar» el video está en 7,127; la pasada se detiene en 151,027 y queda en pausa; el CSV a 10 Hz tiene 1440 filas por dimensión, de 7,127 s (LSL 4689,153) a 151,027 s (LSL 4833,069), la última con valor; el JSON trae `ventana` {7,127; 151,027}, `inicio_s` 7,127, `duracion_s` 143,9 y cobertura 1; la pantalla final muestra la ventana. La consola no mostró errores.

Observación para el investigador: con 139 eventos en 2,4 min (cada acierto con su premio), la línea de iconos y las marcas de la gráfica se ven muy cargadas. Podría convenir mostrar al niño solo algunos tipos de evento (no se ha tocado).

### Fase 10 (2026-10-07): revisada

Archivos nuevos: `src/data/flash.ts` (cálculo, con pruebas en `tests/flash.test.ts`), `src/players/flashScan.ts` (recorrido del video en el navegador y visor cuadro a cuadro) y `src/screens/flashReview.ts` (tarjeta «Destellos de sincronización»). Cambios: `setup.ts` (monta la tarjeta y usa sus puntos), `state.ts` y `config.ts` (`recuadroDestello` en la configuración recordada) y `styles.css`.

**Cómo funciona (SPEC §16.4 reescrito):**
- Al tener el video y un CSV con filas sync, la tarjeta aparece y la detección arranca sola, como dice el SPEC. Hay barra de progreso y «Cancelar». Mientras se recorre a 4×, un `<video>` propio y sin sonido se ve pequeño en la tarjeta.
- **Recorrido:** cada cuadro se reduce a 240 px de ancho y se anotan los pulsos de cada píxel: el píxel pasa a blanco casi puro (canal mínimo > 220) y vuelve en 0,1 a 0,8 s. No se guardan los cuadros, solo los pulsos.
- **Ubicación del recuadro:** el primer intento usaba un umbral de pulsos por píxel y falló con el video real, porque las paredes blancas, al mover la cabeza, también acumulan pulsos y se unían con el destello. Lo que sí sirve: en un destello, **todos los píxeles del cuadrado empiezan su pulso en el mismo cuadro** y forman un bloque lleno y cuadrado. Se buscan esos bloques en cada cuadro, se juntan los que se repiten en el mismo lugar y se elige la zona cuyos destellos mejor coinciden con los sync (puntaje: emparejados − 0,5 × sobrantes). En la grabación real es la única zona con más de un destello.
- **Recuadro recordado:** se prueba primero el de la configuración (`localStorage`); se usa si empareja al menos tantos destellos como el automático.
- **Emparejamiento con los sync (`matchFlashes`):** no se hace solo por orden. Prueba cada par destello–sync como ancla y busca cada sync donde debería estar, con una tolerancia de 0,5 s más el 0,5 % de la distancia, por la deriva. Un destello que falta queda como «falta» sin correr a los demás; uno de más se ignora.
- **Refinamiento:** alrededor de cada destello se reproduce a 0,5× (±0,5 s) y se mide el recuadro en cada cuadro. V es el `mediaTime` del primer cuadro con más del 80 % de blanco en el interior.
- **Tabla (§16.5):** punto, LSL, video (con «aprox.» si no se pudo precisar y «a mano» si se marcó a mano), diferencia de intervalo y ritmo respecto al punto anterior incluido, y los botones «Ver»/«Marcar» y «Quitar»/«Incluir». Debajo van la línea de calidad (verde o roja) y la elección «Sincronizar con: todos los destellos, por tramos / solo el primero».
- **Visor:** muestra el cuadro con el recuadro punteado. Tiene −1 s, ◀ cuadro, cuadro ▶ y +1 s; «Usar este cuadro para sync_k» (origen manual) y «Marcar el recuadro tocándolo» (zona blanca alrededor del toque; si el recorrido ya se hizo, empareja sin volver a recorrer el video). Los pasos de cuadro respetan la duración variable de los cuadros: hacia atrás se salta justo antes del cuadro; hacia adelante se usa el cuadro siguiente ya conocido (del refinamiento o de pasos previos) o se tantea con pasos finos.
- **Comenzar:** no se puede mientras la detección sigue en curso, ni si, por tramos, alguna diferencia de intervalo supera 0,5 s; el mensaje remite a la tarjeta. Con «Solo el primero» siempre se puede comenzar.

**Decisiones tomadas (aceptadas sin objeción; resumidas en CLAUDE.md):**
1. La detección arranca sola al tener video y CSV con sync. El SPEC lo dice así; se preguntó si prefería un botón y no hubo respuesta. «Volver a detectar» la repite.
2. El emparejamiento es por desfase (ver arriba), no estrictamente por orden como dice §16.2: así un destello perdido o uno de más no corren todo el emparejamiento.
3. Hay un botón «Quitar» por punto: un sync sin destello, o uno dudoso, se puede excluir y seguir por tramos con los demás.
4. El campo «Segundo del destello» se llena solo con el destello de la primera fila sync (redondeado a 2 decimales) y se guarda.
5. Con una sola fila sync también se detecta, solo para llenar ese campo.
6. Por tramos se exigen al menos 2 puntos incluidos; si no, se usa un solo destello.
7. Si se cambia el CSV con el mismo video, se vuelve a emparejar sin recorrer el video (8 s en vez de 50 s).

**Pruebas:**
- Vitest: 226 de 226 pasan. Las nuevas de `tests/flash.test.ts` cubren el blanco, las rachas, la ubicación con movimiento y señuelo, los cuadros salteados, el destello faltante, el emparejamiento con deriva, sobrante o faltante, el recuadro tocado y `sanitizeBox`. También se prueba el recuadro en la configuración recordada.
- Con los cuadros reales del video (OpenCV → máscaras → `flash.ts` en Node), elige el recuadro (398, 59, 69×69 px) y empareja los 4 destellos.
- **En el navegador** (Brave sin interfaz, `npm run dev`, con `test_files/RM.mp4` y su CSV):
  - La detección completa tarda 50 s para un video de 167 s (unos 90 s para 5 min) y da V = 7,127; 67,143; 127,142 y 151,067 s, igual que OpenCV. Calidad: diferencia máxima de 33 ms y residuo de 16,9 ms. Queda por tramos, con el campo del destello en 7,13 y el recuadro guardado.
  - Los pasos del visor recorren exactamente los cuadros reales (67,143 → 67,187 → 67,213 → 67,255 → 67,283).
  - Con un CSV que trae un `sync_5` de más: «4 de 5»; la fila queda como «falta» y se puede quitar.
  - Un cuadro mal elegido a mano (1 s tarde) da una diferencia de 1005 ms en rojo, y «Comenzar» no deja empezar; con «Solo el primero» sí.
  - Marcar el recuadro tocándolo encuentra los 4 sin volver a recorrer el video.
  - Al cambiar el CSV con el mismo video, vuelve a emparejar en 8 s. Al quitar el CSV, la tarjeta se oculta.
  - «Comenzar sesión» lleva a la pantalla de trazado. La consola no mostró errores.
- Arreglado durante la prueba: los pasos de cuadro del visor (el aviso del cuadro llegaba antes de pedirlo, y saltar justo al tiempo de un cuadro mostraba el anterior) y un fallo al cambiar el CSV con el mismo video (la señal de cancelación quedaba cancelada).
- Herramientas de la prueba, temporales y fuera del repositorio: `playwright-core` con el Brave instalado (`executablePath`) y el entorno de OpenCV ya descrito.

**Falta:** probarlo en la tablet Android (rendimiento del recorrido a 4× y del visor táctil) y con más grabaciones (fase 11).

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
- `src/data/sync.ts`: traducción video ↔ LSL por tramos, controles de calidad y bloque `sincronizacion` del JSON.
- `src/data/flash.ts`: detección de destellos sin DOM (máscara de blanco, rachas, pulsos por píxel, zonas, emparejamiento con los sync, recuadro tocado).
- `src/players/flashScan.ts`: `FlashVideo` (recorrido a 4×, refinamiento a 0,5×, visor cuadro a cuadro).
- `src/screens/flashReview.ts`: tarjeta «Destellos de sincronización», montada dentro de `setup.ts`.
- `src/data/window.ts`: ventana de trazado (`traceWindow`, `eventsInWindow`).
- `src/players/windowedPlayer.ts`: `WindowedPlayer`, el reproductor recortado a la ventana (tiempo local).
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
