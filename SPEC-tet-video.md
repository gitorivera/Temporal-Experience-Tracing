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
