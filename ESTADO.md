# Estado del proyecto

Última actualización: 2026-10-05.

## Fases (SPEC §12)

| Fase | Estado | Commit |
|---|---|---|
| 1. Base del proyecto (Vite, PWA sin conexión, fuentes, tokens) | Revisada | `64c08ce` Phase 1 is builded |
| 2. Lógica de datos con pruebas | Revisada | `770f3ac` phase 2 builded |
| 3. Reproductores (`VideoPlayer`, `VirtualPlayer`) | Revisada en navegador | `7ed4cdd` y `fa1ad7a` Video players working, phase 3 builded |
| 4. Pantalla de configuración | Revisada | `68cae27` Phase 4 builded, configuration is ready |
| 5. Pantalla de trazado | Revisada | `260975d` Phase 5 builded, raw dimensions adquired |
| 6. Pantalla final y exportaciones | Revisada | traces ready, download buttons ready, no multiple downloads enabled |
| 7. IndexedDB y sesiones guardadas | **En curso** | — |
| 8. Pulido para tablet | Sin empezar | — |

Pruebas: 169 de 169 pasan (`npm test`). El chequeo de tipos y el build no dan errores.

Las decisiones aceptadas de las fases 2, 4 y 5 están en CLAUDE.md.

## Dónde quedamos

**Fase 6 revisada (2026-10-05); se empieza la fase 7.** El investigador no vio la frase de la correlación porque esa sesión no tuvo práctica; desde entonces, la pantalla final lo dice explícitamente. Se recorrió completa en Brave sin interfaz: práctica y una dimensión de 2 minutos sobre la grabación de ejemplo, panel del investigador y descarga de los 4 archivos. Revisión de los archivos descargados: los 3 CSV llevan BOM y el JSON no. `_10hz.csv` tiene 1201 filas de la dimensión y 401 de la práctica, `_ventanas.csv` 120 filas, y Python lee el JSON sin errores.

Qué revisar en la fase 6:

1. «¡Terminaste! Gracias por jugar.» en grande. La sección «Para el investigador» está **plegada** para que el niño no la vea.
2. Al desplegarla: aviso si se usó la grabación de ejemplo; datos de la sesión; tabla por dimensión (orden, nombre, cobertura, tiempo de respuesta, pasadas, toques, saltos); correlación de la práctica con su frase; miniaturas de cada curva, con la velocidad real punteada en la práctica.
3. Botones de descarga de los 4 archivos y, si el navegador lo permite (Android), «Compartir los 4 archivos».
4. «Nueva sesión» sin haber descargado nada pide un segundo toque.
5. Abrir los CSV en Excel: las tildes se ven bien.

## Decisiones de la fase 6 (aceptadas; resumidas en CLAUDE.md)

- **Umbrales de la frase de la práctica** (orientativos, en `src/summary.ts`): r ≥ 0,5 «sigue bien la velocidad»; 0,2 ≤ r < 0,5 «solo en parte, conviene revisar»; r < 0,2 «es posible que no haya entendido la tarea».
- La sección del investigador empieza plegada.
- «Compartir» envía los 4 archivos juntos. No hay un botón «Descargar todos»: Chrome suele bloquear o pedir permiso para varias descargas seguidas. El ZIP de todas las sesiones es de la fase 7.
- Hasta la fase 7 la sesión no queda guardada en el dispositivo: por eso «Nueva sesión» pide confirmación si no se descargó ni compartió nada.

## Revisión de la fase 5 (hecha)

Lo que se revisó:

1. Tarjeta de introducción con la pregunta, la instrucción y «¡Vamos!».
2. En espera: video en el primer cuadro, punto amarillo en (0, 0,5), línea de tiempo con íconos que mueve el video al tocarla o arrastrarla.
3. «▶ Empezar»: el video corre desde 0 hasta el final sin pausas; la línea de tiempo queda bloqueada; el niño solo sube o baja (en la gráfica o con el deslizador, según el modo); al soltar, el valor se mantiene.
4. Al terminar: «↺ Repetir» y «Listo». «Listo» sin línea muestra «Toca «Empezar» para dibujar tu línea»; con menos del 90 % muestra «Falta un pedazo de la línea» con «Seguir dibujando» y «Seguir así».
5. Pasar la app a segundo plano durante la grabación: al volver, la pasada está borrada y pide repetirla.
6. Girar la tablet o cambiar el tamaño de la ventana: se redibuja sin perder la línea.
7. Al final, la pantalla «¡Terminaste!» provisional muestra, por dimensión, la cobertura, el tiempo, las pasadas, los toques, los saltos y la correlación de la práctica.

## Decisiones de la fase 5 (aceptadas sin objeción; resumidas en CLAUDE.md)

- **«Repetir» borra los toques de la pasada anterior** (SPEC §7.6, paso 1): el trazo crudo y el contador `toques` corresponden solo a la última pasada, igual que la línea. `pasadas` cuenta todas las pasadas empezadas, incluidas las interrumpidas, y `saltos_video` cuenta todos los gestos en la línea de tiempo de la dimensión.
- **Tiempo de respuesta:** desde «¡Vamos!» hasta «Listo».
- **La práctica usa la velocidad configurada**, igual que las dimensiones (como en el prototipo).
- **Fin de la pasada:** la última muestra se toma en la duración del video aunque `currentTime` se detenga unas centésimas antes. Así la cobertura llega a 1,0.
- La línea de tiempo también se puede usar después de terminar una pasada (no solo antes de la primera); cada gesto cuenta como salto.
- Si el navegador impide reproducir, la pasada se anula y se pide tocar «Empezar» otra vez.
- La gráfica y la línea de tiempo dejan 20 px a cada lado, para que el punto y la perilla quepan enteros en los extremos.
- Pantalla completa, orientación y wake lock quedan para la fase 8. No hay forma de salir a mitad de la sesión salvo recargar; el respaldo en IndexedDB es de la fase 7.

## Mapa del código ya escrito

- `src/trace/trace.ts`: clase `Trace` (buffer a 10 Hz con `setRange`, `beginPass`/`sample` para grabar, cobertura) y `resample` (promedio por ventanas).
- `src/trace/recorder.ts`: `DimensionRecorder`, el estado de una dimensión en la pantalla de trazado (espera, grabando, terminada; valor, trazo crudo, toques, pasadas, saltos, interrupción, comprobación de «Listo» y `toRecord`). Sin DOM, con pruebas.
- `src/trace/render.ts`: geometría compartida por la gráfica, la línea de tiempo y el deslizador (con pruebas) y su dibujo en canvas (`drawGraph`, `drawTimeline`, `fitCanvas`, `readPalette`).
- `src/data/events.ts`: lectura del CSV de eventos, `iconFor`, sincronización (`eventToVideo`, `videoToLsl`, `toVideoEvents`).
- `src/data/export.ts`: los 4 archivos de salida (`buildAllFiles`), `fileBase`, `isoLocal`.
- `src/practice.ts`: perfil de velocidad, posición de la pelota, `practiceCorrelation`.
- `src/config.ts`: recordar la configuración (`loadSavedConfig`, `saveConfig`, `sanitizeConfig`), `validateConfig` y el orden de dimensiones (`dimensionOrder`, `shuffled`). Sin DOM, con pruebas.
- `src/state.ts`: tipos `Config`, `SessionData`, `DimensionRecord`, `RawPoint`, la configuración por defecto, `SessionPlan` (`setPlan`/`takePlan`: de la configuración al trazado) y `setFinished`/`takeFinished` (del trazado a la pantalla final).
- `src/players/`: la interfaz `Player`, `VideoPlayer` (con `loadVideo` y `resolveDuration`), `VirtualPlayer` y `scenes.ts` (práctica, grabación de ejemplo, `DEMO_EVENTS`).
- `src/trace/render.ts` incluye también `drawMini`, las miniaturas de la pantalla final.
- `src/summary.ts`: filas de la tabla final (`summaryRows`) y la frase de la correlación de la práctica (`interpretCorrelation`). Sin DOM, con pruebas.
- `src/data/download.ts`: `downloadFile` (Blob y enlace `download`), `canShareFiles` y `shareFiles` (navigator.share).
- `src/screens/setup.ts`: formulario de configuración. `tracing.ts`: pantalla del niño. `done.ts`: pantalla final con el resumen y las descargas; recibe la sesión con `takeFinished()`.
- `tests/`: pruebas de cada módulo.

## Para la fase 7

- En `finishItem()` de `tracing.ts` está marcado el punto donde se guarda la sesión en IndexedDB al terminar cada dimensión.
- La tabla de sesiones guardadas puede reutilizar `buildAllFiles`, `downloadFile` y `shareFiles`.
- Cuando las sesiones se guarden solas, quitar la confirmación de «Nueva sesión» en `done.ts` (o dejarla solo si falló el guardado).
