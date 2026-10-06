// Pantalla del niño (SPEC §7): tarjeta de introducción, espera, grabación continua y «Listo»,
// para la práctica y cada dimensión. El tiempo de referencia es siempre el del reproductor.
import type { MountScreen } from '../main';
import { isoLocal } from '../data/export';
import type { VideoEvent } from '../data/events';
import type { Player } from '../players/player';
import { createPracticePlayer } from '../players/scenes';
import { PRACTICE_DIMENSION } from '../practice';
import { setFinished, takePlan, type Dimension, type DimensionRecord, type SessionData } from '../state';
import { putSession, toStored } from '../data/storage';
import { DimensionRecorder, VALOR_INICIAL } from '../trace/recorder';
import {
  drawGraph,
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

function instruction(practica: boolean, slider: boolean): string {
  const how = slider ? 'sube o baja el botón amarillo' : 'pon tu dedo en el recuadro y súbelo o bájalo';
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
  const inicio = isoLocal(new Date());
  const t0 = performance.now();
  const msNow = () => performance.now() - t0;

  const practicePlayer = config.practica ? createPracticePlayer() : null;
  const items: Item[] = [
    ...(practicePlayer ? [{ dimension: { ...PRACTICE_DIMENSION }, practica: true, player: practicePlayer, eventos: [] }] : []),
    ...plan.orden.map((dimension) => ({ dimension, practica: false, player: plan.player, eventos: plan.eventos })),
  ];
  let practicaRec: DimensionRecord | null = null;
  const dimensiones: DimensionRecord[] = [];

  // ------------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------------
  const el = document.createElement('section');
  el.className = `kid-screen tracing${slider ? ' slider-mode' : ''}`;
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
      <div class="tr-slider" ${slider ? '' : 'hidden'} aria-label="Deslizador"><div class="tr-thumb"></div></div>
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
        <button type="button" class="btn primary kid" id="tr-go">¡Vamos!</button>
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
    }
  }

  const ro = new ResizeObserver(() => render());
  ro.observe(graph);
  ro.observe(timeline);
  ro.observe(sliderBox);

  // El tema puede cambiar durante la sesión.
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => {
    palette = readPalette();
    render();
  };
  mql.addEventListener('change', onTheme);

  // ------------------------------------------------------------------------
  // Grabación
  // ------------------------------------------------------------------------
  function loop() {
    frame = null;
    if (rec.state !== 'grabando') return;
    const p = item.player;
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
    p.playbackRate = config.velocidad;
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
    if (slider || rec.state !== 'grabando') return;
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

    hideConfirm();
    setMsg('');
    updateControls();

    introQ.textContent = item.dimension.pregunta;
    introP.textContent = instruction(item.practica, slider);
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
    const r = rec.toRecord(item.dimension, config.modo, tiempo);
    if (item.practica) practicaRec = r;
    else dimensiones.push(r);
    save();
    if (idx + 1 < items.length) startItem(idx + 1);
    else endSession();
  }

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

  function endSession() {
    setFinished({ session: buildSession(), guardado: saveChain });
    go('done');
  }

  startItem(0);

  return () => {
    stopLoop();
    offEnded();
    ro.disconnect();
    mql.removeEventListener('change', onTheme);
    document.removeEventListener('visibilitychange', onVisibility);
    plan.player.el.removeEventListener('seeked', onSeeked);
    plan.player.destroy();
    practicePlayer?.destroy();
  };
};
