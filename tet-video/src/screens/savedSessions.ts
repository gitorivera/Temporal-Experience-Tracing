// Tabla de sesiones guardadas en el dispositivo (SPEC §9), dentro de la pantalla de configuración:
// descarga de cada archivo, «Compartir», «Borrar» con dos toques y ZIP con todas las sesiones.
import { canShareFiles, downloadBlob, downloadFile, shareFiles } from '../data/download';
import { buildAllFiles, fileBase, type OutputFile } from '../data/export';
import {
  buildZip,
  deleteSession,
  estadoTexto,
  listSessions,
  requestPersistence,
  zipName,
  type StoredSession,
} from '../data/storage';

const SHORT_LABELS: Record<OutputFile['kind'], string> = {
  ventanas: 'Ventanas',
  hz10: '10 Hz',
  toques: 'Toques',
  json: 'JSON',
};

/** Llena `card` con la tabla. Devuelve la función de limpieza. */
export function mountSavedSessions(card: HTMLElement): () => void {
  card.innerHTML = `
    <h2>Sesiones guardadas en este dispositivo</h2>
    <p class="muted hint">Cada dimensión se guarda sola al terminarla. Descarga los archivos y luego borra la sesión de aquí.</p>
    <p class="status" id="ss-persist"></p>
    <div class="row" style="margin-bottom:12px">
      <button type="button" class="btn" id="ss-zip" disabled>Exportar todas las sesiones (ZIP)</button>
      <span class="status" id="ss-status" aria-live="polite"></span>
    </div>
    <div class="tablewrap">
      <table class="sessions">
        <thead><tr><th>Participante</th><th>Condición</th><th>Fecha</th><th>Estado</th><th>Archivos</th><th></th></tr></thead>
        <tbody id="ss-rows"></tbody>
      </table>
    </div>
    <p class="muted" id="ss-empty">Todavía no hay sesiones guardadas.</p>
  `;
  const $ = <T extends HTMLElement>(id: string) => card.querySelector<T>(`#${id}`)!;
  const rows = $('ss-rows');
  const empty = $('ss-empty');
  const table = card.querySelector<HTMLElement>('.tablewrap')!;
  const btnZip = $<HTMLButtonElement>('ss-zip');
  const status = $('ss-status');
  let alive = true;
  let sessions: StoredSession[] = [];
  // canShare depende del tipo de los archivos, no de su contenido: basta probar con archivos vacíos.
  const shareable = canShareFiles(
    (['ventanas', 'hz10', 'toques'] as const)
      .map((kind): OutputFile => ({ kind, name: `x_${kind}.csv`, mime: 'text/csv;charset=utf-8', content: '' }))
      .concat({ kind: 'json', name: 'x.json', mime: 'application/json;charset=utf-8', content: '' }),
  );
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const setStatus = (text: string, kind: '' | 'ok' | 'error' = '') => {
    status.textContent = text;
    status.className = kind ? `status ${kind}` : 'status';
  };

  void requestPersistence().then((granted) => {
    if (!alive) return;
    const p = $('ss-persist');
    if (granted === false) {
      p.textContent = 'El navegador no garantiza conservar estos datos si falta espacio: descarga los archivos pronto.';
      p.className = 'status warn';
    } else if (granted === true) {
      p.textContent = 'Almacenamiento persistente concedido.';
      p.className = 'status ok';
    }
  });

  function smallButton(text: string, cls: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn small ${cls}`;
    b.textContent = text;
    b.addEventListener('click', () => fn(b));
    return b;
  }

  function render() {
    rows.replaceChildren();
    empty.hidden = sessions.length > 0;
    table.hidden = sessions.length === 0;
    btnZip.disabled = sessions.length === 0;

    for (const st of sessions) {
      const s = st.sesion;
      const tr = document.createElement('tr');
      const td = (text: string) => {
        const c = document.createElement('td');
        c.textContent = text;
        tr.append(c);
        return c;
      };
      td(s.participante + (s.grabacion === null ? ' (ejemplo)' : ''));
      td(s.condicion);
      td(new Date(s.inicio).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }));
      td(estadoTexto(st)).className = st.completa ? 'ok-text' : 'warn-text';

      // Archivos: se generan al tocar, para no construir todos los CSV al abrir la pantalla.
      const files = td('');
      const box = document.createElement('div');
      box.className = 'file-buttons';
      const kinds: OutputFile['kind'][] = ['ventanas', 'hz10', 'toques', 'json'];
      for (const kind of kinds) {
        box.append(
          smallButton(SHORT_LABELS[kind], '', () => {
            const f = buildAllFiles(s).find((x) => x.kind === kind)!;
            downloadFile(f);
            setStatus(`Descargado: ${f.name}`, 'ok');
          }),
        );
      }
      if (shareable) {
        box.append(
          smallButton('Compartir', 'sea', async () => {
            try {
              if (await shareFiles(buildAllFiles(s), fileBase(s))) setStatus('Archivos compartidos.', 'ok');
            } catch {
              setStatus('No se pudo compartir. Usa los botones de descarga.', 'error');
            }
          }),
        );
      }
      files.append(box);

      // Borrar con confirmación en dos toques.
      const del = td('');
      let armed: ReturnType<typeof setTimeout> | null = null;
      del.append(
        smallButton('Borrar', 'danger', async (b) => {
          if (armed === null) {
            b.textContent = '¿Seguro? Toca otra vez';
            armed = setTimeout(() => {
              armed = null;
              b.textContent = 'Borrar';
            }, 4000);
            timers.add(armed);
            return;
          }
          clearTimeout(armed);
          armed = null;
          try {
            await deleteSession(st.id);
            setStatus(`Sesión de ${s.participante} borrada.`, 'ok');
          } catch {
            setStatus('No se pudo borrar la sesión.', 'error');
          }
          await refresh();
        }),
      );
      rows.append(tr);
    }
  }

  async function refresh() {
    try {
      const list = await listSessions();
      if (!alive) return;
      sessions = list;
      render();
    } catch {
      if (!alive) return;
      sessions = [];
      render();
      empty.textContent = 'No se pudo abrir el almacenamiento del navegador (¿modo privado?). Las sesiones no se guardarán.';
      empty.className = 'status error';
    }
  }

  btnZip.addEventListener('click', () => {
    if (sessions.length === 0) return;
    const zip = buildZip(sessions);
    downloadBlob(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), zipName());
    setStatus(`ZIP con ${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'} descargado.`, 'ok');
  });

  void refresh();

  return () => {
    alive = false;
    timers.forEach(clearTimeout);
  };
}
