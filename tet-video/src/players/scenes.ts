// Escenas dibujadas en VirtualPlayer: práctica (40 s) y grabación de ejemplo (120 s) (SPEC §10).
// Los colores son fijos porque hacen las veces de un video, no siguen el tema.
import type { VideoEvent } from '../data/events';
import { ballPosition, PRACTICE_DURATION } from '../practice';
import { VirtualPlayer, type DrawScene, type VirtualEnv } from './virtualPlayer';

export const DEMO_DURATION = 120;

/** Eventos simulados de la grabación de ejemplo, ya en tiempo de video. */
export const DEMO_EVENTS: readonly VideoEvent[] = [
  { t: 3, label: 'inicio nivel 1', icon: '🚩' },
  { t: 18, label: 'acierto', icon: '⭐' },
  { t: 31, label: 'error', icon: '❌' },
  { t: 44, label: 'acierto', icon: '⭐' },
  { t: 60, label: 'inicio nivel 2', icon: '🚩' },
  { t: 77, label: 'error', icon: '❌' },
  { t: 89, label: 'premio', icon: '🎁' },
  { t: 104, label: 'acierto', icon: '⭐' },
  { t: 117, label: 'fin', icon: '🏁' },
];

const FONT = "'Nunito', system-ui, sans-serif";

/** m:ss */
export function formatTime(s: number): string {
  const x = Math.max(0, Math.floor(s));
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
}

function caption(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = `600 24px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 20, 36);
}

export const drawPractice: DrawScene = (ctx, t, w, h) => {
  ctx.fillStyle = '#1b2a4a';
  ctx.fillRect(0, 0, w, h);
  // Pista
  ctx.fillStyle = '#2e4166';
  ctx.beginPath();
  ctx.roundRect(60, h / 2 + 58, w - 120, 10, 5);
  ctx.fill();
  // Pelota
  const r = 46;
  const x = 60 + r + ballPosition(t) * (w - 120 - 2 * r);
  ctx.fillStyle = '#ffb703';
  ctx.beginPath();
  ctx.arc(x, h / 2, r, 0, Math.PI * 2);
  ctx.fill();
  caption(ctx, `Práctica · ${formatTime(t)}`);
};

const ROWS = 3;
const COLS = 4;

export const drawDemo: DrawScene = (ctx, t, w, h) => {
  const level2 = t >= 60;
  ctx.fillStyle = level2 ? '#3a2a55' : '#1d3b4f';
  ctx.fillRect(0, 0, w, h);

  // Tablero de 12 cartas que se voltean (escala horizontal para simular el giro).
  const cw = 110;
  const ch = 100;
  const gx = 40;
  const gy = 28;
  const x0 = (w - (COLS * cw + (COLS - 1) * gx)) / 2;
  const y0 = 70;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const k = r * COLS + c;
      const phase = Math.sin(t * 1.3 + k * 1.7) - 0.6;
      const face = phase > 0;
      const sx = Math.min(1, Math.abs(phase) * 6);
      const cx = x0 + c * (cw + gx) + cw / 2;
      const y = y0 + r * (ch + gy);
      ctx.fillStyle = face ? '#ffb703' : level2 ? '#6a5490' : '#3c5b7a';
      ctx.beginPath();
      ctx.roundRect(cx - (cw / 2) * sx, y, cw * sx, ch, 10);
      ctx.fill();
    }
  }

  // Texto del evento durante 2 s.
  const ev = DEMO_EVENTS.find((e) => t >= e.t && t < e.t + 2);
  if (ev) {
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 260, h - 96, 520, 70, 35);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${ev.icon} ${ev.label}`, w / 2, h - 61);
  }
  caption(ctx, `Grabación de ejemplo · ${formatTime(t)}`);
};

export function createPracticePlayer(env?: VirtualEnv): VirtualPlayer {
  return new VirtualPlayer(PRACTICE_DURATION, drawPractice, env);
}

export function createDemoPlayer(env?: VirtualEnv): VirtualPlayer {
  return new VirtualPlayer(DEMO_DURATION, drawDemo, env);
}
