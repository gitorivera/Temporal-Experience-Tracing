// Traducción entre el tiempo del video y el reloj LSL (SPEC §8.2 y §16).
// Con un destello: desfase fijo. Con varios: lineal por tramos entre destellos consecutivos,
// lo que corrige el retraso, la deriva y los saltos de la transmisión de la Quest al celular.

/** Un instante que está a la vez en el video (destello) y en LSL (fila `sync_k` del CSV). */
export interface SyncPoint {
  etiqueta: string;
  videoS: number;
  lslS: number;
  /** `auto`: detectado en el video; `manual`: marcado o escrito por el investigador. */
  origen: 'auto' | 'manual';
}

export interface Sync {
  /** Segundo del (primer) destello en el video (S_video). */
  videoS: number;
  /** Tiempo LSL del (primer) punto; null si el CSV no tiene filas sync. */
  lslS: number | null;
  /**
   * Todos los puntos de sincronización (§16). Ausente en sesiones guardadas antes de la v2:
   * entonces vale el caso de un punto (videoS, lslS).
   */
  puntos?: SyncPoint[];
}

export type SyncModel = 'tramos' | 'un_punto' | 'sin_sync';

/** Diferencia de intervalo a partir de la cual el emparejamiento se considera errado (§16.3). */
export const MAX_DIF_INTERVALO_S = 0.5;

const byLsl = (a: SyncPoint, b: SyncPoint) => a.lslS - b.lslS;

/** Puntos de la sesión: los explícitos o, en sesiones antiguas, el único (videoS, lslS). */
export function pointsOf(s: Sync): SyncPoint[] {
  if (s.puntos && s.puntos.length > 0) return [...s.puntos].sort(byLsl);
  return s.lslS === null ? [] : [{ etiqueta: 'sync', videoS: s.videoS, lslS: s.lslS, origen: 'manual' }];
}

/** Puntos usables por tramos: al menos 2, finitos y con el video y LSL creciendo a la vez. */
function tramos(s: Sync): SyncPoint[] | null {
  const p = pointsOf(s);
  if (p.length < 2) return null;
  for (let k = 0; k < p.length; k++) {
    if (!Number.isFinite(p[k]!.videoS) || !Number.isFinite(p[k]!.lslS)) return null;
    if (k > 0 && !(p[k]!.videoS > p[k - 1]!.videoS && p[k]!.lslS > p[k - 1]!.lslS)) return null;
  }
  return p;
}

/**
 * Modelo que se usará. Si los puntos no sirven para tramos (orden incoherente), se cae al
 * primer punto: la pantalla de configuración impide llegar aquí, pero una sesión guardada
 * siempre debe poder exportarse.
 */
export function syncModel(s: Sync): SyncModel {
  if (tramos(s)) return 'tramos';
  return s.lslS === null ? 'sin_sync' : 'un_punto';
}

/** Interpolación lineal por tramos; fuera del rango se extiende el primer o el último tramo. */
function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  let k = 0;
  while (k < xs.length - 2 && x >= xs[k + 1]!) k++;
  return ys[k]! + ((x - xs[k]!) * (ys[k + 1]! - ys[k]!)) / (xs[k + 1]! - xs[k]!);
}

/** Tiempo LSL de un instante del video; null sin filas sync. */
export function videoToLsl(tVideo: number, s: Sync): number | null {
  const p = tramos(s);
  if (p) return interp(tVideo, p.map((x) => x.videoS), p.map((x) => x.lslS));
  return s.lslS === null ? null : s.lslS + (tVideo - s.videoS);
}

/** Tiempo en el video de un evento del CSV. Sin filas sync: S_video + t_evento (§8.2). */
export function lslToVideo(tEvento: number, s: Sync): number {
  const p = tramos(s);
  if (p) return interp(tEvento, p.map((x) => x.lslS), p.map((x) => x.videoS));
  return s.videoS + (tEvento - (s.lslS ?? 0));
}

export interface SyncQuality {
  /** El video y LSL crecen a la vez en todos los puntos. */
  ordenValido: boolean;
  /** (L_{k+1} − L_k) / (V_{k+1} − V_k) de cada tramo. */
  ritmoPorTramo: number[];
  /** (V_{k+1} − V_k) − (L_{k+1} − L_k) de cada tramo, en segundos. */
  difIntervalos: number[];
  difIntervaloMaxS: number | null;
  /** Residuo máximo de la recta global t_lsl = a + b·t_video, en ms (solo indicador). */
  residuoRectaMaxMs: number | null;
  /** Se puede comenzar: orden válido y ninguna diferencia de intervalo mayor que el máximo. */
  ok: boolean;
}

/** Controles de calidad de §16.3. Con menos de 2 puntos no hay nada que controlar. */
export function syncQuality(points: readonly SyncPoint[]): SyncQuality {
  const p = [...points].sort(byLsl);
  if (p.length < 2) {
    return { ordenValido: true, ritmoPorTramo: [], difIntervalos: [], difIntervaloMaxS: null, residuoRectaMaxMs: null, ok: true };
  }
  let ordenValido = true;
  const ritmo: number[] = [];
  const dif: number[] = [];
  for (let k = 0; k + 1 < p.length; k++) {
    const dv = p[k + 1]!.videoS - p[k]!.videoS;
    const dl = p[k + 1]!.lslS - p[k]!.lslS;
    if (!(dv > 0)) ordenValido = false;
    ritmo.push(dv > 0 ? dl / dv : NaN);
    dif.push(dv - dl);
  }
  const difMax = Math.max(...dif.map(Math.abs));

  // Mínimos cuadrados de L sobre V.
  const n = p.length;
  const mv = p.reduce((a, x) => a + x.videoS, 0) / n;
  const ml = p.reduce((a, x) => a + x.lslS, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const x of p) {
    sxy += (x.videoS - mv) * (x.lslS - ml);
    sxx += (x.videoS - mv) ** 2;
  }
  let residuo: number | null = null;
  if (sxx > 0) {
    const b = sxy / sxx;
    const a = ml - b * mv;
    residuo = Math.max(...p.map((x) => Math.abs(x.lslS - (a + b * x.videoS)))) * 1000;
  }

  return {
    ordenValido,
    ritmoPorTramo: ritmo,
    difIntervalos: dif,
    difIntervaloMaxS: difMax,
    residuoRectaMaxMs: residuo,
    ok: ordenValido && difMax <= MAX_DIF_INTERVALO_S,
  };
}

/** Sync a partir de una lista de puntos (el primero, por tiempo LSL, da videoS y lslS). */
export function syncFromPoints(points: readonly SyncPoint[], fallbackVideoS = 0): Sync {
  const p = [...points].sort(byLsl);
  if (p.length === 0) return { videoS: fallbackVideoS, lslS: null };
  return { videoS: p[0]!.videoS, lslS: p[0]!.lslS, puntos: p };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Bloque `sincronizacion` del JSON (SPEC §16.6). */
export function syncJson(s: Sync) {
  const modelo = syncModel(s);
  const puntos = pointsOf(s);
  const q = syncQuality(modelo === 'tramos' ? puntos : []);
  return {
    video_s: s.videoS,
    lsl_s: s.lslS,
    modelo,
    puntos: puntos.map((x) => ({ etiqueta: x.etiqueta, video_s: round(x.videoS, 3), lsl_s: round(x.lslS, 3), origen: x.origen })),
    ritmo_por_tramo: q.ritmoPorTramo.map((r) => round(r, 6)),
    dif_intervalo_max_s: q.difIntervaloMaxS === null ? null : round(q.difIntervaloMaxS, 3),
    residuo_recta_max_ms: q.residuoRectaMaxMs === null ? null : round(q.residuoRectaMaxMs, 1),
  };
}
