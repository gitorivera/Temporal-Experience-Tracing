# Estado del proyecto

Última actualización: 2026-10-05.

## Fases (SPEC §12)

| Fase | Estado | Commit |
|---|---|---|
| 1. Base del proyecto (Vite, PWA sin conexión, fuentes, tokens) | Revisada | `64c08ce` Phase 1 is builded |
| 2. Lógica de datos con pruebas | Revisada | `770f3ac` phase 2 builded |
| 3. Reproductores (`VideoPlayer`, `VirtualPlayer`) | Revisada en navegador | `7ed4cdd` y `fa1ad7a` Video players working, phase 3 builded |
| 4. Pantalla de configuración | Revisada | `68cae27` Phase 4 builded, configuration is ready |
| 5. Pantalla de trazado | Revisada | Phase 5 builded, raw dimensions adquired |
| 6. Pantalla final y exportaciones | **En curso** | — |
| 7. IndexedDB y sesiones guardadas | Sin empezar | — |
| 8. Pulido para tablet | Sin empezar | — |

Pruebas: 164 de 164 pasan (`npm test`). El chequeo de tipos y el build no dan errores.

Las decisiones aceptadas de las fases 2 y 4 están en CLAUDE.md.

## Dónde quedamos

**Fase 5 revisada (2026-10-05); se empieza la fase 6.** Se probó de punta a punta en Brave sin interfaz (por CDP, 1280×800), en los dos modos, con la práctica y una dimensión sobre la grabación de ejemplo a 2×. Con 2 minutos salieron 1201 muestras con cobertura 100 %, y la consola no mostró errores. Falta probarla con el dedo en la tablet y con un video real.

Qué revisar:

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
- `src/screens/setup.ts`: formulario de configuración. `tracing.ts`: pantalla del niño completa. `done.ts`: marcador con un resumen provisional.
- `tests/`: pruebas de cada módulo.

## Para la fase 6

- `mountDone` recibe la sesión con `takeFinished()`: un `SessionData` completo, listo para `buildAllFiles()`.
- El resumen provisional de `done.ts` se reemplaza por la pantalla del SPEC §11.

## Para la fase 7

- En `finishItem()` de `tracing.ts` está marcado el punto donde se guarda la sesión en IndexedDB al terminar cada dimensión.
