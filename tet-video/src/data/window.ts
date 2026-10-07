// Ventana de trazado: recorte virtual del video (SPEC §16.8). El niño ve y traza solo la partida,
// del destello de la primera fila sync al de la última (el fin de la partida); el archivo no cambia.
import type { VideoEvent } from './events';
import { HZ } from '../trace/trace';
import { lslToVideo, type Sync } from './sync';

/** Tramo del video, en segundos del video, que se reproduce y se traza. */
export interface Ventana {
  inicioS: number;
  finS: number;
}

/** Duración mínima de la ventana; si los destellos dan algo menor, se usa el video completo. */
export const VENTANA_MIN_S = 1;

/**
 * Ventana de trazado. Con filas sync, empieza en el destello de la primera y termina en el de la
 * última (pasadas por la sincronización, así que vale aunque falte algún destello en el video).
 * Con una sola fila sync termina al final del video. Sin filas sync (sin tiempo LSL), el video completo.
 * `videoEnd` es el final del último cuadro: la ventana nunca pasa de ahí.
 * La duración se recorta a un múltiplo de 1/HZ (menos de 0,1 s), para que la última muestra del
 * buffer caiga justo en el fin y no quede ninguna fila después.
 */
export function traceWindow(syncLsl: readonly number[], sync: Sync, videoEnd: number): Ventana {
  const whole = fitToGrid(0, videoEnd);
  if (syncLsl.length === 0 || sync.lslS === null) return whole;
  const first = lslToVideo(Math.min(...syncLsl), sync);
  const last = lslToVideo(Math.max(...syncLsl), sync);
  const inicioS = Math.min(Math.max(0, first), videoEnd);
  const finS = syncLsl.length >= 2 ? Math.min(Math.max(last, inicioS), videoEnd) : videoEnd;
  return finS - inicioS >= VENTANA_MIN_S ? fitToGrid(inicioS, finS) : whole;
}

/** Ventana con duración múltiplo de 1/HZ, sin pasar de `finS`. */
function fitToGrid(inicioS: number, finS: number): Ventana {
  const muestras = Math.floor((finS - inicioS) * HZ + 1e-6);
  return { inicioS, finS: inicioS + muestras / HZ };
}

/** Eventos (en tiempo del video) en el tiempo de la ventana, solo los que caen dentro. */
export function eventsInWindow(eventos: readonly VideoEvent[], v: Ventana): VideoEvent[] {
  const d = v.finS - v.inicioS;
  return eventos.map((e) => ({ ...e, t: e.t - v.inicioS })).filter((e) => e.t >= 0 && e.t <= d);
}
