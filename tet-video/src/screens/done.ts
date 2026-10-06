// Pantalla final (SPEC §11): mensaje para el niño y, plegada, la sección del investigador
// con el resumen, las miniaturas de las curvas y las descargas.
import type { MountScreen } from '../main';
import { canShareFiles, downloadFile, shareFiles } from '../data/download';
import { buildAllFiles, fileBase, type OutputFile } from '../data/export';
import { speedAt } from '../practice';
import { formatTime } from '../players/scenes';
import { takeFinished, type DimensionRecord, type SessionData } from '../state';
import { practiceSummary, summaryRows } from '../summary';
import { drawMini, fitCanvas, readPalette } from '../trace/render';

const FILE_LABELS: Record<OutputFile['kind'], string> = {
  ventanas: 'CSV por ventanas',
  hz10: 'CSV a 10 Hz',
  toques: 'CSV de toques',
  json: 'JSON completo',
};

const num = (x: number, d: number) => x.toFixed(d).replace('.', ',');

function metaLines(s: SessionData): [string, string][] {
  const sync = s.sincronizacion;
  return [
    ['Participante', s.participante],
    ['Condición', s.condicion === 'RM' ? 'Realidad mixta (RM)' : 'Tablet'],
    ['Modo', s.modo === 'trazo' ? 'Trazo sobre la gráfica' : 'Deslizador lateral'],
    ['Velocidad', `${num(s.velocidad, s.velocidad % 1 ? 1 : 0)}×`],
    ['Orden', s.ordenAleatorio ? 'Aleatorio' : 'Fijo'],
    ['Inicio', new Date(s.inicio).toLocaleString('es-CO')],
    ['Grabación', s.grabacion ?? 'Grabación de ejemplo'],
    [
      'Sincronización',
      sync.lslS === null
        ? `destello en ${num(sync.videoS, 2)} s, sin fila sync (sin tiempo LSL)`
        : `destello en ${num(sync.videoS, 2)} s = ${num(sync.lslS, 3)} s LSL`,
    ],
    ['Eventos en el video', String(s.eventos.length)],
    ['Resolución de exportación', `${num(s.resolucionS, s.resolucionS % 1 ? 1 : 0)} s`],
  ];
}

export const mountDone: MountScreen = (root, go) => {
  const finished = takeFinished();
  const s = finished?.session ?? null;
  const el = document.createElement('section');
  el.className = 'researcher done';
  el.innerHTML = `
    <div class="thanks"><p class="big">¡Terminaste! Gracias por jugar.</p></div>
    <details class="card done-panel" id="panel" hidden>
      <summary>Para el investigador</summary>
      <p class="status" id="guardado" aria-live="polite">Guardando la sesión en este dispositivo…</p>
      <p class="notice warn" id="aviso-ejemplo" hidden>
        Esta sesión usó la grabación de ejemplo: los datos sirven solo para probar la aplicación.
      </p>
      <dl class="meta" id="meta"></dl>

      <h3>Resumen por dimensión</h3>
      <div class="tablewrap">
        <table>
          <thead><tr>
            <th>Orden</th><th>Dimensión</th><th>Cobertura</th><th>Tiempo de respuesta</th>
            <th>Pasadas</th><th>Toques</th><th>Saltos en el video</th>
          </tr></thead>
          <tbody id="filas"></tbody>
        </table>
      </div>
      <p class="practice-note" id="nota-practica"></p>

      <h3>Curvas</h3>
      <div class="minis" id="minis"></div>

      <h3>Archivos</h3>
      <p class="muted" id="base"></p>
      <div class="row" id="descargas"></div>
      <p class="status" id="dl-status" aria-live="polite"></p>
    </details>
    <div class="row done-actions">
      <button type="button" class="btn" id="nueva">Nueva sesión</button>
    </div>
  `;
  root.append(el);

  const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const btnNueva = $<HTMLButtonElement>('nueva');
  /**
   * La sesión está a salvo: quedó en IndexedDB o se descargó o compartió algo.
   * Si no, «Nueva sesión» pide confirmación. Mientras se espera el guardado, se considera a salvo
   * (el guardado tarda milisegundos y casi nunca falla).
   */
  let saved = true;
  let armed: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (armed !== null) clearTimeout(armed);
    armed = null;
    btnNueva.textContent = 'Nueva sesión';
    btnNueva.classList.remove('danger');
  };

  btnNueva.addEventListener('click', () => {
    if (s && !saved && armed === null) {
      btnNueva.textContent = 'La sesión no quedó guardada y no descargaste los archivos. Toca otra vez para salir';
      btnNueva.classList.add('danger');
      armed = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    go('setup');
  });

  if (!s) return () => disarm();

  const panel = $<HTMLDetailsElement>('panel');
  panel.hidden = false;

  const guardado = $('guardado');
  let alive = true;
  void finished!.guardado.then((ok) => {
    if (!alive) return;
    if (ok) {
      guardado.textContent = 'Sesión guardada en este dispositivo. También aparece en la tabla de sesiones guardadas.';
      guardado.className = 'status ok';
    } else {
      saved = false;
      guardado.textContent = 'No se pudo guardar la sesión en este dispositivo. Descarga los archivos antes de salir.';
      guardado.className = 'status error';
      panel.open = true;
    }
  });
  $('aviso-ejemplo').hidden = s.grabacion !== null;

  // Metadatos
  const meta = $('meta');
  for (const [k, v] of metaLines(s)) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    meta.append(dt, dd);
  }

  // Tabla
  const tbody = $('filas');
  for (const r of summaryRows(s)) {
    const tr = document.createElement('tr');
    const cells = [r.orden, r.nombre, r.cobertura, r.tiempo, r.pasadas, r.toques, r.saltos];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = String(c);
      tr.append(td);
    }
    tbody.append(tr);
  }
  const nota = practiceSummary(s);
  const notaEl = $('nota-practica');
  notaEl.textContent =
    nota === null ? 'Esta sesión no tuvo ensayo de práctica: no hay correlación que mostrar.' : `Práctica: ${nota}`;

  // Miniaturas
  const minis: { canvas: HTMLCanvasElement; rec: DimensionRecord; practica: boolean }[] = [];
  const all = [...(s.practica ? [{ rec: s.practica, practica: true }] : []), ...s.dimensiones.map((rec) => ({ rec, practica: false }))];
  for (const { rec, practica } of all) {
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = practica ? `Práctica (punteada: velocidad real)` : rec.dimension.nombre;
    const dur = document.createElement('span');
    dur.className = 'muted';
    dur.textContent = ` · ${formatTime(rec.duracionS)}`;
    cap.append(dur);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `Curva de ${rec.dimension.nombre}`);
    fig.append(cap, canvas);
    $('minis').append(fig);
    minis.push({ canvas, rec, practica });
  }
  const drawMinis = () => {
    if (!panel.open) return;
    const palette = readPalette();
    for (const m of minis) {
      const c = fitCanvas(m.canvas);
      if (c) drawMini(c.ctx, c.w, c.h, m.rec.valores, m.rec.duracionS, palette, m.practica ? speedAt : undefined);
    }
  };
  // Con la sección plegada los canvas miden 0: se dibujan al abrirla.
  panel.addEventListener('toggle', () => requestAnimationFrame(drawMinis));
  const ro = new ResizeObserver(drawMinis);
  for (const m of minis) ro.observe(m.canvas);
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', drawMinis);

  // Descargas
  const files = buildAllFiles(s);
  $('base').textContent = `Nombre base: ${fileBase(s)}`;
  const status = $('dl-status');
  const box = $('descargas');
  for (const f of files) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = f.kind === 'ventanas' ? 'btn primary' : 'btn';
    b.textContent = FILE_LABELS[f.kind];
    b.title = f.name;
    b.addEventListener('click', () => {
      downloadFile(f);
      saved = true;
      disarm();
      status.textContent = `Descargado: ${f.name}`;
      status.className = 'status ok';
    });
    box.append(b);
  }
  if (canShareFiles(files)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sea';
    b.textContent = 'Compartir los 4 archivos';
    b.addEventListener('click', async () => {
      try {
        if (await shareFiles(files, fileBase(s))) {
          saved = true;
          disarm();
          status.textContent = 'Archivos compartidos.';
          status.className = 'status ok';
        }
      } catch {
        status.textContent = 'No se pudo compartir. Usa los botones de descarga.';
        status.className = 'status error';
      }
    });
    box.append(b);
  }

  return () => {
    alive = false;
    disarm();
    ro.disconnect();
    mql.removeEventListener('change', drawMinis);
  };
};
