// Práctica: perfil de velocidad conocido de la pelota y correlación con el trazo (SPEC §10).
import { HZ } from './trace/trace';

export const PRACTICE_DURATION = 40;

export const PRACTICE_DIMENSION = {
  nombre: 'Práctica',
  pregunta: '¿Qué tan rápido iba la pelota?',
  etiquetaInferior: 'Lento',
  etiquetaSuperior: 'Rapidísimo',
} as const;

/** Puntos (t, velocidad) del perfil, interpolados con coseno. */
export const SPEED_KEYS: readonly (readonly [number, number])[] = [
  [0, 0.2], [7, 0.2], [12, 0.9], [19, 0.9], [24, 0.45], [30, 0.1], [35, 0.1], [40, 0.7],
];

/** Velocidad real de la pelota en el segundo t (0 a 1). */
export function speedAt(t: number): number {
  const first = SPEED_KEYS[0]!;
  const last = SPEED_KEYS[SPEED_KEYS.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < SPEED_KEYS.length; i++) {
    const [t1, v1] = SPEED_KEYS[i]!;
    if (t <= t1) {
      const [t0, v0] = SPEED_KEYS[i - 1]!;
      const s = (1 - Math.cos((Math.PI * (t - t0)) / (t1 - t0))) / 2;
      return v0 + (v1 - v0) * s;
    }
  }
  return last[1];
}

const DT = 0.05;
/** Recorrido sobre la pista por unidad de velocidad y segundo. */
const TRAVEL = 0.9;

// Distancia acumulada en cada múltiplo de DT, para que la posición sea determinista al saltar.
const CUMULATIVE: number[] = (() => {
  const steps = Math.ceil(PRACTICE_DURATION / DT);
  const out = [0];
  for (let k = 0; k < steps; k++) out.push(out[k]! + speedAt(k * DT) * DT);
  return out;
})();

/** Distancia recorrida hasta t: integración con paso de 0,05 s más el tramo parcial. */
export function distanceAt(t: number): number {
  const tt = Math.min(Math.max(t, 0), PRACTICE_DURATION);
  const k = Math.min(Math.floor(tt / DT + 1e-9), CUMULATIVE.length - 1);
  return CUMULATIVE[k]! + speedAt(k * DT) * (tt - k * DT);
}

/** Posición de la pelota en la pista (0 = izquierda, 1 = derecha); va y viene. */
export function ballPosition(t: number): number {
  const p = (distanceAt(t) * TRAVEL) % 2;
  return p <= 1 ? p : 2 - p;
}

/** Correlación de Pearson; null si hay menos de 2 puntos o alguna serie no varía. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Correlación entre el trazo (índices no NaN) y la velocidad real; null con menos de 10 puntos. */
export function practiceCorrelation(values: ArrayLike<number>): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isNaN(v)) {
      xs.push(v);
      ys.push(speedAt(i / HZ));
    }
  }
  return xs.length < 10 ? null : pearson(xs, ys);
}
