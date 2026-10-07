// Destellos de sincronización (SPEC §16.4 y §16.5), dentro de la pantalla de configuración:
// detección automática al tener el video y un CSV con filas sync, tabla de revisión, visor cuadro
// a cuadro, recuadro marcado a mano y elección entre sincronizar por tramos o con un solo destello.
import type { RawEvent } from '../data/events';
import {
  boxAround,
  chooseRegion,
  findRegions,
  flashesOf,
  matchFlashes,
  pixelsInBox,
  type Box,
  type FlashMatch,
  type PulseAccumulator,
} from '../data/flash';
import { MAX_DIF_INTERVALO_S, syncQuality, type SyncPoint } from '../data/sync';
import { DEFAULT_FRAME_S, FlashVideo, ScanCancelled } from '../players/flashScan';

export interface FlashReviewOptions {
  /** Recuadro recordado de sesiones anteriores. */
  getBox(): Box | null;
  /** Guarda el recuadro elegido o marcado. */
  setBox(box: Box): void;
  /** Segundo del campo de un solo destello: sirve para estimar dónde buscar si no se encontró nada. */
  singleV(): number;
  /** Se encontró o marcó el destello de la primera fila sync (para el campo de un solo destello). */
  onFirstFlash(v: number): void;
  /** Cambiaron los puntos, la elección o el estado. */
  onChange(): void;
}

export interface FlashReview {
  /** Video y filas sync actuales. Si cambian, se vuelve a detectar (o solo a emparejar, si el video es el mismo). */
  setInputs(file: File | null, syncs: readonly RawEvent[]): void;
  /** Puntos de la sesión si se sincroniza por tramos (al menos 2); null si se usa un solo destello. */
  points(): SyncPoint[] | null;
  /** Lo que impide comenzar la sesión. */
  startErrors(): string[];
  /** Final del último cuadro del video, medido tras el recorrido; null si aún no se midió. */
  videoEnd(): number | null;
  destroy(): void;
}

interface Row {
  etiqueta: string;
  lsl: number;
  v: number | null;
  origen: 'auto' | 'manual';
  /** Tiempo del recorrido a 4× aún sin precisar cuadro a cuadro. */
  aprox: boolean;
  incluido: boolean;
}

type Phase = 'inactivo' | 'abriendo' | 'analizando' | 'refinando' | 'listo' | 'cancelado' | 'error';

const num = (x: number, d: number) => x.toFixed(d).replace('.', ',');

export function mountFlashReview(card: HTMLElement, opts: FlashReviewOptions): FlashReview {
  card.hidden = true;
  card.innerHTML = `
    <h2>Destellos de sincronización</h2>
    <p class="muted hint" id="fr-hint"></p>
    <div class="row">
      <progress id="fr-progress" max="1" value="0" hidden></progress>
      <span class="status" id="fr-status" aria-live="polite"></span>
    </div>
    <div class="row fr-actions">
      <button type="button" class="btn ghost small" id="fr-cancelar" hidden>Cancelar</button>
      <button type="button" class="btn small" id="fr-detectar">Volver a detectar</button>
      <button type="button" class="btn ghost small" id="fr-marcar">Marcar el recuadro a mano</button>
    </div>
    <div class="fr-preview" id="fr-preview"></div>
    <div class="tablewrap">
      <table class="sessions fr-table">
        <thead><tr><th>Punto</th><th>LSL (s)</th><th>Video (s)</th><th>Dif. de intervalo</th><th>Ritmo</th><th></th></tr></thead>
        <tbody id="fr-rows"></tbody>
      </table>
    </div>
    <p class="status" id="fr-quality" aria-live="polite"></p>
    <fieldset class="fr-mode" id="fr-mode">
      <legend>Sincronizar con</legend>
      <label class="check"><input type="radio" name="fr-modo" value="tramos"> Todos los destellos, por tramos (corrige retraso, deriva y saltos)</label>
      <label class="check"><input type="radio" name="fr-modo" value="uno"> Solo el primero (el campo «Segundo del destello»)</label>
    </fieldset>
    <div class="fr-viewer" id="fr-viewer" hidden>
      <h3 id="fr-viewer-title"></h3>
      <div class="fr-stage" id="fr-stage"><div class="fr-box" id="fr-box" hidden></div></div>
      <div class="row fr-steps">
        <button type="button" class="btn ghost small" data-step="-1s" aria-label="Retroceder un segundo">−1 s</button>
        <button type="button" class="btn small" data-step="-1" aria-label="Cuadro anterior">◀ Cuadro</button>
        <span class="fr-time" id="fr-time"></span>
        <button type="button" class="btn small" data-step="1" aria-label="Cuadro siguiente">Cuadro ▶</button>
        <button type="button" class="btn ghost small" data-step="1s" aria-label="Avanzar un segundo">+1 s</button>
      </div>
      <div class="row">
        <button type="button" class="btn primary small" id="fr-usar">Usar este cuadro</button>
        <button type="button" class="btn ghost small" id="fr-tocar">Marcar el recuadro tocándolo</button>
        <button type="button" class="btn ghost small" id="fr-cerrar">Cerrar</button>
      </div>
      <p class="status" id="fr-viewer-status" aria-live="polite"></p>
    </div>
  `;
  const $ = <T extends HTMLElement>(id: string) => card.querySelector<T>(`#${id}`)!;
  const hint = $('fr-hint');
  const progress = $<HTMLProgressElement>('fr-progress');
  const status = $('fr-status');
  const btnCancelar = $<HTMLButtonElement>('fr-cancelar');
  const btnDetectar = $<HTMLButtonElement>('fr-detectar');
  const btnMarcar = $<HTMLButtonElement>('fr-marcar');
  const preview = $('fr-preview');
  const tbody = $('fr-rows');
  const quality = $('fr-quality');
  const modeBox = $('fr-mode');
  const radios = [...card.querySelectorAll<HTMLInputElement>('input[name="fr-modo"]')];
  const viewer = $('fr-viewer');
  const viewerTitle = $('fr-viewer-title');
  const stage = $('fr-stage');
  const boxEl = $('fr-box');
  const timeEl = $('fr-time');
  const btnUsar = $<HTMLButtonElement>('fr-usar');
  const btnTocar = $<HTMLButtonElement>('fr-tocar');
  const viewerStatus = $('fr-viewer-status');

  let file: File | null = null;
  let rows: Row[] = [];
  let fv: FlashVideo | null = null;
  let acc: PulseAccumulator | null = null;
  let box: Box | null = null;
  let phase: Phase = 'inactivo';
  let errorText = '';
  let fraction = 0;
  let refineDone = 0;
  let refineTotal = 0;
  let useTramos = false;
  let frameS = DEFAULT_FRAME_S;
  let contentEnd: number | null = null;
  /** Aumenta con cada detección o cambio de entrada, para ignorar resultados que llegan tarde. */
  let runId = 0;
  let abort = new AbortController();
  /** Visor: fila que se revisa (null: solo marcar el recuadro), cuadro a la vista y si se espera un toque. */
  let view: { row: number | null; shown: number; marking: boolean } | null = null;
  let stepping = false;

  const setStatus = (node: HTMLElement, text: string, kind: '' | 'ok' | 'warn' | 'error' = '') => {
    node.textContent = text;
    node.className = kind ? `status ${kind}` : 'status';
  };
  const busy = () => phase === 'abriendo' || phase === 'analizando' || phase === 'refinando';
  const found = () => rows.filter((r) => r.v !== null && r.incluido);
  const changed = () => {
    render();
    opts.onChange();
  };

  // ------------------------------------------------------------------------
  // Dibujo
  // ------------------------------------------------------------------------
  function render() {
    const n = rows.length;
    hint.textContent =
      n > 1
        ? `El CSV trae ${n} filas sync. Se busca cada destello en el video para sincronizar por tramos: así se corrigen el retraso, la deriva y los saltos de la transmisión.`
        : 'El CSV trae una fila sync. Se busca su destello en el video para llenar el campo «Segundo del destello».';

    progress.hidden = phase !== 'analizando' && phase !== 'refinando';
    progress.value = phase === 'analizando' ? fraction : refineTotal > 0 ? refineDone / refineTotal : 0;
    btnCancelar.hidden = !busy();
    btnDetectar.disabled = busy() || !file;
    btnMarcar.disabled = busy() || !fv;

    const f = found().length;
    if (phase === 'abriendo') setStatus(status, 'Preparando el video…');
    else if (phase === 'analizando') setStatus(status, `Buscando los destellos en el video… ${Math.round(fraction * 100)} %`);
    else if (phase === 'refinando') setStatus(status, `Precisando cada destello cuadro a cuadro… (${refineDone} de ${refineTotal})`);
    else if (phase === 'cancelado') {
      setStatus(status, 'Detección cancelada. Puedes volver a detectar, marcar los destellos a mano con «Ver» o sincronizar con un solo destello.', 'warn');
    } else if (phase === 'error') setStatus(status, errorText, 'error');
    else if (phase === 'listo') {
      if (rows.every((r) => r.v === null)) {
        setStatus(status, 'No se encontró el destello en el video. Abre «Ver» en una fila, ve a un cuadro donde se vea el destello y usa «Marcar el recuadro tocándolo».', 'error');
      } else if (rows.every((r) => r.v !== null)) setStatus(status, n === 1 ? 'Se encontró el destello.' : `Se encontraron los ${n} destellos.`, 'ok');
      else setStatus(status, `Se encontraron ${rows.filter((r) => r.v !== null).length} de ${n} destellos. Los que faltan se pueden marcar a mano con «Ver», o quitar.`, 'warn');
    } else setStatus(status, '');

    renderRows();

    // Calidad (§16.3) con los puntos incluidos.
    const pts = includedPoints();
    if (pts.length >= 2) {
      const q = syncQuality(pts);
      const ritmos = q.ritmoPorTramo;
      const text =
        `Diferencia de intervalo máx. ${num((q.difIntervaloMaxS ?? 0) * 1000, 0)} ms · ` +
        `ritmo entre ${num(Math.min(...ritmos), 4)} y ${num(Math.max(...ritmos), 4)} · ` +
        `residuo de la recta ${num(q.residuoRectaMaxMs ?? 0, 1)} ms.`;
      if (q.ok) setStatus(quality, text, 'ok');
      else {
        setStatus(
          quality,
          `${text} ${q.ordenValido ? `Una diferencia supera ${num(MAX_DIF_INTERVALO_S, 1)} s` : 'El orden de los destellos no coincide con el de las filas sync'}: ` +
            'hay un destello perdido, uno de más o un emparejamiento errado. Revísalos o sincroniza con un solo destello.',
          'error',
        );
      }
    } else setStatus(quality, '');

    modeBox.hidden = n < 2;
    const canTramos = f >= 2 && !busy();
    radios[0]!.disabled = !canTramos;
    radios[0]!.checked = useTramos && canTramos;
    radios[1]!.checked = !radios[0]!.checked;
    radios[1]!.disabled = busy();

    renderViewer();
  }

  function renderRows() {
    tbody.replaceChildren();
    let prev: Row | null = null;
    rows.forEach((r, k) => {
      const tr = document.createElement('tr');
      const cell = (text: string, cls = '') => {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.append(td);
      };
      cell(r.etiqueta);
      cell(num(r.lsl, 3));
      cell(r.v === null ? 'falta' : `${num(r.v, 3)}${r.aprox ? ' (aprox.)' : ''}${r.origen === 'manual' ? ' · a mano' : ''}`, r.v === null ? 'warn-text' : '');
      if (r.v !== null && r.incluido && prev) {
        const dv = r.v - prev.v!;
        const dl = r.lsl - prev.lsl;
        const dif = dv - dl;
        cell(`${dif >= 0 ? '+' : '−'}${num(Math.abs(dif) * 1000, 0)} ms`, Math.abs(dif) > MAX_DIF_INTERVALO_S ? 'error-text' : '');
        cell(dv > 0 ? num(dl / dv, 5) : '—');
      } else {
        cell('');
        cell('');
      }
      if (r.v !== null && r.incluido) prev = r;
      if (!r.incluido) tr.className = 'excluded';

      const td = document.createElement('td');
      td.className = 'file-buttons';
      const mk = (text: string, label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ghost small';
        b.textContent = text;
        b.setAttribute('aria-label', `${label} (${r.etiqueta})`);
        b.disabled = busy();
        b.addEventListener('click', fn);
        td.append(b);
      };
      mk(r.v === null ? 'Marcar' : 'Ver', r.v === null ? 'Marcar el destello' : 'Ver el destello', () => void openViewer(k, false));
      mk(r.incluido ? 'Quitar' : 'Incluir', r.incluido ? 'No usar este punto' : 'Usar este punto', () => {
        r.incluido = !r.incluido;
        changed();
      });
      tr.append(td);
      tbody.append(tr);
    });
  }

  function renderViewer() {
    viewer.hidden = view === null;
    if (!view || !fv) return;
    const r = view.row === null ? null : rows[view.row]!;
    viewerTitle.textContent = view.marking ? 'Marcar el recuadro del destello' : r ? `Destello de ${r.etiqueta}` : 'Video';
    timeEl.textContent = `${num(view.shown, 3)} s`;
    btnUsar.hidden = r === null;
    btnUsar.textContent = r ? `Usar este cuadro para ${r.etiqueta}` : '';
    const lock = busy() || stepping;
    for (const b of viewer.querySelectorAll<HTMLButtonElement>('button')) b.disabled = lock && b.id !== 'fr-cerrar';
    btnTocar.classList.toggle('danger', view.marking);
    btnTocar.textContent = view.marking ? 'Toca el destello en la imagen' : 'Marcar el recuadro tocándolo';
    stage.classList.toggle('marking', view.marking);
    boxEl.hidden = box === null;
    if (box) {
      boxEl.style.left = `${box.x * 100}%`;
      boxEl.style.top = `${box.y * 100}%`;
      boxEl.style.width = `${box.w * 100}%`;
      boxEl.style.height = `${box.h * 100}%`;
    }
  }

  // ------------------------------------------------------------------------
  // Detección
  // ------------------------------------------------------------------------
  const includedPoints = (): SyncPoint[] =>
    found().map((r) => ({ etiqueta: r.etiqueta, videoS: r.v!, lslS: r.lsl, origen: r.origen }));

  function fail(run: number, err: unknown) {
    if (run !== runId) return;
    if (err instanceof ScanCancelled) phase = 'cancelado';
    else {
      phase = 'error';
      errorText = `No se pudo analizar el video: ${err instanceof Error ? err.message : String(err)}`;
    }
    changed();
  }

  async function detect() {
    if (!file) return;
    const run = ++runId;
    abort.abort();
    abort = new AbortController();
    phase = 'abriendo';
    fraction = 0;
    view = null;
    changed();
    try {
      if (!fv) {
        const opened = await FlashVideo.open(file);
        if (run !== runId) return opened.destroy();
        fv = opened;
      }
      preview.append(fv.el);
      phase = 'analizando';
      render();
      acc = await fv.scan((f) => {
        if (run !== runId) return;
        fraction = f;
        render();
      }, abort.signal);
      if (run !== runId) return;
      contentEnd = await fv.lastFrameEnd();
      if (run !== runId) return;
      await locate(run);
    } catch (err) {
      fail(run, err);
    }
  }

  /** Elige el recuadro (el recordado si sirve, o el que se encuentre) y empareja sus destellos con los sync. */
  async function locate(run: number) {
    if (!acc) return;
    const lsl = rows.map((r) => r.lsl);
    const need = Math.min(2, lsl.length);
    let pick: { box: Box; match: FlashMatch } | null = null;
    const saved = opts.getBox();
    if (saved) {
      const match = matchFlashes(flashesOf(acc, pixelsInBox(acc, saved)), lsl);
      if (match.matched >= need) pick = { box: saved, match };
    }
    const auto = chooseRegion(findRegions(acc), lsl);
    if (auto && (!pick || auto.match.matched > pick.match.matched)) pick = { box: auto.region.box, match: auto.match };

    if (!pick) {
      box = saved;
      rows.forEach((r) => {
        if (r.origen === 'auto') r.v = null;
      });
      phase = 'listo';
      useTramos = false;
      changed();
      return;
    }
    box = pick.box;
    opts.setBox(pick.box);
    applyMatch(pick.match);
    await refineRows(run);
  }

  /** Pone los destellos emparejados en las filas, sin tocar las marcadas a mano. */
  function applyMatch(match: FlashMatch) {
    rows.forEach((r, k) => {
      if (r.origen === 'manual') return;
      r.v = match.pairs[k] ?? null;
      r.aprox = r.v !== null;
    });
  }

  async function refineRows(run: number) {
    if (!fv || !box) return;
    const pending = rows.filter((r) => r.v !== null && r.aprox);
    phase = 'refinando';
    refineDone = 0;
    refineTotal = pending.length;
    changed();
    try {
      for (const r of pending) {
        const res = await fv.refine(r.v!, box, abort.signal);
        if (run !== runId) return;
        if (res.v !== null) {
          r.v = res.v;
          r.aprox = false;
        }
        if (res.frameS) frameS = res.frameS;
        refineDone++;
        render();
      }
    } catch (err) {
      return fail(run, err);
    }
    phase = 'listo';
    useTramos = found().length >= 2;
    if (rows[0]?.v != null) opts.onFirstFlash(rows[0].v);
    changed();
  }

  // ------------------------------------------------------------------------
  // Visor (§16.5)
  // ------------------------------------------------------------------------
  /** Dónde debería estar el destello de una fila sin tiempo: desde el punto conocido más cercano. */
  function estimate(k: number): number {
    const known = found();
    const r = rows[k]!;
    if (known.length === 0) return opts.singleV() + (r.lsl - rows[0]!.lsl);
    const near = known.reduce((a, b) => (Math.abs(b.lsl - r.lsl) < Math.abs(a.lsl - r.lsl) ? b : a));
    return near.v! + (r.lsl - near.lsl);
  }

  async function openViewer(row: number | null, marking: boolean) {
    if (!fv) {
      setStatus(status, 'El video aún no está listo para verlo.', 'warn');
      return;
    }
    const t = row === null ? (found()[0]?.v ?? estimate(0)) : (rows[row]!.v ?? estimate(row));
    stage.prepend(fv.el);
    view = { row, shown: t, marking };
    setStatus(viewerStatus, marking ? 'Ve a un cuadro donde se vea el destello y tócalo.' : '');
    stepping = true;
    render();
    try {
      // Un poco después del tiempo del cuadro: saltar justo a él puede mostrar el anterior por redondeo.
      view.shown = await fv.showAt(t + 0.002);
    } finally {
      stepping = false;
      render();
    }
    viewer.scrollIntoView({ block: 'nearest' });
  }

  async function move(step: string) {
    if (!fv || !view || stepping) return;
    stepping = true;
    renderViewer();
    try {
      if (step === '-1') view.shown = await fv.step(view.shown, -1, frameS);
      else if (step === '1') view.shown = await fv.step(view.shown, 1, frameS);
      else view.shown = await fv.showAt(view.shown + (step === '1s' ? 1 : -1));
    } finally {
      stepping = false;
      renderViewer();
    }
  }

  for (const b of viewer.querySelectorAll<HTMLButtonElement>('[data-step]')) {
    b.addEventListener('click', () => void move(b.dataset.step!));
  }

  btnUsar.addEventListener('click', () => {
    if (!view || view.row === null) return;
    const r = rows[view.row]!;
    r.v = view.shown;
    r.origen = 'manual';
    r.aprox = false;
    r.incluido = true;
    if (view.row === 0) opts.onFirstFlash(r.v);
    if (found().length >= 2 && phase !== 'analizando') useTramos = true;
    setStatus(viewerStatus, `${r.etiqueta} quedó en ${num(r.v, 3)} s.`, 'ok');
    changed();
  });

  btnTocar.addEventListener('click', () => {
    if (!view) return;
    view.marking = !view.marking;
    setStatus(viewerStatus, view.marking ? 'Toca el destello en la imagen.' : '');
    renderViewer();
  });

  stage.addEventListener('click', (e) => {
    if (!view?.marking || !fv || busy()) return;
    const rect = fv.el.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return;
    const { mask, width, height } = fv.grabMask();
    const marked = boxAround(mask, width, height, rx, ry);
    if (!marked) {
      setStatus(viewerStatus, 'Ahí no hay una zona blanca del tamaño de un destello. Ve a un cuadro donde se vea el destello y toca su centro.', 'error');
      return;
    }
    box = marked;
    opts.setBox(marked);
    view.marking = false;
    if (!acc) {
      setStatus(viewerStatus, 'Recuadro marcado. Usa «Volver a detectar» para buscar los destellos con él.', 'ok');
      changed();
      return;
    }
    // Con el recorrido ya hecho no hace falta volver a recorrer el video: basta mirar los pulsos del recuadro.
    const run = ++runId;
    abort.abort();
    abort = new AbortController();
    const match = matchFlashes(flashesOf(acc, pixelsInBox(acc, marked)), rows.map((r) => r.lsl));
    setStatus(viewerStatus, `Recuadro marcado: ${match.matched} de ${rows.length} destellos encontrados en él.`, match.matched > 0 ? 'ok' : 'warn');
    applyMatch(match);
    void refineRows(run);
  });

  $('fr-cerrar').addEventListener('click', () => {
    view = null;
    fv?.el.remove();
    render();
  });

  btnCancelar.addEventListener('click', () => abort.abort());
  btnDetectar.addEventListener('click', () => {
    rows.forEach((r) => {
      r.v = null;
      r.origen = 'auto';
      r.aprox = false;
      r.incluido = true;
    });
    void detect();
  });
  btnMarcar.addEventListener('click', () => void openViewer(null, true));
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      useTramos = radios[0]!.checked;
      changed();
    });
  }

  // ------------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------------
  const signature = (syncs: readonly RawEvent[]) => syncs.map((s) => `${s.label}@${s.t}`).join('|');
  let currentSig = '';

  return {
    setInputs(next, syncs) {
      const sig = signature(syncs);
      if (next === file && sig === currentSig) return;
      const sameFile = next === file;
      runId++;
      abort.abort();
      abort = new AbortController();
      view = null;
      if (!sameFile) {
        fv?.destroy();
        fv = null;
        acc = null;
        contentEnd = null;
      }
      file = next;
      currentSig = sig;
      rows = syncs.map((s) => ({ etiqueta: s.label, lsl: s.t, v: null, origen: 'auto', aprox: false, incluido: true }));
      useTramos = false;
      phase = 'inactivo';
      card.hidden = file === null || rows.length === 0;
      if (card.hidden) return changed();
      box = opts.getBox();
      if (acc) {
        // Mismo video con otro CSV: basta volver a emparejar.
        void locate(runId).catch((err) => fail(runId, err));
      } else void detect();
      changed();
    },
    points() {
      if (card.hidden || !useTramos) return null;
      const pts = includedPoints();
      return pts.length >= 2 ? pts : null;
    },
    startErrors() {
      if (card.hidden) return [];
      if (busy()) return ['La detección de destellos sigue en curso: espera a que termine o cancélala.'];
      const pts = this.points();
      if (pts && !syncQuality(pts).ok) {
        return ['Los destellos no cuadran con las filas sync (ver «Destellos de sincronización»): revísalos o elige sincronizar con un solo destello.'];
      }
      return [];
    },
    videoEnd() {
      return contentEnd;
    },
    destroy() {
      runId++;
      abort.abort();
      fv?.destroy();
      fv = null;
    },
  };
}
