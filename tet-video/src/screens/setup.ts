// Pantalla del investigador (SPEC §6): formulario de la sesión, lectura del video y de los eventos.
import type { MountScreen } from '../main';
import { dimensionOrder, loadSavedConfig, RESOLUCION_MIN, roundSync, saveConfig, validateConfig } from '../config';
import { parseEvents, parseNumber, toVideoEvents, type ParseResult, type Sync } from '../data/events';
import { syncFromPoints } from '../data/sync';
import { createDemoPlayer, DEMO_EVENTS, formatTime } from '../players/scenes';
import { loadVideo, VideoLoadError, type VideoPlayer } from '../players/videoPlayer';
import { APP_VERSION, configPorDefecto, setPlan, type Config, type Dimension } from '../state';
import { mountSavedSessions } from './savedSessions';
import { mountFlashReview } from './flashReview';
import { enterSessionMode, exitSessionMode } from '../device';

type ParsedOk = Extract<ParseResult, { ok: true }>;

/** localStorage puede no existir o lanzar al accederlo (modo privado, permisos). */
function getStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Número con coma decimal para mostrar en la interfaz. */
function num(x: number, decimals: number): string {
  return x.toFixed(decimals).replace('.', ',');
}

const DIM_FIELDS: readonly { key: keyof Dimension; label: string }[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'pregunta', label: 'Pregunta' },
  { key: 'etiquetaInferior', label: 'Etiqueta inferior' },
  { key: 'etiquetaSuperior', label: 'Etiqueta superior' },
];

export const mountSetup: MountScreen = (root, go) => {
  // La pantalla del investigador no va en pantalla completa ni con la orientación bloqueada.
  exitSessionMode();
  const store = getStore();
  const cfg: Config = loadSavedConfig(store);

  /** Video cargado; mientras no haya, se usará la grabación de ejemplo. */
  let video: { player: VideoPlayer; name: string; file: File } | null = null;
  /** Aumenta con cada archivo elegido, para ignorar cargas que terminan tarde. */
  let videoToken = 0;
  let loadingVideo = false;
  let events: { name: string; result: ParsedOk } | null = null;
  /** Al comenzar la sesión el reproductor pasa a la pantalla de trazado y no se destruye aquí. */
  let handedOff = false;

  const el = document.createElement('section');
  el.className = 'researcher';
  el.innerHTML = `
    <h1>Trazado de experiencia (TET)</h1>
    <p class="lead">Versión ${APP_VERSION} · <span id="offline-status">Comprobando el modo sin conexión…</span></p>

    <form id="setup-form" novalidate>
      <div class="card">
        <h2>Sesión</h2>
        <div class="fields">
          <label class="field">Código del participante
            <input type="text" id="f-participante" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="P01" required>
          </label>
          <label class="field">Condición jugada
            <select id="f-condicion">
              <option value="RM">Realidad mixta (RM)</option>
              <option value="Tablet">Tablet</option>
            </select>
          </label>
          <label class="field">Modo de respuesta
            <select id="f-modo">
              <option value="trazo">Trazo sobre la gráfica</option>
              <option value="deslizador">Deslizador lateral</option>
            </select>
            <small>En ambos el video corre sin pausas y la línea avanza sola; el niño solo sube o baja.</small>
          </label>
          <label class="field">Velocidad de reproducción
            <select id="f-velocidad">
              <option value="1">1×</option>
              <option value="1.5">1,5×</option>
              <option value="2">2×</option>
            </select>
            <small>Más rápido acorta la sesión, pero exige más al niño.</small>
          </label>
        </div>
        <div class="fields checks">
          <label class="check"><input type="checkbox" id="f-aleatorio"> Orden aleatorio de dimensiones</label>
          <label class="check"><input type="checkbox" id="f-practica"> Ensayo de práctica con la pelota</label>
        </div>
      </div>

      <div class="card">
        <h2>Grabación y eventos</h2>
        <div class="fields">
          <div class="field">
            <span>Video de la partida</span>
            <div class="row">
              <label class="btn file-btn">Elegir video<input type="file" id="f-video" accept="video/*" hidden></label>
              <button type="button" class="btn ghost" id="f-video-quitar" hidden>Quitar</button>
            </div>
            <p class="status" id="video-status" aria-live="polite"></p>
          </div>
          <div class="field">
            <span>CSV de eventos (opcional)</span>
            <div class="row">
              <label class="btn file-btn">Elegir archivo<input type="file" id="f-eventos" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden></label>
              <button type="button" class="btn ghost" id="f-eventos-quitar" hidden>Quitar</button>
            </div>
            <p class="status" id="eventos-status" aria-live="polite"></p>
            <p class="notice warn" id="aviso-coma">
              <strong>Ojo con la coma decimal.</strong> Si los tiempos llevan coma decimal (<code>1532,40</code>),
              separa las columnas con <code>;</code> o tabulador, o pon los números entre comillas.
              Con separador coma, <code>1532,40,sync</code> se lee como tiempo 1532 y etiqueta «40».
            </p>
          </div>
          <label class="field">Segundo del destello de sincronización en el video
            <input type="text" id="f-sync" inputmode="decimal" autocomplete="off">
            <small>Segundo del video donde aparece el destello que el juego marca en LSL. Dos decimales. Si el CSV trae filas sync, se llena solo con el destello encontrado.</small>
            <span class="status" id="sync-status" aria-live="polite"></span>
          </label>
          <label class="field">Resolución de exportación (s)
            <input type="text" id="f-resolucion" inputmode="decimal" autocomplete="off">
            <small>Ancho de las ventanas del CSV de promedios; mínimo 0,1. Ajústala a las ventanas del índice de engagement.</small>
            <span class="status" id="resolucion-status" aria-live="polite"></span>
          </label>
        </div>
        <details class="sample">
          <summary>Formato del CSV de eventos</summary>
          <p>Una columna de tiempo (segundos LSL o del juego), una de etiqueta y, si se quiere, una de ícono.
          Las filas cuya etiqueta empieza por <code>sync</code> se alinean con los destellos del video y permiten calcular el tiempo LSL de cada punto del trazo.
          Con varias (<code>sync_1</code>, <code>sync_2</code>, …) la sincronización se hace por tramos.</p>
          <pre>tiempo,evento,icono
1532.40,sync,⚡
1535.10,inicio nivel 1,🚩
1561.80,acierto,⭐
1590.25,error,❌</pre>
        </details>
      </div>

      <div class="card" id="destellos" hidden></div>

      <div class="card">
        <h2>Dimensiones</h2>
        <p class="muted hint">Una idea por dimensión, con palabras que un niño entienda. Las filas vacías se ignoran.</p>
        <div id="dims"></div>
        <div class="row" style="margin-top:12px">
          <button type="button" class="btn" id="dim-agregar">Agregar dimensión</button>
          <button type="button" class="btn ghost" id="dim-restaurar">Restaurar las de ejemplo</button>
        </div>
      </div>

      <div class="start-bar">
        <button type="submit" class="btn primary" id="comenzar">Comenzar sesión</button>
        <ul class="errors" id="errores" aria-live="assertive" hidden></ul>
      </div>
    </form>

    <div class="card" id="sesiones"></div>
  `;
  root.append(el);

  const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const form = $<HTMLFormElement>('setup-form');
  const fParticipante = $<HTMLInputElement>('f-participante');
  const fCondicion = $<HTMLSelectElement>('f-condicion');
  const fModo = $<HTMLSelectElement>('f-modo');
  const fVelocidad = $<HTMLSelectElement>('f-velocidad');
  const fAleatorio = $<HTMLInputElement>('f-aleatorio');
  const fPractica = $<HTMLInputElement>('f-practica');
  const fVideo = $<HTMLInputElement>('f-video');
  const fVideoQuitar = $<HTMLButtonElement>('f-video-quitar');
  const fEventos = $<HTMLInputElement>('f-eventos');
  const fEventosQuitar = $<HTMLButtonElement>('f-eventos-quitar');
  const fSync = $<HTMLInputElement>('f-sync');
  const fResolucion = $<HTMLInputElement>('f-resolucion');
  const videoStatus = $('video-status');
  const eventosStatus = $('eventos-status');
  const syncStatus = $('sync-status');
  const resolucionStatus = $('resolucion-status');
  const dimsBox = $('dims');
  const btnRestaurar = $<HTMLButtonElement>('dim-restaurar');
  const btnComenzar = $<HTMLButtonElement>('comenzar');
  const errores = $<HTMLUListElement>('errores');

  const setStatus = (node: HTMLElement, text: string, kind: '' | 'ok' | 'warn' | 'error' = '') => {
    node.textContent = text;
    node.className = kind ? `status ${kind}` : 'status';
  };

  // ------------------------------------------------------------------------
  // Valores iniciales (configuración recordada)
  // ------------------------------------------------------------------------
  fCondicion.value = cfg.condicion;
  fModo.value = cfg.modo;
  fVelocidad.value = String(cfg.velocidad);
  fAleatorio.checked = cfg.ordenAleatorio;
  fPractica.checked = cfg.practica;
  fSync.value = num(cfg.syncVideoS, 2);
  fResolucion.value = String(cfg.resolucionS).replace('.', ',');

  const persist = () => saveConfig(store, cfg);

  fParticipante.addEventListener('input', () => {
    cfg.participante = fParticipante.value;
  });
  fCondicion.addEventListener('change', () => {
    cfg.condicion = fCondicion.value as Config['condicion'];
    persist();
  });
  fModo.addEventListener('change', () => {
    cfg.modo = fModo.value as Config['modo'];
    persist();
  });
  fVelocidad.addEventListener('change', () => {
    cfg.velocidad = Number(fVelocidad.value) as Config['velocidad'];
    persist();
  });
  fAleatorio.addEventListener('change', () => {
    cfg.ordenAleatorio = fAleatorio.checked;
    persist();
  });
  fPractica.addEventListener('change', () => {
    cfg.practica = fPractica.checked;
    persist();
  });

  // ------------------------------------------------------------------------
  // Campos numéricos (aceptan punto o coma decimal)
  // ------------------------------------------------------------------------
  const readSync = () => {
    const x = parseNumber(fSync.value);
    cfg.syncVideoS = x === null ? NaN : roundSync(x);
    const bad = x === null || x < 0;
    fSync.setAttribute('aria-invalid', String(bad));
    if (bad) setStatus(syncStatus, 'Escribe un número mayor o igual que 0, p. ej. 12,40.', 'error');
    else if (video && cfg.syncVideoS > video.player.duration) {
      setStatus(syncStatus, `El destello queda después del final del video (${formatTime(video.player.duration)}).`, 'warn');
    } else setStatus(syncStatus, '');
  };
  fSync.addEventListener('input', () => {
    readSync();
    renderEventsStatus();
  });
  fSync.addEventListener('change', () => {
    readSync();
    if (Number.isFinite(cfg.syncVideoS)) {
      fSync.value = num(cfg.syncVideoS, 2);
      persist();
    }
  });

  const readResolucion = () => {
    const x = parseNumber(fResolucion.value);
    cfg.resolucionS = x ?? NaN;
    const bad = x === null || x < RESOLUCION_MIN;
    fResolucion.setAttribute('aria-invalid', String(bad));
    setStatus(resolucionStatus, bad ? 'Escribe un número mayor o igual que 0,1.' : '', bad ? 'error' : '');
  };
  fResolucion.addEventListener('input', readResolucion);
  fResolucion.addEventListener('change', () => {
    readResolucion();
    if (Number.isFinite(cfg.resolucionS) && cfg.resolucionS >= RESOLUCION_MIN) persist();
  });

  // ------------------------------------------------------------------------
  // Video
  // ------------------------------------------------------------------------
  const renderVideoStatus = () => {
    fVideoQuitar.hidden = video === null;
    if (loadingVideo) return;
    if (video) setStatus(videoStatus, `${video.name} · ${formatTime(video.player.duration)}`, 'ok');
    else setStatus(videoStatus, 'Sin video: se usará la grabación de ejemplo de 2 minutos.');
  };

  const dropVideo = () => {
    video?.player.destroy();
    video = null;
  };

  fVideo.addEventListener('change', async () => {
    const file = fVideo.files?.[0];
    fVideo.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    const token = ++videoToken;
    dropVideo();
    loadingVideo = true;
    btnComenzar.disabled = true;
    setStatus(videoStatus, `Leyendo ${file.name}…`);
    try {
      const player = await loadVideo(file);
      if (token !== videoToken || handedOff) {
        player.destroy();
        return;
      }
      video = { player, name: file.name, file };
    } catch (err) {
      if (token !== videoToken) return;
      const msg = err instanceof VideoLoadError ? err.message : 'No se pudo leer este video.';
      loadingVideo = false;
      btnComenzar.disabled = false;
      renderVideoStatus();
      setStatus(videoStatus, `${file.name}: ${msg} Mientras tanto se usará la grabación de ejemplo.`, 'error');
      updateFlashes();
      renderEventsStatus();
      return;
    }
    loadingVideo = false;
    btnComenzar.disabled = false;
    renderVideoStatus();
    readSync();
    updateFlashes();
    renderEventsStatus();
  });

  fVideoQuitar.addEventListener('click', () => {
    videoToken++;
    loadingVideo = false;
    btnComenzar.disabled = false;
    dropVideo();
    renderVideoStatus();
    readSync();
    updateFlashes();
    renderEventsStatus();
  });

  // ------------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------------
  // ------------------------------------------------------------------------
  // Destellos de sincronización (SPEC §16.4, §16.5)
  // ------------------------------------------------------------------------
  const flashes = mountFlashReview($('destellos'), {
    getBox: () => cfg.recuadroDestello,
    setBox: (box) => {
      cfg.recuadroDestello = box;
      persist();
    },
    singleV: () => (Number.isFinite(cfg.syncVideoS) ? cfg.syncVideoS : 0),
    onFirstFlash: (v) => {
      fSync.value = num(roundSync(v), 2);
      readSync();
      persist();
    },
    onChange: () => renderEventsStatus(),
  });
  /** Avisa a la tabla de destellos del video y las filas sync actuales. */
  const updateFlashes = () => flashes.setInputs(video?.file ?? null, events?.result.syncs ?? []);

  /**
   * Por tramos, si la tabla de destellos tiene al menos dos puntos y se eligió así; si no, un solo
   * destello: el del campo de configuración, emparejado con la primera fila sync.
   */
  const currentSync = (): Sync => {
    const puntos = events ? flashes.points() : null;
    if (puntos) return syncFromPoints(puntos);
    const videoS = Number.isFinite(cfg.syncVideoS) ? cfg.syncVideoS : 0;
    const first = events?.result.sync;
    return first
      ? syncFromPoints([{ etiqueta: first.label, videoS, lslS: first.t, origen: 'manual' }])
      : { videoS, lslS: null };
  };

  /** Mensaje del archivo leído, más cuántos eventos caen dentro del video con el destello actual. */
  function renderEventsStatus() {
    fEventosQuitar.hidden = events === null;
    if (!events) {
      if (!eventosStatus.classList.contains('error')) setStatus(eventosStatus, 'Sin archivo de eventos.');
      return;
    }
    const r = events.result;
    const parts = [`${events.name}: ${r.events.length} ${r.events.length === 1 ? 'evento leído' : 'eventos leídos'}`];
    parts.push(
      r.sync
        ? `fila de sincronización encontrada (${num(r.sync.t, 2)} s)`
        : 'sin fila de sincronización: los tiempos se toman como segundos desde el destello y no habrá tiempo LSL',
    );
    if (r.syncs.length > 1) {
      const puntos = video ? flashes.points() : null;
      parts.push(
        puntos
          ? `${r.syncs.length} filas de sincronización; se sincroniza por tramos con ${puntos.length} destellos`
          : `${r.syncs.length} filas de sincronización; se usa solo la primera (ver «Destellos de sincronización»)`,
      );
    }
    if (r.skipped > 0) parts.push(`${r.skipped} ${r.skipped === 1 ? 'fila descartada' : 'filas descartadas'} por no tener un tiempo numérico`);
    let text = parts.join(' · ') + '.';
    let kind: 'ok' | 'warn' = r.sync && r.skipped === 0 ? 'ok' : 'warn';

    if (video) {
      const inside = toVideoEvents(r.events, currentSync(), video.player.duration).length;
      const outside = r.events.length - inside;
      text += ` Con ${flashes.points() ? 'los destellos detectados' : `el destello en ${num(currentSync().videoS, 2)} s`}, ${inside} de ${r.events.length} caen dentro del video`;
      text += outside > 0 ? ` (${outside} fuera; se descartan).` : '.';
      if (inside === 0 && r.events.length > 0) kind = 'warn';
    } else {
      text += ' Sin video, la grabación de ejemplo usa sus propios eventos y este archivo no se usará.';
      kind = 'warn';
    }
    setStatus(eventosStatus, text, kind);
  }

  fEventos.addEventListener('change', async () => {
    const file = fEventos.files?.[0];
    fEventos.value = '';
    if (!file) return;
    events = null;
    updateFlashes();
    let text: string;
    try {
      text = await file.text();
    } catch {
      setStatus(eventosStatus, `${file.name}: no se pudo leer el archivo.`, 'error');
      fEventosQuitar.hidden = true;
      return;
    }
    const result = parseEvents(text);
    if (!result.ok) {
      setStatus(eventosStatus, `${file.name}: ${result.error}`, 'error');
      fEventosQuitar.hidden = true;
      return;
    }
    events = { name: file.name, result };
    updateFlashes();
    renderEventsStatus();
  });

  fEventosQuitar.addEventListener('click', () => {
    events = null;
    updateFlashes();
    setStatus(eventosStatus, '');
    renderEventsStatus();
  });

  // ------------------------------------------------------------------------
  // Dimensiones
  // ------------------------------------------------------------------------
  function renderDims() {
    dimsBox.replaceChildren();
    cfg.dimensiones.forEach((d, i) => {
      const row = document.createElement('fieldset');
      row.className = 'dim-row';
      const legend = document.createElement('legend');
      legend.textContent = `Dimensión ${i + 1}`;
      row.append(legend);

      const grid = document.createElement('div');
      grid.className = 'dim-fields';
      for (const { key, label } of DIM_FIELDS) {
        const lab = document.createElement('label');
        lab.className = `field dim-${key}`;
        lab.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.autocomplete = 'off';
        inp.value = d[key];
        inp.addEventListener('input', () => {
          d[key] = inp.value;
          persist();
        });
        lab.append(inp);
        grid.append(lab);
      }
      row.append(grid);

      const tools = document.createElement('div');
      tools.className = 'dim-tools';
      const mk = (text: string, title: string, disabled: boolean, fn: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ghost small';
        b.textContent = text;
        b.title = title;
        b.setAttribute('aria-label', `${title} (dimensión ${i + 1})`);
        b.disabled = disabled;
        b.addEventListener('click', () => {
          fn();
          persist();
          renderDims();
        });
        tools.append(b);
      };
      const list = cfg.dimensiones;
      mk('↑', 'Subir', i === 0, () => ([list[i - 1], list[i]] = [list[i]!, list[i - 1]!]));
      mk('↓', 'Bajar', i === list.length - 1, () => ([list[i], list[i + 1]] = [list[i + 1]!, list[i]!]));
      mk('Quitar', 'Quitar', false, () => list.splice(i, 1));
      row.append(tools);

      dimsBox.append(row);
    });
    if (cfg.dimensiones.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No hay dimensiones. Agrega una o restaura las de ejemplo.';
      dimsBox.append(p);
    }
  }

  $('dim-agregar').addEventListener('click', () => {
    cfg.dimensiones.push({ nombre: '', pregunta: '', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' });
    persist();
    renderDims();
    dimsBox.querySelector<HTMLInputElement>('.dim-row:last-child input')?.focus();
  });

  // Restaurar borra lo escrito: se confirma con un segundo toque.
  let restoreArmed: ReturnType<typeof setTimeout> | null = null;
  const disarmRestore = () => {
    if (restoreArmed !== null) clearTimeout(restoreArmed);
    restoreArmed = null;
    btnRestaurar.textContent = 'Restaurar las de ejemplo';
    btnRestaurar.classList.remove('danger');
  };
  btnRestaurar.addEventListener('click', () => {
    if (restoreArmed === null) {
      btnRestaurar.textContent = 'Toca otra vez para reemplazar las dimensiones';
      btnRestaurar.classList.add('danger');
      restoreArmed = setTimeout(disarmRestore, 4000);
      return;
    }
    disarmRestore();
    cfg.dimensiones = configPorDefecto().dimensiones;
    persist();
    renderDims();
  });

  // ------------------------------------------------------------------------
  // Comenzar
  // ------------------------------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (loadingVideo) return;
    readSync();
    readResolucion();
    const v = validateConfig(cfg);
    const syncErrors = video ? flashes.startErrors() : [];
    if (!v.ok || syncErrors.length > 0) {
      errores.replaceChildren(
        ...[...(v.ok ? [] : v.errors), ...syncErrors].map((msg) => {
          const li = document.createElement('li');
          li.textContent = msg;
          return li;
        }),
      );
      errores.hidden = false;
      return;
    }
    errores.hidden = true;
    persist();

    const config = v.config;
    const usandoVideo = video !== null;
    const sync: Sync = usandoVideo ? currentSync() : { videoS: 0, lslS: null };
    const player = video?.player ?? createDemoPlayer();
    const eventos = usandoVideo
      ? events
        ? toVideoEvents(events.result.events, sync, player.duration)
        : []
      : DEMO_EVENTS.map((ev) => ({ ...ev }));

    setPlan({
      config,
      player,
      grabacion: video?.name ?? null,
      sincronizacion: sync,
      eventos,
      orden: dimensionOrder(config),
    });
    handedOff = true;
    // Pantalla completa y horizontal desde el gesto del botón (SPEC §7.9).
    void enterSessionMode();
    go('tracing');
  });

  // ------------------------------------------------------------------------
  // Estado sin conexión
  // ------------------------------------------------------------------------
  const offline = $('offline-status');
  if (!('serviceWorker' in navigator)) {
    offline.textContent = 'este navegador no admite service workers: no funcionará sin conexión.';
    offline.className = 'warn-text';
  } else {
    navigator.serviceWorker.ready.then(() => {
      offline.textContent = 'lista para usarse sin conexión.';
      offline.className = 'ok-text';
    });
  }

  renderDims();
  renderVideoStatus();
  renderEventsStatus();
  const unmountSessions = mountSavedSessions($('sesiones'));

  return () => {
    unmountSessions();
    flashes.destroy();
    disarmRestore();
    videoToken++;
    if (!handedOff) dropVideo();
  };
};
