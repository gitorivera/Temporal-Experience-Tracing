# SPEC — Aplicación de trazado de experiencia con video (TET)

> **Instrucciones para Claude Code:** lee este documento completo antes de escribir código. Construye la aplicación por fases (sección 12) y detente al final de cada fase para que el investigador la revise. Si algo es ambiguo, pregunta antes de decidir. No cambies los nombres de columnas ni los formatos de archivo de la sección 8 sin autorización: otros scripts de análisis dependen de ellos.

---

## 1. Contexto

Proyecto de doctorado (Universidad Tecnológica de Pereira) que compara el engagement de niños al jugar un juego gamificado de rehabilitación cognitiva en **realidad mixta (Meta Quest)** frente a **tablet**. El engagement se mide de dos formas:

- **EEG** (OpenBCI Cyton, eventos por Lab Streaming Layer, índice de engagement en ventanas de tiempo).
- **Temporal Experience Tracing (TET)** (Jachs et al., 2022), adaptado: después de jugar, el niño ve la grabación de su partida en una tablet y traza cómo se sentía en cada momento, una dimensión a la vez.

Esta aplicación es la herramienta de trazado. Corre en una **tablet Android, sin conexión a internet**, y produce archivos CSV que se alinean con el EEG mediante tiempos LSL.

Existe un prototipo funcional en un solo archivo HTML (`reference/prototype.html`, si el investigador lo incluye). Úsalo como referencia de comportamiento, no como base de código.

## 2. Usuarios

- **Investigador:** configura la sesión, carga el video y los eventos, descarga los datos. Interfaz sobria y densa.
- **Niño (6 a 13 años):** responde las dimensiones. Interfaz grande, clara, con poco texto, botones de al menos 56 px de alto y sin elementos que distraigan.

## 3. Stack técnico

- **Vite + TypeScript**, sin framework de UI (DOM y Canvas 2D nativos). El alcance no justifica React.
- **PWA instalable y funcional sin conexión** con `vite-plugin-pwa` (service worker que precachea todos los recursos, incluidas las fuentes).
- **Almacenamiento:** IndexedDB (con la librería `idb`) para sesiones y respaldos. No usar `localStorage` para datos de sesión (límite de tamaño).
- **Pruebas:** Vitest para la lógica de datos; Playwright opcional para un flujo completo.
- **Fuentes:** Baloo 2 (títulos) y Nunito (texto), servidas localmente desde `public/fonts/`, nunca desde Google Fonts en tiempo de ejecución.
- Sin dependencias pesadas. Cada dependencia nueva debe justificarse.

## 4. Estructura del proyecto

```
tet-video/
├── index.html
├── vite.config.ts
├── src/
│   ├── main.ts                 # arranque y enrutado entre pantallas
│   ├── state.ts                # estado de la sesión
│   ├── screens/
│   │   ├── setup.ts            # pantalla del investigador
│   │   ├── tracing.ts          # pantalla del niño
│   │   └── done.ts             # fin y descargas
│   ├── players/
│   │   ├── player.ts           # interfaz común
│   │   ├── videoPlayer.ts      # envoltorio de <video>
│   │   └── virtualPlayer.ts    # reproductor de canvas (práctica y demo)
│   ├── trace/
│   │   ├── trace.ts            # buffer de 10 Hz y muestreo
│   │   └── render.ts           # dibujo de gráfica y línea de tiempo
│   ├── data/
│   │   ├── events.ts           # lectura del CSV de eventos y sincronización
│   │   ├── export.ts           # generación de CSV y JSON
│   │   └── storage.ts          # IndexedDB: sesiones y respaldos
│   ├── practice.ts             # perfil de velocidad y correlación
│   └── styles.css
├── public/fonts/
└── tests/
```

## 5. Flujo de la aplicación

```
Configuración (investigador) → [Práctica] → Dimensión 1 … Dimensión N → Fin (descargas)
```

Cada dimensión, incluida la práctica, sigue el mismo ciclo:

1. **Tarjeta de introducción** a pantalla completa con la pregunta, la instrucción y el botón "¡Vamos!".
2. **Pantalla de trazado en espera:** video en el primer cuadro, línea de tiempo navegable, punto amarillo en el valor neutro (0,5) y botón "▶ Empezar".
3. **Grabación:** al pulsar "Empezar", el video se reproduce desde 0 hasta el final **sin pausas**. La línea avanza sola con el tiempo del video y el niño controla solo la altura.
4. **Fin de la pasada:** se habilitan "↺ Repetir" y "Listo".
5. Al pulsar "Listo", la dimensión se guarda en IndexedDB y se pasa a la siguiente.

## 6. Pantalla de configuración (investigador)

Campos:

| Campo | Tipo | Valor por defecto |
|---|---|---|
| Código del participante | texto | vacío (obligatorio) |
| Condición | `RM` / `Tablet` | `RM` |
| Modo de respuesta | `trazo` (sobre la gráfica) / `deslizador` (lateral) | `trazo` |
| Velocidad de reproducción | 1× / 1,5× / 2× | 1× |
| Orden aleatorio de dimensiones | casilla | activado |
| Ensayo de práctica | casilla | activado |
| Video de la partida | archivo `video/*` | opcional (sin video, usar la grabación de ejemplo) |
| CSV de eventos | archivo `.csv`, `.tsv`, `.txt` | opcional |
| Segundo del destello de sincronización en el video | número, 2 decimales | 0 |
| Resolución de exportación (s) | número ≥ 0,1 | 1 |
| Dimensiones | lista editable | ver abajo |

Cada dimensión tiene `nombre`, `pregunta`, `etiqueta inferior` y `etiqueta superior`. Valores por defecto:

| Nombre | Pregunta | Abajo | Arriba |
|---|---|---|---|
| Diversión | ¿Cuánto te estabas divirtiendo? | Nada | Muchísimo |
| Esfuerzo | ¿Cuánto esfuerzo estabas haciendo? | Nada | Muchísimo |
| Aburrimiento | ¿Qué tan aburrido estabas? | Nada | Muchísimo |
| Pensar en otra cosa | ¿Cuánto pensabas en cosas que no eran el juego? | Nada | Muchísimo |

Requisitos:

- La configuración (salvo el código del participante) se recuerda entre sesiones.
- Al cargar el video, mostrar nombre y duración, o un error claro si no se puede leer.
- Al cargar los eventos, mostrar cuántos se leyeron y si se encontró la fila de sincronización.
- Debajo del formulario, la tabla de **sesiones guardadas** (sección 9).
- Validar antes de empezar: código de participante y al menos una dimensión completa.

## 7. Pantalla de trazado (niño)

### 7.1 Disposición (tablet en horizontal)

```
┌───────────────────────────────────────────────┬─────────┐
│ Pregunta grande                               │ 2 de 4  │
├───────────────────────────────────────────────┴─────────┤
│                 Video 16:9 (máx. 38 % del alto)         │
├──────┬──────────────────────────────────────────┬───────┤
│      │ Línea de tiempo con íconos de eventos    │       │
│ Eje  ├──────────────────────────────────────────┤ Desl. │
│  Y   │ Gráfica (área de respuesta)              │ (solo │
│      │                                          │ modo  │
│      │                                          │ desl.)│
├──────┴──────────────────────────────────────────┴───────┤
│ [▶ Empezar / ↺ Repetir]           [mensaje]   [Listo]   │
└─────────────────────────────────────────────────────────┘
```

- La línea de tiempo y la gráfica comparten exactamente el mismo ancho y origen horizontal: la posición x representa el mismo instante del video en ambas.
- El eje Y muestra la etiqueta superior arriba, la inferior abajo y círculos de tamaño creciente como escala visual sin palabras.

### 7.2 Gráfica

- Fondo con 5 líneas horizontales (0, 0,25, 0,5, 0,75, 1).
- Líneas verticales punteadas en los tiempos de los eventos (no en la práctica).
- La curva registrada, en color de acento, grosor de 6 px CSS, uniones redondeadas, cortada donde no hay datos.
- Cabezal vertical en el tiempo actual del video.
- **Punto amarillo (radio 16 px CSS)** en la posición (tiempo actual, valor actual) durante la grabación, y en (0, 0,5) antes de empezar.
- Canvas con escalado por `devicePixelRatio` y redimensionado con `ResizeObserver`.

### 7.3 Interacción en modo `trazo`

- Solo durante la grabación. Antes de "Empezar" la gráfica no responde.
- `pointerdown` en cualquier punto de la gráfica: el valor pasa a la altura del dedo (x se ignora). Contar un toque.
- `pointermove` con el dedo abajo: el valor sigue la altura del dedo.
- `pointerup` o `pointercancel`: el valor se **mantiene**; la línea sigue avanzando horizontal.
- Usar `setPointerCapture`, `touch-action: none` y `preventDefault` para evitar desplazamiento y zoom.
- Conversión: `valor = clamp(1 − (y − padding) / (alto − 2·padding), 0, 1)` con padding de 14 px.

### 7.4 Interacción en modo `deslizador`

- Deslizador vertical a la derecha de la gráfica, con un pulgar amarillo de 76 px. Mismo comportamiento: solo activo durante la grabación, el valor se mantiene al soltar.
- La gráfica no responde al tacto en este modo.

### 7.5 Línea de tiempo

- Barra con el progreso, íconos de eventos en su posición temporal y una perilla en el tiempo actual.
- **Antes de grabar**, tocar o arrastrar mueve el video (para que el niño recuerde la partida); contar cada gesto como "salto".
- **Durante la grabación** está bloqueada.

### 7.6 Grabación

Al pulsar "Empezar" (o "Repetir"):

1. Borrar el buffer de la dimensión y los toques de la pasada anterior; incrementar el contador de pasadas.
2. Pausar, ir a 0, valor = 0,5.
3. Fijar la velocidad configurada y reproducir.
4. En cada `requestAnimationFrame` mientras se reproduce: tomar el tiempo actual del video y rellenar el buffer desde el último tiempo muestreado con interpolación lineal entre el valor anterior y el actual (ver 7.7). Registrar un toque crudo cada vez que el valor cambie.
5. En `ended`: tomar una última muestra, terminar la grabación y habilitar "Repetir" y "Listo".

El tiempo de referencia es **siempre** `video.currentTime`, nunca un reloj propio, para que el trazo quede alineado con el video aunque haya tirones de reproducción.

### 7.7 Buffer de la dimensión

- Frecuencia fija `HZ = 10`. Tamaño `n = ceil(duración · HZ) + 1`. Valores iniciales `NaN`.
- `setRange(t0, v0, t1, v1)`: convierte a índices con `round(t · HZ)`, ordena, y rellena con interpolación lineal, valores recortados a [0, 1].
- `coverage = fracción de índices no NaN`.

### 7.8 Botón "Listo"

- Si la cobertura es 0: mensaje "Toca «Empezar» para dibujar tu línea".
- Si la cobertura es menor que 0,9: mensaje "Falta un pedazo de la línea" con opciones "Seguir dibujando" y "Seguir así".
- Deshabilitado durante la grabación.

### 7.9 Pantalla y dispositivo

- Solicitar **pantalla completa** y **orientación horizontal** al iniciar la sesión (si el navegador lo permite).
- Mantener la pantalla encendida con la **Screen Wake Lock API** durante la sesión, y volver a pedirla al regresar de segundo plano.
- Respetar `prefers-color-scheme` y `prefers-reduced-motion`.

## 8. Datos

### 8.1 CSV de eventos (entrada)

- Separador detectado automáticamente: coma, punto y coma o tabulador.
- Encabezado opcional. Columnas reconocidas (sin distinguir mayúsculas):
  - Tiempo: `tiempo`, `time`, `t`, `timestamp`, `lsl`, `lsl_time`, `tiempo_lsl`, `segundos`, `seg`, `s`
  - Etiqueta: `evento`, `event`, `label`, `marker`, `marcador`, `etiqueta`, `nombre`
  - Ícono: `icono`, `icon`, `emoji`
- Sin encabezado: columna 1 = tiempo, columna 2 = etiqueta.
- Aceptar coma decimal.
- Si no hay ícono, asignarlo por la etiqueta: acierto ⭐, error ❌, inicio/nivel 🚩, fin 🏁, premio 🎁, otro ◆.

Ejemplo:

```csv
tiempo,evento,icono
1532.40,sync,⚡
1535.10,inicio nivel 1,🚩
1561.80,acierto,⭐
1590.25,error,❌
```

### 8.2 Sincronización

- La fila cuya etiqueta empieza por `sync` o `sincron` es la referencia y no se muestra como evento.
- `S_video` = segundo del destello en el video (campo de configuración).
- Si hay fila sync con tiempo `S_lsl`:
  - tiempo de un evento en el video: `t_video = S_video + (t_evento − S_lsl)`
  - tiempo LSL de un punto del trazo: `t_lsl = S_lsl + (t_video − S_video)`
- Sin fila sync: `t_video = S_video + t_evento` y la columna `tiempo_lsl_s` queda vacía.
- Descartar eventos fuera de [0, duración].
- **Con varios destellos** (filas `sync_1`, `sync_2`, …) la sincronización se hace por tramos: ver §16. Lo anterior es el caso de un solo destello.

### 8.3 Archivos de salida

Nombre base: `TET_{participante}_{condicion}_{AAAA-MM-DD-HH-MM}` (caracteres no alfanuméricos del participante reemplazados por `_`). Todos en UTF-8 con BOM (para que Excel muestre bien las tildes), formato largo, punto decimal.

**`{base}_ventanas.csv`** — promedios por ventana (solo dimensiones, sin práctica):

```
participante,condicion,modo,dimension,orden,tiempo_video_s,tiempo_lsl_s,valor
```
- `tiempo_video_s` = inicio de la ventana; promedio de los valores no NaN de la ventana; vacío si no hay ninguno.

**`{base}_10hz.csv`** — serie completa del buffer, mismas columnas; incluye la práctica con `orden = 0`.

**`{base}_toques.csv`** — cada cambio de valor registrado:
```
participante,condicion,modo,dimension,orden,pasada,tiempo_video_s,tiempo_lsl_s,valor,ms_desde_inicio_sesion
```

**`{base}.json`** — todo lo anterior más metadatos:
```json
{
  "version_app": "1.0.0",
  "participante": "P01",
  "condicion": "RM",
  "inicio": "ISO-8601",
  "grabacion": "nombre_del_video.mp4",
  "sincronizacion": { "video_s": 12.4, "lsl_s": 1532.4 },
  "eventos": [{ "t": 15.1, "label": "inicio nivel 1", "icon": "🚩" }],
  "configuracion": { "modo": "trazo", "velocidad_reproduccion": 1, "valor_inicial": 0.5, "orden_aleatorio": true },
  "practica": { "...": "mismo esquema que una dimensión", "correlacion_con_velocidad": 0.82 },
  "dimensiones": [{
    "orden": 1, "dimension": "Diversión", "pregunta": "...", "modo": "trazo",
    "duracion_s": 120.0, "hz": 10, "valores_10hz": [0.5, 0.52, null],
    "trazo_crudo": [{ "pasada": 1, "t": 0.0, "v": 0.5, "ms": 10234 }],
    "cobertura": 1.0, "toques": 12, "pasadas": 1, "saltos_video": 3,
    "tiempo_respuesta_s": 131.2
  }]
}
```

Los valores van de 0 (etiqueta inferior) a 1 (etiqueta superior).

## 9. Almacenamiento y respaldo

- Al terminar **cada dimensión**, guardar la sesión completa en IndexedDB (upsert por `id = inicio + participante`), con un campo `completa: boolean`.
- La pantalla de configuración muestra la tabla de sesiones guardadas: participante, condición, fecha, estado (completa o incompleta con número de dimensiones), botones de descarga de cada archivo y "Borrar" con confirmación en dos toques.
- Pedir `navigator.storage.persist()` al iniciar para reducir el riesgo de que el navegador borre los datos.
- Descargas mediante `Blob` y enlace `download`. Si está disponible la File System Access API o `navigator.share` con archivos, ofrecer además "Compartir" para enviar los CSV directamente (correo, Drive).
- Opción "Exportar todas las sesiones" en un ZIP (usar `fflate`, que es pequeña).

## 10. Práctica y grabación de ejemplo

Ambas se dibujan en un `VirtualPlayer` (canvas 960×540) que implementa la misma interfaz que el reproductor de video: `currentTime` (lectura y escritura), `duration`, `paused`, `playbackRate`, `play()`, `pause()` y evento de fin.

**Práctica (40 s):** una pelota amarilla que va y viene sobre fondo azul oscuro. Su velocidad sigue un perfil conocido, interpolado con coseno entre estos puntos `(t, velocidad)`:

```
(0, 0.20) (7, 0.20) (12, 0.90) (19, 0.90) (24, 0.45) (30, 0.10) (35, 0.10) (40, 0.70)
```

La posición se obtiene integrando la velocidad (paso de 0,05 s) para que sea determinista al saltar en el tiempo. Pregunta: "¿Qué tan rápido iba la pelota?", etiquetas "Lento" y "Rapidísimo".

Al final se calcula la **correlación de Pearson** entre el trazo (índices no NaN) y la velocidad real en los mismos tiempos; si hay menos de 10 puntos, devolver `null`. Se muestra al investigador como indicador de comprensión de la tarea.

**Grabación de ejemplo (120 s):** se usa si no se carga video. Tablero de 12 cartas que se voltean, cambio de color de fondo a los 60 s y el texto del evento en pantalla durante 2 s tras cada evento simulado (inicio de nivel, aciertos, errores, premio, fin).

## 11. Pantalla final

- Mensaje grande para el niño: "¡Terminaste! Gracias por jugar."
- Sección desplegable para el investigador con:
  - Tabla por dimensión: orden, nombre, cobertura, tiempo de respuesta, pasadas, toques, saltos en el video.
  - La correlación de la práctica con una frase de interpretación.
  - Miniaturas de cada curva (en la práctica, superponer la velocidad real punteada).
  - Botones de descarga de los cuatro archivos y "Nueva sesión".
  - Aviso si la sesión usó la grabación de ejemplo.

## 12. Fases de trabajo

Al final de cada fase: ejecutar las pruebas, resumir qué se hizo y esperar revisión.

1. **Base del proyecto:** Vite + TypeScript, estructura de carpetas, PWA sin conexión, fuentes locales, estilos y tokens de color (claro y oscuro).
2. **Lógica de datos con pruebas:** `trace.ts`, `events.ts`, sincronización, `export.ts` y `practice.ts`. Pruebas unitarias de: `setRange` (orden inverso, bordes, recorte), cobertura, remuestreo por ventanas, lectura de CSV (separadores, encabezados, coma decimal, sin encabezado), cálculo de tiempos LSL y correlación de la práctica.
3. **Reproductores:** `VideoPlayer` y `VirtualPlayer` con la misma interfaz.
4. **Pantalla de configuración** con validaciones y lectura de archivos.
5. **Pantalla de trazado** en ambos modos, línea de tiempo y grabación continua.
6. **Pantalla final y exportaciones.**
7. **IndexedDB, respaldo automático y tabla de sesiones guardadas.**
8. **Pulido para tablet:** pantalla completa, orientación, wake lock, prueba en un dispositivo Android real y revisión de accesibilidad.

## 13. Casos límite que deben funcionar

- **Videos WebM de MediaRecorder** con duración `Infinity`: forzar el cálculo asignando `currentTime = 1e101`, esperar `durationchange` y volver a 0.
- **Saltos rápidos en el video** (línea de tiempo): no encadenar `currentTime` mientras haya un `seeking` pendiente; guardar el último pedido y aplicarlo en `seeked`. Usar `fastSeek` si existe y el video está pausado.
- **Autoplay:** iniciar la reproducción solo desde el gesto del botón "Empezar".
- La app pasa a segundo plano durante una grabación: pausar, invalidar la pasada y pedir repetirla al volver.
- Rotación o cambio de tamaño de pantalla durante la sesión: los canvas se redibujan sin perder datos.
- Video sin audio, video muy corto (< 5 s) o muy largo (> 30 min).
- CSV de eventos vacío, con filas inválidas o sin columna de tiempo: mostrar error, no fallar.
- Participante con caracteres especiales o tildes en el código.

## 14. Criterios de aceptación

- Funciona sin conexión después de la primera carga e instalada como app en Android.
- Con un video de 2 minutos, el CSV a 10 Hz de cada dimensión completa tiene 1201 filas y cobertura 1,0.
- El tiempo LSL calculado coincide con el del CSV de eventos en los puntos de sincronización (error < 0,05 s).
- Una sesión interrumpida (cerrar la pestaña tras la dimensión 2) aparece en la tabla de sesiones guardadas con 2 dimensiones descargables.
- El niño no puede desplazar ni hacer zoom en la pantalla de trazado.
- Todas las pruebas de la fase 2 pasan.

## 15. Fuera de alcance (por ahora)

- Transmitir el trazo por LSL en tiempo real.
- Grabar el video dentro de la app.
- Cuentas de usuario o sincronización con un servidor.

## 16. Sincronización con varios destellos (v2, propuesta 2026-10-06)

> Aprobado por el investigador el 2026-10-06 (ritmo y aspecto del destello, y el cambio del JSON de §16.6). Los cambios correspondientes en el juego están en [GAME-SPECS.md](GAME-SPECS.md).

### 16.1 Motivo

La grabación de la Quest pasa por la transmisión a la app Meta Horizon del celular: tiene un retraso inicial y puede perder o repetir cuadros. Con un solo destello (§8.2) solo se corrige el retraso; con varios, también la deriva y los saltos. Una partida típica dura unos 5 minutos y el juego emite un destello al pulsar «Iniciar partida», uno cada 60 s y uno al final (6 o 7 en total).

### 16.2 Puntos de sincronización

- Toda fila del CSV de eventos cuya etiqueta empiece por `sync` o `sincron` es un **punto de sincronización** y no se muestra como evento. Se ordenan por tiempo LSL: `L_1 < L_2 < … < L_N`.
- A cada uno le corresponde un destello en el video, en el segundo `V_k`. Los `V_k` se obtienen por **detección automática** (§16.4) o se marcan a mano (§16.5).
- Emparejamiento por orden: el k-ésimo destello del video con el k-ésimo `sync` del CSV.

### 16.3 Traducción video ↔ LSL

- **Con N ≥ 2 puntos: lineal por tramos.** Entre `V_k` y `V_{k+1}`: `t_lsl = L_k + (t_video − V_k) · (L_{k+1} − L_k) / (V_{k+1} − V_k)`. Antes de `V_1` y después de `V_N` se extiende el primer y el último tramo. La traducción inversa (eventos del CSV al video) usa los mismos tramos.
- **Con N = 1**, la fórmula de §8.2 (pendiente 1). **Sin filas sync**, como hoy: sin tiempo LSL.
- **Controles de calidad**, que la pantalla de configuración muestra y el JSON guarda:
  - **Coherencia de intervalos:** para cada tramo, `(V_{k+1} − V_k) − (L_{k+1} − L_k)`. Si alguna diferencia supera 0,5 s, hay un destello perdido, uno de más o un emparejamiento errado: se avisa en rojo y no se puede comenzar hasta revisarlo (o pasar a un solo destello).
  - **Ritmo** de cada tramo, `(L_{k+1} − L_k) / (V_{k+1} − V_k)`, como porcentaje de desviación respecto a 1.
  - **Residuo de la recta global:** se ajusta por mínimos cuadrados `t_lsl = a + b · t_video` con todos los puntos y se informa el residuo máximo en milisegundos. Es solo un indicador de cuánto se aparta la grabación de un ritmo constante; la traducción usa los tramos.

### 16.4 Detección automática de destellos

> Método cambiado por el investigador el 2026-10-07, tras la prueba con una grabación real de RM (ESTADO.md). El método anterior, el brillo medio en una cuadrícula de 8×6, no distinguía el destello: este ocupa una fracción pequeña de cada celda, y el movimiento de la cabeza y los objetos del juego producían más de 100 subidas de brillo mayores. Medir solo el recuadro del destello encontró los 4 destellos sin falsos positivos.

El destello es un cuadrado blanco con marco negro, **fijo en la pantalla** (GAME-SPECS §3.2), así que la detección mide solo esa zona del cuadro. Se hace en la pantalla de configuración, al cargar el video y el CSV. El video se recorre **sin sonido y sin mostrarlo al niño**, a 4× si el navegador lo permite, y el tiempo de cada cuadro es su `mediaTime` (`requestVideoFrameCallback` cuando exista; si no, `requestAnimationFrame` y `currentTime`). Nunca se calcula como número de cuadro ÷ fps, porque la grabación de Meta Horizon tiene duración de cuadro variable (de 10 a 45 ms en la prueba).

**Paso 1: ubicar el recuadro del destello.**
- Automático: en un primer recorrido, con el cuadro reducido (unos 200 px de ancho), se marca cada píxel que pasa a **blanco casi puro** (canal mínimo > 220 de 255) desde un estado no blanco, sigue así entre 0,1 y 0,8 s y luego vuelve. Se agrupan los píxeles vecinos y se elige la zona **compacta y aproximadamente cuadrada**, de entre el 2 % y el 20 % del ancho del cuadro, cuyos pulsos coinciden mejor en número e intervalos con los `sync` del CSV.
- Manual, si la búsqueda automática falla o hay dudas: en el visor de §16.5, el investigador va a un cuadro donde se vea el destello y lo toca. El recuadro es la zona blanca conectada alrededor del toque.
- El recuadro se guarda en coordenadas relativas al cuadro (0 a 1), con la configuración en `localStorage`. Como es el mismo en todas las grabaciones del mismo juego y la misma transmisión, la siguiente sesión lo propone primero.

**Paso 2: medir el recuadro en todo el video.**
- En cada cuadro, la fracción de píxeles del interior del recuadro (sin los bordes) que son blanco casi puro.
- Un destello es una racha de cuadros con fracción > 0,8 que dura entre 0,1 y 0,8 s. `V_k` es el `mediaTime` del primer cuadro de la racha.
- **Refinamiento:** como a 4× el navegador puede saltarse cuadros, alrededor de cada destello se recorre el video cuadro por cuadro (±0,5 s) para encontrar el primer cuadro blanco. Precisión esperada: un cuadro (unos 33 ms a 30 fps).
- Si el número de destellos no coincide con el de filas `sync`, se avisa y se pasa a la revisión de §16.5.

Se muestra una barra de progreso y se puede cancelar. Para un video de 5 minutos se espera menos de 2 minutos de análisis.

**Validación** (grabación de prueba del 2026-10-07: 832×464 px, 167 s): el recuadro mide 70×70 px en (399, 58), el 8 % del ancho. Aparecen 4 rachas de 9 o 10 cuadros, en 7,127, 67,143, 127,142 y 151,067 s, sin falsos positivos. La fase 11 ajusta los umbrales con más grabaciones.

### 16.5 Revisión y ajuste manual

- La pantalla de configuración muestra una tabla con cada punto: etiqueta, `L_k`, `V_k`, diferencia de intervalo y un botón **«Ver»** que muestra el cuadro del destello y permite moverse cuadro a cuadro (◀ ▶) para corregir `V_k`.
- Si la detección no encuentra todos los destellos, el investigador puede marcarlos a mano con el mismo visor, o quedarse con un solo destello (el campo actual de §6).

### 16.6 Cambios en los archivos de salida

- Las columnas de los CSV **no cambian**; `tiempo_lsl_s` se calcula con §16.3.
- En el JSON, `sincronizacion` conserva `video_s` y `lsl_s` (los del primer punto) para los scripts existentes, y agrega:

```json
"sincronizacion": {
  "video_s": 12.4, "lsl_s": 1532.4,
  "modelo": "tramos",
  "puntos": [{ "etiqueta": "sync_1", "video_s": 12.4, "lsl_s": 1532.4, "origen": "auto" }],
  "ritmo_por_tramo": [0.9994],
  "dif_intervalo_max_s": 0.03,
  "residuo_recta_max_ms": 41
}
```

- `modelo` es `"tramos"`, `"un_punto"` o `"sin_sync"`; `origen` es `"auto"` o `"manual"`.

### 16.7 Fases de trabajo

9. **Lógica de sincronización por tramos con pruebas:** varios `sync` en `events.ts`, traducción por tramos en ambos sentidos, controles de calidad, cambios en `export.ts` (§16.6). Pruebas con puntos sintéticos, deriva, un salto y un destello faltante. Además, el script `scripts/xdf_a_eventos.py` (Python con `pyxdf`) que exporta el CSV de eventos desde el XDF de LabRecorder (GAME-SPECS §7).
10. **Detección de destellos y tabla de revisión** en la pantalla de configuración (§16.4, §16.5): ubicar el recuadro del destello (automático o tocándolo) y medirlo en todo el video. Pruebas de la parte pura (rachas, emparejamiento con los `sync`, elección de la zona) sin navegador.
11. **Prueba con una grabación real** de la Quest hecha con la app Meta Horizon, y ajuste de umbrales.

Agregado tras la fase 10 (aprobado por el investigador el 2026-10-07): la **ventana de trazado** de §16.8.

### 16.8 Ventana de trazado (recorte virtual)

> Aprobado por el investigador el 2026-10-07: recorte virtual, el fin en el destello del último sync y, en los CSV, solo las filas de la ventana.

- El niño ve y traza solo la partida: del destello de la **primera** fila sync (al pulsar «Iniciar partida») al de la **última** (fin de la partida). Así no puede trazar antes de que llegue la señal de sincronía ni después del fin del juego.
- El archivo de video **no se modifica**: recodificarlo en la tablet sería lento y alteraría los tiempos de los cuadros. El reproductor se limita al tramo [inicio, fin]: «Empezar» y «Repetir» arrancan en el inicio, la reproducción se detiene en el fin, y la línea de tiempo y la gráfica muestran solo ese tramo.
- Los extremos se calculan pasando los tiempos LSL de la primera y la última fila sync por la sincronización (§16.3 o §8.2), así que valen aunque falte el destello de alguna de ellas en el video. Con una sola fila sync, el fin es el final del video. Sin filas sync (sin tiempo LSL), y con la grabación de ejemplo, se usa el video completo.
- El fin nunca pasa del **último cuadro** del video. Su final se mide durante la detección de destellos, porque la duración que da el navegador puede ser la de la pista de audio (en la prueba, 40 ms más larga). Además, la duración de la ventana se recorta a un múltiplo de 0,1 s (menos de 0,1 s), para que la última muestra a 10 Hz caiga justo en el fin.
- La pantalla de configuración muestra la ventana («El niño verá y trazará solo la partida: de 7,13 s a 151,03 s del video»), y la pantalla final la incluye en los datos de la sesión.
- **Archivos de salida:** los CSV de las dimensiones tienen solo las filas de la ventana. `tiempo_video_s` y `tiempo_lsl_s` siguen en el reloj del video y de LSL; las ventanas de promedio empiezan en el inicio de la ventana. La práctica no cambia: empieza en 0. El JSON agrega `"ventana": {"inicio_s": …, "fin_s": …}` (null en sesiones guardadas antes) y, en cada dimensión, `inicio_s`: el valor i de `valores_10hz` está en `inicio_s + i / hz`, y los tiempos de `trazo_crudo` están en tiempo del video.

