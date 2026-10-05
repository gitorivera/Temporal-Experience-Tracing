// Buffer de 10 Hz de una dimensión (SPEC §7.6, §7.7).

export const HZ = 10;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Número de muestras para una duración: ceil(duración · HZ) + 1. */
export function bufferLength(duration: number): number {
  // El épsilon evita que errores de coma flotante (12,3 · 10 = 123,00000000000001) sumen una muestra.
  return Math.max(1, Math.ceil(duration * HZ - 1e-9) + 1);
}

export class Trace {
  readonly duration: number;
  readonly n: number;
  readonly values: Float64Array;

  // Último punto muestreado de la pasada en curso (SPEC §7.6, paso 4).
  private lastT = 0;
  private lastV = 0.5;

  constructor(duration: number) {
    if (!(duration > 0) || !Number.isFinite(duration)) {
      throw new RangeError(`Duración inválida: ${duration}`);
    }
    this.duration = duration;
    this.n = bufferLength(duration);
    this.values = new Float64Array(this.n).fill(NaN);
  }

  /** Rellena con interpolación lineal entre (t0, v0) y (t1, v1); acepta los puntos en cualquier orden. */
  setRange(t0: number, v0: number, t1: number, v1: number): void {
    if (![t0, v0, t1, v1].every(Number.isFinite)) return;
    let i0 = Math.round(t0 * HZ);
    let i1 = Math.round(t1 * HZ);
    if (i0 > i1) {
      [i0, i1] = [i1, i0];
      [v0, v1] = [v1, v0];
    }
    const from = Math.max(i0, 0);
    const to = Math.min(i1, this.n - 1);
    for (let i = from; i <= to; i++) {
      const f = i1 === i0 ? 1 : (i - i0) / (i1 - i0);
      this.values[i] = clamp01(v0 + (v1 - v0) * f);
    }
  }

  /** Fracción de muestras con dato. */
  coverage(): number {
    return coverageOf(this.values);
  }

  clear(): void {
    this.values.fill(NaN);
  }

  /** Empieza una pasada: borra el buffer y fija el punto de partida. */
  beginPass(t: number, v: number): void {
    this.clear();
    this.lastT = t;
    this.lastV = v;
    this.setRange(t, v, t, v);
  }

  /** Muestra en el tiempo del video `t`: rellena desde el último punto muestreado hasta (t, v). */
  sample(t: number, v: number): void {
    this.setRange(this.lastT, this.lastV, t, v);
    this.lastT = t;
    this.lastV = v;
  }

  /** Valores para exportar: NaN → null, 4 decimales. */
  toJSONValues(): (number | null)[] {
    return Array.from(this.values, (v) => (Number.isNaN(v) ? null : round(v, 4)));
  }
}

/** Fracción de valores no NaN. */
export function coverageOf(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let c = 0;
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) c++;
  return c / values.length;
}

export interface WindowMean {
  /** Inicio de la ventana en segundos de video. */
  t: number;
  /** Promedio de los valores no NaN de la ventana; null si no hay ninguno. */
  v: number | null;
}

/**
 * Promedios por ventanas de `step` segundos, semiabiertas [t, t + step).
 * Acepta un buffer cualquiera a HZ para poder remuestrear sesiones guardadas.
 */
export function resample(values: ArrayLike<number>, duration: number, step: number): WindowMean[] {
  if (!(step > 0)) throw new RangeError(`Resolución inválida: ${step}`);
  const out: WindowMean[] = [];
  const last = values.length - 1;
  // El inicio de cada ventana se calcula como k · step (sin acumular) para evitar deriva.
  for (let k = 0; k * step < duration - 1e-9; k++) {
    const i0 = Math.round(k * step * HZ);
    const i1 = Math.min(last, Math.round((k + 1) * step * HZ) - 1);
    let sum = 0;
    let c = 0;
    for (let i = i0; i <= i1; i++) {
      const v = values[i]!;
      if (!Number.isNaN(v)) {
        sum += v;
        c++;
      }
    }
    out.push({ t: round(k * step, 6), v: c ? sum / c : null });
  }
  return out;
}

export function round(x: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(x * p) / p;
}
