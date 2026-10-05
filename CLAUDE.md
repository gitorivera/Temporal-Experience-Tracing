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
2. **Coma decimal con separador coma** (`1532,40,sync`): es ambiguo y el lector **no** lo resuelve; se lee como tiempo 1532 y etiqueta «40». En la fase 4, la pantalla de configuración debe **mostrar un aviso** junto al campo del CSV de eventos: usar `;`, tabulador o comillas si los números llevan coma decimal.

Decisiones de la fase 2 aceptadas sin objeción:

- El nombre de archivo usa la hora local de la tablet. `inicio` es ISO-8601 con desfase (`2026-10-05T15:04:46.123-05:00`).
- En las filas de la práctica, `tiempo_lsl_s` queda vacía: la práctica ocurre fuera del juego.
- En el nombre de archivo, al código del participante se le quitan las tildes y lo no alfanumérico pasa a `_` (`Niño 3` → `Nino_3`). Dentro de los CSV se guarda el código original.
- Los CSV usan fin de línea CRLF; tiempos con 3 decimales y valores con 4.

## Comandos (dentro de `tet-video/`)

```
npm install        # primera vez en un computador nuevo
npm run dev        # servidor de desarrollo (sin service worker)
npm test           # Vitest
npm run build      # tsc + vite build + service worker
npm run preview    # sirve dist/ (con service worker: puede mostrar una versión en caché)
node scripts/make-icons.mjs   # regenera los íconos de public/icons
```

Requiere Node.js 20 o posterior (se desarrolló con Node 24 LTS). En Windows: `winget install OpenJS.NodeJS.LTS`.

## Notas técnicas

- Stack: Vite 8, TypeScript 7 en modo estricto, `vite-plugin-pwa`, Vitest 5. Dependencias de ejecución: solo `idb` y `fflate`.
- Fuentes locales en `public/fonts/` (sacadas de `@fontsource`, licencia OFL incluida). Nunca cargarlas desde Google Fonts.
- `src/players/scenes.ts` no figura en la estructura del SPEC: separa el dibujo de las escenas para que `practice.ts` siga siendo solo cálculo y se pueda probar sin navegador.
- En PowerShell 5.1, `Set-Content -Encoding utf8` agrega BOM a los archivos fuente. Para editarlos, usar las herramientas de edición de archivos, no ese comando.
