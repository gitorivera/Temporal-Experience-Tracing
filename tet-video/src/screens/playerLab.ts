// Banco de pruebas TEMPORAL de la fase 3 para revisar los reproductores en un navegador real.
// Se elimina en la fase 4, cuando la pantalla de configuración use los reproductores.
import type { Player } from '../players/player';
import { createDemoPlayer, createPracticePlayer, formatTime } from '../players/scenes';
import { loadVideo } from '../players/videoPlayer';

/** Inserta la tarjeta después de `after`. */
export function mountPlayerLab(after: Element): () => void {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Probar reproductores (fase 3, temporal)</h2>
    <div class="row">
      <label class="btn">Cargar video <input type="file" accept="video/*" hidden id="lab-file"></label>
      <button class="btn" id="lab-practice">Práctica (40 s)</button>
      <button class="btn" id="lab-demo">Grabación de ejemplo (120 s)</button>
    </div>
    <p class="status" id="lab-status">Elige una fuente.</p>
    <div id="lab-stage" style="margin:12px 0;max-width:640px"></div>
    <input type="range" id="lab-scrub" min="0" max="1" step="0.01" value="0" style="width:100%;max-width:640px" disabled>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="lab-play" disabled>▶ Reproducir</button>
      <button class="btn" id="lab-zero" disabled>Ir a 0</button>
      <label>Velocidad
        <select id="lab-rate"><option value="1">1×</option><option value="1.5">1,5×</option><option value="2">2×</option></select>
      </label>
      <span id="lab-time" class="muted">0:00 / 0:00</span>
    </div>
    <p class="status" id="lab-log"></p>
  `;
  after.after(card);

  const $ = <T extends HTMLElement>(id: string) => card.querySelector<T>(`#${id}`)!;
  const stage = $('lab-stage');
  const status = $('lab-status');
  const scrub = $<HTMLInputElement>('lab-scrub');
  const playBtn = $<HTMLButtonElement>('lab-play');
  const zeroBtn = $<HTMLButtonElement>('lab-zero');
  const rate = $<HTMLSelectElement>('lab-rate');
  const time = $('lab-time');
  const log = $('lab-log');

  let player: Player | null = null;
  let seeks = 0;
  let raf = 0;

  const use = (p: Player, label: string) => {
    player?.destroy();
    player = p;
    seeks = 0;
    p.el.style.width = '100%';
    p.el.style.aspectRatio = '16 / 9';
    p.el.style.background = '#000';
    p.el.style.borderRadius = '12px';
    p.el.style.display = 'block';
    stage.replaceChildren(p.el);
    p.playbackRate = Number(rate.value);
    p.onEnded(() => {
      log.textContent = `Evento de fin recibido en ${p.currentTime.toFixed(3)} s.`;
    });
    scrub.max = String(p.duration);
    scrub.disabled = playBtn.disabled = zeroBtn.disabled = false;
    status.className = 'status ok';
    status.textContent = `${label} · duración ${formatTime(p.duration)} (${p.duration.toFixed(2)} s)`;
    log.textContent = '';
  };

  $<HTMLInputElement>('lab-file').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    status.className = 'status';
    status.textContent = 'Leyendo video…';
    try {
      use(await loadVideo(file), file.name);
    } catch (err) {
      status.className = 'status error';
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  $('lab-practice').addEventListener('click', () => use(createPracticePlayer(), 'Práctica'));
  $('lab-demo').addEventListener('click', () => use(createDemoPlayer(), 'Grabación de ejemplo'));

  playBtn.addEventListener('click', async () => {
    if (!player) return;
    if (player.paused) {
      try {
        await player.play();
      } catch (err) {
        log.textContent = `El navegador bloqueó la reproducción: ${err instanceof Error ? err.message : err}`;
      }
    } else player.pause();
  });
  zeroBtn.addEventListener('click', () => {
    if (player) player.currentTime = 0;
  });
  rate.addEventListener('change', () => {
    if (player) player.playbackRate = Number(rate.value);
  });
  scrub.addEventListener('input', () => {
    if (!player) return;
    player.currentTime = Number(scrub.value);
    seeks++;
  });

  const loop = () => {
    if (player) {
      const t = player.currentTime;
      if (document.activeElement !== scrub) scrub.value = String(t);
      time.textContent = `${formatTime(t)} / ${formatTime(player.duration)} · ${t.toFixed(2)} s · saltos: ${seeks}`;
      playBtn.textContent = player.paused ? '▶ Reproducir' : '❚❚ Pausa';
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    player?.destroy();
    card.remove();
  };
}
