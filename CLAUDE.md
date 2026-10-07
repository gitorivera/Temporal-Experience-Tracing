# Temporal Experience Tracing (TET) — instrucciones para Claude Code

Aplicación PWA de trazado de experiencia con video para niños (doctorado, UTP). La especificación completa está en [SPEC-tet-video.md](SPEC-tet-video.md) y el código en [tet-video/](tet-video/). El prototipo de referencia está en [reference/prototype.html](reference/prototype.html); úsalo solo para entender el comportamiento, no como base de código.

**Antes de seguir trabajando, lee [ESTADO.md](ESTADO.md):** dice en qué fase vamos y qué está pendiente.

## Forma de trabajo

- Se construye por fases (SPEC §12). Al terminar cada fase: correr pruebas y build, resumir lo hecho y **detenerse a esperar la revisión** del investigador.
- No hacer commit hasta que el investigador lo pida; él da el mensaje (p. ej. «phase 2 builded»).
- Si algo es ambiguo, preguntar antes de decidir.
- Conversación, comentarios del código y textos de la interfaz en español.

## Cambios al SPEC autorizados por el investigador

Prevalecen sobre el texto del SPEC:

1. **El JSON de salida va sin BOM.** Solo los 3 CSV llevan BOM, aunque §8.3 dice «todos». Motivo: con BOM, `json.load` de Python y otros lectores fallan.
2. **JSON: bloque `sincronizacion` ampliado** (SPEC §16.6, aprobado 2026-10-06): conserva `video_s` y `lsl_s` del primer punto y agrega `modelo`, `puntos`, `ritmo_por_tramo`, `dif_intervalo_max_s` y `residuo_recta_max_ms`. Las columnas de los CSV no cambian.
3. **Coma decimal con separador coma** (`1532,40,sync`): es ambiguo y el lector **no** lo resuelve; se lee como tiempo 1532 y etiqueta «40». En la fase 4, la pantalla de configuración debe **mostrar un aviso** junto al campo del CSV de eventos: usar `;`, tabulador o comillas si los números llevan coma decimal.

4. **Detección de destellos por el recuadro fijo del destello** (SPEC §16.4 reescrito, 2026-10-07), no por la cuadrícula de 8×6. Ver ESTADO.md.
5. **El stream del XDF es `JuegoEventos`;** `ColorQuestMarkers` se ignora. `scripts/xdf_a_eventos.py` usa `JuegoEventos` por omisión.
6. **`test_files/` es solo para pruebas locales** (video de la Quest y XDF): está en `.gitignore` y nunca se sube.

Decisiones de la fase 2 aceptadas sin objeción:

- El nombre de archivo usa la hora local de la tablet. `inicio` es ISO-8601 con desfase (`2026-10-05T15:04:46.123-05:00`).
- En las filas de la práctica, `tiempo_lsl_s` queda vacía: la práctica ocurre fuera del juego.
- En el nombre de archivo, al código del participante se le quitan las tildes y lo no alfanumérico pasa a `_` (`Niño 3` → `Nino_3`). Dentro de los CSV se guarda el código original.
- Los CSV usan fin de línea CRLF; tiempos con 3 decimales y valores con 4.

Decisiones de la fase 4 aceptadas por el investigador:

- La configuración (salvo el código del participante) se recuerda en `localStorage` y se guarda con cada cambio. Los datos de sesión siguen en IndexedDB.
- Una dimensión a medio llenar impide comenzar; las filas vacías se ignoran; no se admiten dos dimensiones con el mismo nombre.
- Sin video se usa la grabación de ejemplo con sus propios eventos (`DEMO_EVENTS`) y sin sincronización; un CSV cargado no se usa y la pantalla lo avisa.
- Si el destello queda después del final del video se avisa, pero no se impide comenzar.

Decisiones de la fase 5 aceptadas sin objeción:

- «Repetir» borra la línea, el trazo crudo y el contador `toques` de la pasada anterior; `pasadas` y `saltos_video` se acumulan en toda la dimensión.
- El tiempo de respuesta va de «¡Vamos!» a «Listo». La práctica usa la velocidad configurada.
- La última muestra de una pasada se toma en la duración del video, para que la cobertura llegue a 1,0.
- La línea de tiempo se puede usar antes de la primera pasada y después de cada una; cada gesto es un salto.

Decisiones de la fase 6 aceptadas por el investigador:

- Frase de la correlación de la práctica: r ≥ 0,5 buena; 0,2 ≤ r < 0,5 parcial; r < 0,2 dudosa (`src/summary.ts`).
- **No hay botón «Descargar todos»** por ahora (el investigador lo prefiere así): un botón por archivo.
- «Compartir» envía solo los 3 CSV (Chrome no permite compartir `.json`, y el envío es todo o nada); el JSON se descarga con su botón. Un envío a la vez: mientras uno sigue abierto, no se lanza otro.
- La sección del investigador de la pantalla final empieza plegada.

Decisiones de la fase 7 aceptadas sin objeción:

- La sesión entera se guarda en IndexedDB (upsert por `id = inicio_participante`) al terminar la práctica y cada dimensión; es completa cuando tiene todas las dimensiones planeadas.
- Si falla el guardado, el niño no se entera; la pantalla final lo avisa y «Nueva sesión» pide confirmación.
- En el ZIP, si dos sesiones dan el mismo nombre base, la carpeta de la segunda lleva «_2».
- Las llamadas a IndexedDB se prueban en el navegador, no con Vitest (no se agregó `fake-indexeddb`).

## Comandos (dentro de `tet-video/`)

```
npm install        # primera vez en un computador nuevo
npm run dev        # servidor de desarrollo (sin service worker)
npm test           # Vitest
npm run build      # tsc + vite build + service worker
npm run preview    # sirve dist/ (con service worker: puede mostrar una versión en caché)
node scripts/make-icons.mjs   # regenera los íconos de public/icons
python -m unittest discover -s scripts -p "test_*.py"   # pruebas de xdf_a_eventos.py
python scripts/xdf_a_eventos.py ../test_files/<archivo>.xdf -o eventos.csv   # XDF → CSV de eventos
bash scripts/deploy-pages.sh  # publica dist/ en GitHub Pages (repo público gitorivera/tet-app)
```

Publicación: la app compilada se publica en un repositorio **público aparte** (`gitorivera/tet-app`, GitHub Pages desde `main`), que solo contiene `dist/`. Este repositorio sigue privado. El script exige que no haya cambios sin commit y reemplaza la publicación anterior.

Requiere Node.js 20 o posterior (se desarrolló con Node 24 LTS). En Windows: `winget install OpenJS.NodeJS.LTS`.

## Notas técnicas

- Stack: Vite 8, TypeScript 7 en modo estricto, `vite-plugin-pwa`, Vitest 5. Dependencias de ejecución: solo `idb` y `fflate`.
- Fuentes locales en `public/fonts/` (sacadas de `@fontsource`, licencia OFL incluida). Nunca cargarlas desde Google Fonts.
- `src/players/scenes.ts` no figura en la estructura del SPEC: separa el dibujo de las escenas para que `practice.ts` siga siendo solo cálculo y se pueda probar sin navegador.
- En PowerShell 5.1, `Set-Content -Encoding utf8` agrega BOM a los archivos fuente. Para editarlos, usar las herramientas de edición de archivos, no ese comando.
