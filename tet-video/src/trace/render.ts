// Dibujo de la gráfica y de la línea de tiempo (SPEC §7.2, §7.5).
// Todo se dibuja en píxeles CSS; el contexto ya viene escalado por devicePixelRatio.
import type { VideoEvent } from '../data/events';
import { HZ } from './trace';

/** Margen vertical de la gráfica (SPEC §7.3). */
export const GRAPH_PAD_Y = 14;
/**
 * Margen horizontal, igual en la gráfica y en la línea de tiempo: así la misma x es el mismo
 * instante en ambas, y el punto y la perilla caben enteros en los extremos.
 */
export const PAD_X = 20;
export const DOT_RADIUS = 16;
export const TRACE_WIDTH = 6;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------
// Geometría (sin DOM, con pruebas)
// ---------------------------------------------------------------------------

/** valor = clamp(1 − (y − padding) / (alto − 2·padding), 0, 1) (SPEC §7.3). */
export function valueFromY(y: number, height: number, pad = GRAPH_PAD_Y): number {
  const span = height - 2 * pad;
  return span > 0 ? clamp(1 - (y - pad) / span, 0, 1) : 0.5;
}

export function yFromValue(v: number, height: number, pad = GRAPH_PAD_Y): number {
  return pad + (1 - v) * (height - 2 * pad);
}

export function xFromTime(t: number, duration: number, width: number, padX = PAD_X): number {
  const f = duration > 0 ? clamp(t / duration, 0, 1) : 0;
  return padX + f * Math.max(0, width - 2 * padX);
}

export function timeFromX(x: number, duration: number, width: number, padX = PAD_X): number {
  const span = width - 2 * padX;
  return span > 0 ? clamp((x - padX) / span, 0, 1) * duration : 0;
}

/** Valor del deslizador: el centro del pulgar recorre el alto menos un pulgar. */
export function sliderValueFromY(y: number, height: number, thumb: number): number {
  const span = height - thumb;
  return span > 0 ? clamp(1 - (y - thumb / 2) / span, 0, 1) : 0.5;
}

/** Borde superior del pulgar para un valor. */
export function sliderTopFromValue(v: number, height: number, thumb: number): number {
  return (1 - clamp(v, 0, 1)) * Math.max(0, height - thumb);
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export interface Palette {
  panel: string;
  ink: string;
  muted: string;
  line: string;
  sun: string;
  sea: string;
  trace: string;
}

export function readPalette(el: Element = document.documentElement): Palette {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    panel: v('--panel'),
    ink: v('--ink'),
    muted: v('--muted'),
    line: v('--line'),
    sun: v('--sun'),
    sea: v('--sea'),
    trace: v('--trace'),
  };
}

/** Ajusta el tamaño interno del canvas a su tamaño en pantalla y devuelve el contexto escalado. */
export function fitCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (c.width !== bw || c.height !== bh) {
    c.width = bw;
    c.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export interface GraphState {
  duration: number;
  values: ArrayLike<number>;
  /** Vacío en la práctica. */
  eventos: readonly VideoEvent[];
  /** Tiempo actual del video (cabezal). */
  t: number;
  /** Valor del punto amarillo; null para no dibujarlo. */
  dot: { t: number; v: number } | null;
}

export function drawGraph(ctx: CanvasRenderingContext2D, w: number, h: number, s: GraphState, p: Palette): void {
  ctx.clearRect(0, 0, w, h);
  const x = (t: number) => xFromTime(t, s.duration, w);
  const y = (v: number) => yFromValue(v, h);

  // 5 líneas horizontales: 0, 0,25, 0,5, 0,75, 1.
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (let k = 0; k <= 4; k++) {
    const yy = Math.round(y(k / 4)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }

  // Eventos: líneas verticales punteadas.
  if (s.eventos.length > 0) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = p.muted;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    for (const e of s.eventos) {
      const xx = x(e.t);
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Curva registrada, cortada donde no hay datos.
  ctx.strokeStyle = p.trace;
  ctx.lineWidth = TRACE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let open = false;
  for (let i = 0; i < s.values.length; i++) {
    const v = s.values[i]!;
    if (Number.isNaN(v)) {
      open = false;
      continue;
    }
    const xx = x(i / HZ);
    const yy = y(v);
    if (open) ctx.lineTo(xx, yy);
    else {
      ctx.moveTo(xx, yy);
      // Un punto suelto también se ve (lineCap round con un segmento de largo 0).
      ctx.lineTo(xx, yy);
      open = true;
    }
  }
  ctx.stroke();

  // Cabezal.
  const px = x(s.t);
  ctx.strokeStyle = p.sea;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, h);
  ctx.stroke();

  // Punto amarillo.
  if (s.dot) {
    ctx.fillStyle = p.sun;
    ctx.strokeStyle = p.panel;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x(s.dot.t), y(s.dot.v), DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Miniatura de una curva para la pantalla final (SPEC §11). `reference` dibuja además una curva
 * punteada (la velocidad real de la pelota en la práctica).
 */
export function drawMini(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  values: ArrayLike<number>,
  duration: number,
  p: Palette,
  reference?: (t: number) => number,
): void {
  const pad = 6;
  const x = (t: number) => xFromTime(t, duration, w, pad);
  const y = (v: number) => yFromValue(v, h, pad);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  for (let k = 0; k <= 2; k++) {
    const yy = Math.round(y(k / 2)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }

  if (reference) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = p.sea;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = Math.max(2, Math.round(w));
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * duration;
      if (k === 0) ctx.moveTo(x(t), y(reference(t)));
      else ctx.lineTo(x(t), y(reference(t)));
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = p.trace;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let open = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) {
      open = false;
      continue;
    }
    if (open) ctx.lineTo(x(i / HZ), y(v));
    else {
      ctx.moveTo(x(i / HZ), y(v));
      open = true;
    }
  }
  ctx.stroke();
}

export interface TimelineState {
  duration: number;
  eventos: readonly VideoEvent[];
  t: number;
  /** Bloqueada durante la grabación: se dibuja atenuada. */
  locked: boolean;
}

const EMOJI_FONT = `system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;

export function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, s: TimelineState, p: Palette): void {
  ctx.clearRect(0, 0, w, h);
  const x = (t: number) => xFromTime(t, s.duration, w);
  const barY = h * 0.72;
  const barH = 8;
  const x0 = x(0);
  const x1 = x(s.duration);
  const px = x(s.t);

  ctx.save();
  if (s.locked) ctx.globalAlpha = 0.6;

  // Barra y progreso.
  ctx.fillStyle = p.line;
  ctx.beginPath();
  ctx.roundRect(x0, barY - barH / 2, x1 - x0, barH, barH / 2);
  ctx.fill();
  ctx.fillStyle = p.sea;
  ctx.beginPath();
  ctx.roundRect(x0, barY - barH / 2, Math.max(barH, px - x0), barH, barH / 2);
  ctx.fill();

  // Íconos de eventos en su posición temporal.
  ctx.font = `22px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.ink;
  for (const e of s.eventos) ctx.fillText(e.icon, x(e.t), h * 0.3);

  // Perilla.
  ctx.fillStyle = p.sun;
  ctx.strokeStyle = p.panel;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, barY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
