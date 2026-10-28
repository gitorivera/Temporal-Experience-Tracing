// Pantalla del niño (SPEC §7): tarjeta de introducción, espera, grabación continua y «Listo»,
// para la práctica y cada dimensión. El tiempo de referencia es siempre el del reproductor.
import type { MountScreen } from '../main';
import { isoLocal } from '../data/export';
import { childEvents, type VideoEvent } from '../data/events';
import { eventsInWindow } from '../data/window';
import type { Player } from '../players/player';
import { createPracticePlayer } from '../players/scenes';
import { PRACTICE_DIMENSION, practiceCorrelation, speedAt } from '../practice';
import { correlationLevel, interpretCorrelation, velocidadTexto } from '../summary';
import {
  setFinished,
  takePlan,
  type Dimension,
  type DimensionRecord,
  type ModoRespuesta,
  type SessionData,
  type Velocidad,
} from '../state';
import { VELOCIDADES } from '../config';
import { deleteSession, putSession, sessionId, toStored } from '../data/storage';
import { DimensionRecorder, VALOR_INICIAL } from '../trace/recorder';
import { HoldInput, holdStep } from '../trace/hold';
import { ScreenAwake } from '../device';
import {
  drawGraph,
  drawMini,
  drawTimeline,
  fitCanvas,
  readPalette,
  sliderTopFromValue,
  sliderValueFromY,
  timeFromX,
  valueFromY,
  type Palette,
} from '../trace/render';

/** Alto del pulgar del deslizador en px CSS (SPEC §7.4); coincide con --thumb-size. */
const THUMB = 76;

interface Item {
  dimension: Dimension;
  practica: boolean;
  player: Player;
  eventos: readonly VideoEvent[];
}

const COMO: Record<ModoRespuesta, string> = {
  trazo: 'pon tu dedo en el recuadro y súbelo o bájalo',
  deslizador: 'sube o baja el botón amarillo',
  botones: 'mantén pulsado ▲ para subir la línea o ▼ para bajarla',
};

function instruction(practica: boolean, modo: ModoRespuesta): string {
  const how = COMO[modo];
  return practica
    ? `Mira la pelota. Cuando empiece a moverse, ${how}: arriba si va rápido, abajo si va lento.`
    : `Acuérdate de cómo te sentías mientras jugabas, no ahora viendo el video. La línea avanza sola: ${how}.`;
}

const MSG = {
  vacia: 'Toca «Empezar» para dibujar tu línea.',
  incompleta: 'Falta un pedazo de la línea.',
  interrumpida: 'Se interrumpió el video. Toca «Repetir» para dibujar otra vez.',
  sinReproducir: 'No se pudo reproducir el video. Toca «Empezar» otra vez.',
} as const;

export const mountTracing: MountScreen = (root, go) => {
  const plan = takePlan();
  if (!plan) {
    // Se llegó sin pasar por la configuración (p. ej. al recargar).
    queueMicrotask(() => go('setup'));
    return () => {};
  }

  const { config } = plan;
  const slider = config.modo === 'deslizador';
  const botones = config.modo === 'botones';
  // Cambian al reiniciar la sesión desde las opciones del investigador.
  let inicio = isoLocal(new Date());
  let t0 = performance.now();
  const msNow = () => performance.now() - t0;

  const practicePlayer = config.practica ? createPracticePlayer() : null;
  // El reproductor ya está recortado a la ventana (SPEC §16.8): los eventos se dibujan en su tiempo.
  // Con un video real, el niño ve solo los combos, los premios y los inicios (childEvents);
  // la grabación de ejemplo trae sus propios eventos.
  const visibles = plan.grabacion ? childEvents(plan.eventos) : plan.eventos;
  const ventanaEventos = eventsInWindow(visibles, plan.ventana);
  const items: Item[] = [
    ...(practicePlayer ? [{ dimension: { ...PRACTICE_DIMENSION }, practica: true, player: practicePlayer, eventos: [] }] : []),
    ...plan.orden.map((dimension) => ({ dimension, practica: false, player: plan.player, eventos: ventanaEventos })),
  ];
  let practicaRec: DimensionRecord | null = null;
  const dimensiones: DimensionRecord[] = [];

  // ------------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------------
  const el = document.createElement('section');
  el.className = `kid-screen tracing${slider ? ' slider-mode' : ''}${botones ? ' buttons-mode' : ''}`;
  el.innerHTML = `
    <header class="tr-top">
      <h1 class="tr-q"></h1>
      <span class="pill"></span>
    </header>
    <div class="tr-stage"></div>
    <div class="tr-track">
      <div class="tr-ylab" aria-hidden="true">
        <span class="tr-label tr-high"></span>
        <span class="tr-dots">
          <span class="dot" style="--d:30px"></span>
          <span class="dot" style="--d:22px"></span>
          <span class="dot" style="--d:15px"></span>
          <span class="dot" style="--d:9px"></span>
        </span>
        <span class="tr-label tr-low"></span>
      </div>
      <canvas class="tr-timeline" aria-label="Línea de tiempo del video. Toca o arrastra para ir a un momento."></canvas>
      <canvas class="tr-graph" aria-label="Área para dibujar la línea"></canvas>
      <div class="tr-slider" ${slider ? '' : 'hidden'} role="slider" aria-orientation="vertical"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><div class="tr-thumb"></div></div>
      <div class="tr-arrows" ${botones ? '' : 'hidden'}>
        <button type="button" class="tr-arrow" data-dir="1" aria-label="Subir la línea (flecha ↑)">▲</button>
        <button type="button" class="tr-arrow" data-dir="-1" aria-label="Bajar la línea (flecha ↓)">▼</button>
      </div>
    </div>
    <footer class="tr-bottom">
      <button type="button" class="btn sea kid" id="tr-run">▶ Empezar</button>
      <span class="tr-msg" aria-live="polite"></span>
      <button type="button" class="btn kid" id="tr-keep" hidden>Seguir dibujando</button>
      <button type="button" class="btn primary kid" id="tr-next">Listo</button>
    </footer>
    <div class="tr-intro" role="dialog" aria-modal="true">
      <div class="tr-intro-box">
        <p class="big tr-intro-q"></p>
        <p class="tr-intro-p"></p>
        <div class="tr-speed" role="group" aria-label="Velocidad del video">
          <span class="tr-speed-label">Velocidad del video</span>
          <span class="tr-speed-opts"></span>
        </div>
        <button type="button" class="btn primary kid" id="tr-go">¡Vamos!</button>
      </div>
    </div>
    <div class="tr-intro tr-check" role="dialog" aria-modal="true" aria-labelledby="tr-check-t" hidden>
      <div class="tr-intro-box tr-check-box">
        <p class="big tr-intro-q" id="tr-check-t">Resultado de la práctica</p>
        <canvas class="tr-check-graph" aria-label="Línea del niño y velocidad real de la pelota"></canvas>
        <p class="tr-check-legend"><span class="tr-key tr-key-trace"></span> Línea del niño
          <span class="tr-key tr-key-ref"></span> Velocidad real de la pelota</p>
        <p class="tr-check-r"></p>
        <div class="row tr-admin-actions">
          <button type="button" class="btn kid" id="tr-check-repetir">↺ Repetir la práctica</button>
          <button type="button" class="btn primary kid" id="tr-check-seguir">Seguir con las preguntas</button>
        </div>
      </div>
    </div>
    <div class="tr-rotate" aria-live="polite">
      <span class="tr-rotate-icon" aria-hidden="true">↻</span>
      <p class="big">Gira la tablet</p>
    </div>
    <div class="tr-intro tr-admin" role="dialog" aria-modal="true" aria-labelledby="tr-admin-t" hidden>
      <div class="tr-intro-box tr-admin-box">
        <p class="big tr-intro-q" id="tr-admin-t">Opciones del investigador</p>
        <p class="tr-intro-p tr-admin-p"></p>
        <div class="tr-speed" role="group" aria-label="Velocidad del video desde la próxima pasada">
          <span class="tr-speed-label">Velocidad del video (desde la próxima pasada)</span>
          <span class="tr-speed-opts"></span>
        </div>
        <div class="row tr-admin-actions">
          <button type="button" class="btn kid" id="tr-admin-seguir">Seguir con la sesión</button>
          <button type="button" class="btn danger kid" id="tr-admin-fin">Terminar la sesión aquí</button>
        </div>
        <div class="row tr-admin-actions tr-admin-reset-row">
          <button type="button" class="btn danger" id="tr-admin-reset">↺ Reiniciar todo sin guardar</button>
        </div>
        <p class="tr-admin-reset-note" hidden>Se borra lo trazado en esta sesión (también lo ya guardado en el dispositivo) y se empieza otra vez desde el principio. Toca otra vez para confirmar.</p>
      </div>
    </div>
  `;
  root.append(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const question = q('.tr-q');
  const pill = q('.pill');
  const stage = q('.tr-stage');
  const high = q('.tr-high');
  const low = q('.tr-low');
  const timeline = q<HTMLCanvasElement>('.tr-timeline');
  const graph = q<HTMLCanvasElement>('.tr-graph');
  const sliderBox = q('.tr-slider');
  const thumb = q('.tr-thumb');
  const btnRun = q<HTMLButtonElement>('#tr-run');
  const btnKeep = q<HTMLButtonElement>('#tr-keep');
  const btnNext = q<HTMLButtonElement>('#tr-next');
  const msg = q('.tr-msg');
  const intro = q('.tr-intro');
  const introQ = q('.tr-intro-q');
  const introP = q('.tr-intro-p');
  const btnGo = q<HTMLButtonElement>('#tr-go');
  const admin = q('.tr-admin');
  const adminP = q('.tr-admin-p');
  const btnAdminSeguir = q<HTMLButtonElement>('#tr-admin-seguir');
  const btnAdminFin = q<HTMLButtonElement>('#tr-admin-fin');
  const btnAdminReset = q<HTMLButtonElement>('#tr-admin-reset');
  const resetNote = q('.tr-admin-reset-note');
  const arrows = q('.tr-arrows');
  const check = q('.tr-check');
  const checkGraph = q<HTMLCanvasElement>('.tr-check-graph');
  const checkR = q('.tr-check-r');
  const btnCheckRepetir = q<HTMLButtonElement>('#tr-check-repetir');
  const btnCheckSeguir = q<HTMLButtonElement>('#tr-check-seguir');

  // ------------------------------------------------------------------------
  // Estado de la dimensión en curso
  // ------------------------------------------------------------------------
  let idx = 0;
  let item = items[0]!;
  let rec = new DimensionRecorder(item.player.duration);
  let offEnded: () => void = () => {};
  /** Momento en que el niño pulsó «¡Vamos!»; de ahí se mide el tiempo de respuesta. */
  let introAt: number | null = null;
  /** «Listo» ya avisó que falta un pedazo; el siguiente toque acepta la línea así. */
  let confirmPending = false;
  let frame: number | null = null;
  let palette: Palette = readPalette();
  /** Velocidad que usará la próxima pasada; el investigador la cambia en cada dimensión. */
  let velocidad: Velocidad = config.velocidad;
  /** Velocidad de la última pasada empezada: la que se guarda con la dimensión. */
  let velPasada: Velocidad = velocidad;
  /** Botones ▲ ▼ o flechas pulsados ahora (modo botones). */
  const hold = new HoldInput();
  let lastFrameAt = performance.now();
  const arrowButtons = [...arrows.querySelectorAll<HTMLButtonElement>('.tr-arrow')];

  // ------------------------------------------------------------------------
  // Dibujo
  // ------------------------------------------------------------------------
  function render() {
    const t = item.player.currentTime;
    const g = fitCanvas(graph);
    if (g) {
      const dot =
        rec.state === 'grabando' ? { t, v: rec.value } : rec.state === 'espera' ? { t: 0, v: VALOR_INICIAL } : null;
      drawGraph(g.ctx, g.w, g.h, { duration: rec.duration, values: rec.trace.values, eventos: item.eventos, t, dot }, palette);
    }
    const tl = fitCanvas(timeline);
    if (tl) {
      drawTimeline(tl.ctx, tl.w, tl.h, { duration: rec.duration, eventos: item.eventos, t, locked: rec.state === 'grabando' }, palette);
    }
    if (slider) {
      const v = rec.state === 'grabando' ? rec.value : VALOR_INICIAL;
      thumb.style.top = `${sliderTopFromValue(v, sliderBox.clientHeight, THUMB)}px`;
      sliderBox.classList.toggle('inactive', rec.state !== 'grabando');
      sliderBox.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      sliderBox.setAttribute('aria-disabled', String(rec.state !== 'grabando'));
    }
    if (botones) {
      arrows.classList.toggle('inactive', rec.state !== 'grabando');
      for (const b of arrowButtons) b.classList.toggle('pressed', hold.isPressed(Number(b.dataset.dir) as 1 | -1));
    }
  }

  const ro = new ResizeObserver(() => {
    render();
    drawCheck();
  });
  ro.observe(graph);
  ro.observe(checkGraph);
  ro.observe(timeline);
  ro.observe(sliderBox);

  // El tema puede cambiar durante la sesión.
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => {
    palette = readPalette();
    render();
    drawCheck();
  };
  mql.addEventListener('change', onTheme);

  // ------------------------------------------------------------------------
  // Grabación
  // ------------------------------------------------------------------------
  function loop() {
    frame = null;
    if (rec.state !== 'grabando') return;
    const p = item.player;
    // Modo botones: el valor avanza según el tiempo real transcurrido desde el cuadro anterior.
    const ahora = performance.now();
    if (botones) rec.setValue(holdStep(rec.value, hold.direction, (ahora - lastFrameAt) / 1000));
    lastFrameAt = ahora;
    rec.sample(p.currentTime, msNow());
    // Respaldo por si el evento de fin no llega: el reproductor se detuvo en el final.
    if (p.paused && p.currentTime >= p.duration - 0.05) {
      onEnded();
      return;
    }
    render();
    frame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    hold.releaseAll();
  }

  function onEnded() {
    if (rec.state !== 'grabando') return;
    rec.finish(msNow());
    stopLoop();
    fingerDown = false;
    sliderDrag = false;
    updateControls();
    render();
  }

  function setMsg(text: string) {
    msg.textContent = text;
  }

  function hideConfirm() {
    confirmPending = false;
    btnKeep.hidden = true;
    btnNext.textContent = 'Listo';
  }

  function updateControls() {
    const recording = rec.state === 'grabando';
    btnRun.disabled = recording;
    // Durante la primera pasada sigue diciendo «Empezar»; «Repetir» aparece cuando ya hubo una.
    const previas = recording ? rec.pasadas - 1 : rec.pasadas;
    btnRun.textContent = previas === 0 ? '▶ Empezar' : '↺ Repetir';
    btnNext.disabled = recording;
  }

  btnRun.addEventListener('click', () => {
    if (rec.state === 'grabando') return;
    const p = item.player;
    hideConfirm();
    setMsg('');
    // SPEC §7.6: borrar, pausar, ir a 0, valor 0,5, fijar la velocidad y reproducir.
    p.pause();
    p.currentTime = 0;
    rec.begin(msNow());
    p.playbackRate = velocidad;
    velPasada = velocidad;
    updateControls();
    render();
    // play() se llama dentro del gesto del botón (autoplay, SPEC §13).
    p.play().catch(() => {
      if (rec.state !== 'grabando') return;
      rec.interrupt();
      stopLoop();
      setMsg(MSG.sinReproducir);
      updateControls();
      render();
    });
    stopLoop();
    lastFrameAt = performance.now();
    frame = requestAnimationFrame(loop);
  });

  // La app pasa a segundo plano durante una grabación: pausar e invalidar la pasada (SPEC §13).
  const onVisibility = () => {
    if (document.hidden && rec.state === 'grabando') {
      item.player.pause();
      rec.interrupt();
      stopLoop();
      fingerDown = false;
      sliderDrag = false;
      setMsg(MSG.interrumpida);
      updateControls();
      render();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ------------------------------------------------------------------------
  // Modo trazo: el dedo en la gráfica marca la altura; x se ignora (SPEC §7.3)
  // ------------------------------------------------------------------------
  let fingerDown = false;
  const graphValue = (ev: PointerEvent) => {
    const r = graph.getBoundingClientRect();
    return valueFromY(ev.clientY - r.top, r.height);
  };
  graph.addEventListener('pointerdown', (ev) => {
    if (config.modo !== 'trazo' || rec.state !== 'grabando') return;
    ev.preventDefault();
    graph.setPointerCapture(ev.pointerId);
    fingerDown = true;
    rec.touch();
    rec.setValue(graphValue(ev));
  });
  graph.addEventListener('pointermove', (ev) => {
    if (!fingerDown) return;
    ev.preventDefault();
    rec.setValue(graphValue(ev));
  });
  // Al soltar, el valor se mantiene y la línea sigue horizontal.
  const liftFinger = () => {
    fingerDown = false;
  };
  graph.addEventListener('pointerup', liftFinger);
  graph.addEventListener('pointercancel', liftFinger);

  // ------------------------------------------------------------------------
  // Modo deslizador (SPEC §7.4)
  // ------------------------------------------------------------------------
  let sliderDrag = false;
  const sliderValue = (ev: PointerEvent) => {
    const r = sliderBox.getBoundingClientRect();
    return sliderValueFromY(ev.clientY - r.top, r.height, THUMB);
  };
  sliderBox.addEventListener('pointerdown', (ev) => {
    if (!slider || rec.state !== 'grabando') return;
    ev.preventDefault();
    sliderBox.setPointerCapture(ev.pointerId);
    sliderDrag = true;
    rec.touch();
    rec.setValue(sliderValue(ev));
    render();
  });
  sliderBox.addEventListener('pointermove', (ev) => {
    if (!sliderDrag) return;
    ev.preventDefault();
    rec.setValue(sliderValue(ev));
  });
  const liftSlider = () => {
    sliderDrag = false;
  };
  sliderBox.addEventListener('pointerup', liftSlider);
  sliderBox.addEventListener('pointercancel', liftSlider);

  // ------------------------------------------------------------------------
  // Modo botones: ▲ ▼ en pantalla y flechas ↑ ↓ del teclado; mientras están pulsados el
  // valor se mueve (loop) y al soltar se queda. Cada pulsación nueva cuenta como un toque.
  // ------------------------------------------------------------------------
  const pressHold = (source: string, dir: 1 | -1) => {
    if (!botones || rec.state !== 'grabando') return;
    if (hold.press(source, dir)) rec.touch();
    render();
  };
  const releaseHold = (source: string) => {
    hold.release(source);
    render();
  };
  for (const b of arrowButtons) {
    const dir = Number(b.dataset.dir) as 1 | -1;
    b.addEventListener('pointerdown', (ev) => {
      if (!botones || rec.state !== 'grabando') return;
      ev.preventDefault();
      b.setPointerCapture(ev.pointerId);
      pressHold(`p${ev.pointerId}`, dir);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      b.addEventListener(type, (ev) => releaseHold(`p${ev.pointerId}`));
    }
    // Mantener pulsado en una pantalla táctil abre el menú contextual.
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  const KEY_DIR: Record<string, 1 | -1> = { ArrowUp: 1, ArrowDown: -1 };
  const onKeyDown = (ev: KeyboardEvent) => {
    const dir = KEY_DIR[ev.key];
    if (!botones || dir === undefined || !intro.hidden || !admin.hidden || !check.hidden) return;
    ev.preventDefault();
    if (!ev.repeat) pressHold(`k${ev.key}`, dir);
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    if (KEY_DIR[ev.key] !== undefined) releaseHold(`k${ev.key}`);
  };
  // Si la ventana pierde el foco, la tecla suelta no llega: soltar todo.
  const releaseAllHold = () => {
    hold.releaseAll();
    render();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAllHold);

  // ------------------------------------------------------------------------
  // Línea de tiempo: navegable fuera de la grabación; cada gesto es un salto (SPEC §7.5)
  // ------------------------------------------------------------------------
  let scrubbing = false;
  const seekTo = (ev: PointerEvent) => {
    const r = timeline.getBoundingClientRect();
    item.player.currentTime = timeFromX(ev.clientX - r.left, rec.duration, r.width);
    render();
  };
  timeline.addEventListener('pointerdown', (ev) => {
    if (!rec.seek()) return;
    ev.preventDefault();
    timeline.setPointerCapture(ev.pointerId);
    scrubbing = true;
    seekTo(ev);
  });
  timeline.addEventListener('pointermove', (ev) => {
    if (!scrubbing || rec.state === 'grabando') return;
    ev.preventDefault();
    seekTo(ev);
  });
  const endScrub = () => {
    scrubbing = false;
  };
  timeline.addEventListener('pointerup', endScrub);
  timeline.addEventListener('pointercancel', endScrub);

  // El cuadro llega después del salto: redibujar el cabezal cuando el video lo confirma.
  const onSeeked = () => {
    if (rec.state !== 'grabando') render();
  };
  plan.player.el.addEventListener('seeked', onSeeked);

  // ------------------------------------------------------------------------
  // «Listo» (SPEC §7.8)
  // ------------------------------------------------------------------------
  btnNext.addEventListener('click', () => {
    if (rec.state === 'grabando') return;
    const check = rec.check();
    if (check === 'vacia') {
      setMsg(MSG.vacia);
      return;
    }
    if (check === 'incompleta' && !confirmPending) {
      setMsg(MSG.incompleta);
      confirmPending = true;
      btnKeep.hidden = false;
      btnNext.textContent = 'Seguir así';
      return;
    }
    finishItem();
  });

  btnKeep.addEventListener('click', () => {
    hideConfirm();
    setMsg('');
  });

  // ------------------------------------------------------------------------
  // Paso de una dimensión a la siguiente
  // ------------------------------------------------------------------------
  function startItem(i: number) {
    offEnded();
    stopLoop();
    idx = i;
    item = items[i]!;
    const p = item.player;
    p.pause();
    p.currentTime = 0;
    stage.replaceChildren(p.el);
    rec = new DimensionRecorder(p.duration);
    velPasada = velocidad;
    offEnded = p.onEnded(onEnded);
    introAt = null;
    fingerDown = false;
    sliderDrag = false;
    scrubbing = false;

    question.textContent = item.dimension.pregunta;
    high.textContent = item.dimension.etiquetaSuperior;
    low.textContent = item.dimension.etiquetaInferior;
    pill.classList.toggle('practice', item.practica);
    const n = items.slice(0, i + 1).filter((it) => !it.practica).length;
    pill.textContent = item.practica ? 'Práctica' : `${n} de ${plan!.orden.length}`;
    sliderBox.setAttribute('aria-label', item.dimension.pregunta);

    hideConfirm();
    setMsg('');
    updateControls();

    introQ.textContent = item.dimension.pregunta;
    introP.textContent = instruction(item.practica, config.modo);
    intro.hidden = false;
    btnGo.focus();
    requestAnimationFrame(render);
  }

  btnGo.addEventListener('click', () => {
    intro.hidden = true;
    introAt = performance.now();
    btnRun.focus();
    render();
  });

  function finishItem() {
    item.player.pause();
    const tiempo = introAt === null ? null : (performance.now() - introAt) / 1000;
    const r: DimensionRecord = { ...rec.toRecord(item.dimension, config.modo, tiempo), velocidad: velPasada };
    if (item.practica) {
      // Las pasadas y los saltos de los intentos anteriores de la práctica se acumulan.
      r.pasadas += practicaPrevia.pasadas;
      r.saltosVideo += practicaPrevia.saltos;
      practicaRec = r;
    } else dimensiones.push(r);
    save();
    if (item.practica) showCheck(r);
    else nextItem();
  }

  function nextItem() {
    if (idx + 1 < items.length) startItem(idx + 1);
    else endSession();
  }

  // ------------------------------------------------------------------------
  // Resultado de la práctica: el investigador ve si el niño entendió la tarea
  // antes de pasar a las preguntas, y puede repetirla.
  // ------------------------------------------------------------------------
  /** Pasadas y saltos de los intentos de práctica ya descartados con «Repetir la práctica». */
  const practicaPrevia = { pasadas: 0, saltos: 0 };

  function drawCheck() {
    if (check.hidden || !practicaRec) return;
    const c = fitCanvas(checkGraph);
    if (c) drawMini(c.ctx, c.w, c.h, practicaRec.valores, practicaRec.duracionS, palette, speedAt);
  }

  function showCheck(r: DimensionRecord) {
    const corr = practiceCorrelation(r.valores);
    checkR.textContent = interpretCorrelation(corr);
    checkR.dataset.nivel = correlationLevel(corr);
    check.hidden = false;
    btnCheckSeguir.focus();
    requestAnimationFrame(drawCheck);
  }

  btnCheckRepetir.addEventListener('click', () => {
    if (check.hidden || !practicaRec) return;
    // El intento anterior queda guardado hasta que el nuevo lo reemplace (si la sesión se
    // termina antes, no se pierde); sus pasadas y saltos se suman al nuevo.
    practicaPrevia.pasadas = practicaRec.pasadas;
    practicaPrevia.saltos = practicaRec.saltosVideo;
    check.hidden = true;
    startItem(idx);
  });

  btnCheckSeguir.addEventListener('click', () => {
    if (check.hidden) return;
    check.hidden = true;
    nextItem();
  });

  /**
   * Respaldo en IndexedDB tras cada dimensión (SPEC §9). Los guardados se encadenan para que
   * terminen en orden; un fallo no interrumpe al niño, pero la pantalla final lo avisa.
   */
  let saveChain: Promise<boolean> = Promise.resolve(true);
  function save() {
    const stored = toStored(buildSession(), plan!.orden.length);
    saveChain = saveChain.then(() =>
      putSession(stored).then(
        () => true,
        (err: unknown) => {
          console.error('No se pudo guardar la sesión en IndexedDB', err);
          return false;
        },
      ),
    );
  }

  function buildSession(): SessionData {
    return {
      participante: config.participante,
      condicion: config.condicion,
      inicio,
      grabacion: plan!.grabacion,
      sincronizacion: plan!.sincronizacion,
      ventana: plan!.ventana,
      eventos: plan!.eventos,
      modo: config.modo,
      velocidad: config.velocidad,
      ordenAleatorio: config.ordenAleatorio,
      resolucionS: config.resolucionS,
      practica: practicaRec,
      // Copia: cada guardado lleva las dimensiones terminadas hasta ese momento.
      dimensiones: [...dimensiones],
    };
  }

  /** `antes`: el investigador terminó la sesión sin responder todas las dimensiones. */
  function endSession(antes = false) {
    setFinished({
      session: buildSession(),
      guardado: saveChain,
      totalDimensiones: plan!.orden.length,
      terminadaAntes: antes,
    });
    go('done');
  }

  // ------------------------------------------------------------------------
  // Salida del investigador: mantener pulsado el indicador «2 de 4» (o «Práctica»)
  // ------------------------------------------------------------------------
  const LONG_PRESS_MS = 2000;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPress = () => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };
  pill.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    cancelPress();
    pressTimer = setTimeout(openAdmin, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) pill.addEventListener(type, cancelPress);
  pill.addEventListener('contextmenu', (ev) => ev.preventDefault());

  function openAdmin() {
    pressTimer = null;
    if (rec.state === 'grabando') {
      // La pasada en curso no vale: si el investigador decide seguir, el niño la repite.
      item.player.pause();
      rec.interrupt();
      stopLoop();
      fingerDown = false;
      sliderDrag = false;
      setMsg(MSG.interrumpida);
      updateControls();
      render();
    }
    const total = plan!.orden.length;
    const hechas = dimensiones.length;
    adminP.textContent =
      `Quedaron guardadas ${hechas} de ${total} ${total === 1 ? 'dimensión' : 'dimensiones'}` +
      `${practicaRec ? ' y la práctica' : ''}. Si terminas aquí, la dimensión en curso no se guarda.`;
    cancelReset();
    admin.hidden = false;
    btnAdminSeguir.focus();
  }

  btnAdminSeguir.addEventListener('click', () => {
    cancelReset();
    admin.hidden = true;
    (intro.hidden ? btnRun : btnGo).focus();
  });
  btnAdminFin.addEventListener('click', () => {
    admin.hidden = true;
    item.player.pause();
    endSession(true);
  });

  // ------------------------------------------------------------------------
  // Velocidad del video por dimensión: en la tarjeta de inicio y en las opciones del
  // investigador. Vale desde la próxima pasada y sigue en las dimensiones siguientes.
  // ------------------------------------------------------------------------
  const speedButtons: HTMLButtonElement[] = [];
  for (const group of el.querySelectorAll<HTMLElement>('.tr-speed-opts')) {
    for (const v of VELOCIDADES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tr-speed-btn';
      b.dataset.v = String(v);
      b.textContent = velocidadTexto(v);
      b.addEventListener('click', () => {
        velocidad = v;
        renderSpeed();
      });
      group.append(b);
      speedButtons.push(b);
    }
  }
  function renderSpeed() {
    for (const b of speedButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === velocidad));
  }
  renderSpeed();

  // ------------------------------------------------------------------------
  // Reinicio total: borra todo lo de esta sesión (también lo ya guardado) y empieza de
  // nuevo desde la práctica o la primera dimensión. Confirmación en dos toques.
  // ------------------------------------------------------------------------
  let resetPending = false;
  function cancelReset() {
    resetPending = false;
    resetNote.hidden = true;
    btnAdminReset.textContent = '↺ Reiniciar todo sin guardar';
  }

  btnAdminReset.addEventListener('click', () => {
    if (!resetPending) {
      resetPending = true;
      resetNote.hidden = false;
      btnAdminReset.textContent = 'Sí, borrar todo y reiniciar';
      return;
    }
    cancelReset();
    admin.hidden = true;
    check.hidden = true;
    item.player.pause();
    stopLoop();
    // Lo guardado (práctica y dimensiones terminadas) se borra después de los guardados pendientes.
    const id = sessionId({ inicio, participante: config.participante });
    saveChain = saveChain.then(() =>
      deleteSession(id).then(
        () => true,
        (err: unknown) => {
          console.error('No se pudo borrar la sesión reiniciada de IndexedDB', err);
          return false;
        },
      ),
    );
    inicio = isoLocal(new Date());
    t0 = performance.now();
    practicaRec = null;
    dimensiones.length = 0;
    practicaPrevia.pasadas = 0;
    practicaPrevia.saltos = 0;
    velocidad = config.velocidad;
    renderSpeed();
    setMsg('');
    startItem(0);
  });

  // Mantener la pantalla encendida durante la sesión (SPEC §7.9).
  const awake = new ScreenAwake();
  awake.start();

  startItem(0);

  return () => {
    cancelPress();
    awake.stop();
    stopLoop();
    offEnded();
    ro.disconnect();
    mql.removeEventListener('change', onTheme);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', releaseAllHold);
    plan.player.el.removeEventListener('seeked', onSeeked);
    plan.player.destroy();
    practicePlayer?.destroy();
  };
};
