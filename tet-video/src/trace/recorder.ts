// Registro de una dimensión en la pantalla de trazado (SPEC §7.6–§7.8), sin DOM:
// pasadas, valor actual, trazo crudo, toques y saltos en el video.
import type { Dimension, DimensionRecord, ModoRespuesta, RawPoint } from '../state';
import { Trace } from './trace';

export const VALOR_INICIAL = 0.5;
/** Por debajo de esta cobertura, «Listo» pide confirmación (SPEC §7.8). */
export const COBERTURA_MINIMA = 0.9;

/** `espera`: antes de grabar o tras una interrupción; `grabando`; `terminada`: la pasada llegó al final. */
export type PassState = 'espera' | 'grabando' | 'terminada';

/** Resultado de pulsar «Listo»: sin línea, línea con huecos o línea suficiente. */
export type ReadyCheck = 'vacia' | 'incompleta' | 'completa';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class DimensionRecorder {
  readonly trace: Trace;
  state: PassState = 'espera';
  /** Valor que el niño marca ahora (0 = etiqueta inferior, 1 = superior). */
  value = VALOR_INICIAL;
  /** Cambios de valor de la pasada en curso (o de la última terminada). */
  raw: RawPoint[] = [];
  /** Veces que el niño puso el dedo durante la pasada en curso (o la última terminada). */
  toques = 0;
  /** Pasadas empezadas, incluidas las interrumpidas. */
  pasadas = 0;
  /** Gestos en la línea de tiempo fuera de la grabación. */
  saltos = 0;
  /** La última pasada se interrumpió (la app pasó a segundo plano) y hay que repetirla. */
  interrumpida = false;

  constructor(duration: number) {
    this.trace = new Trace(duration);
  }

  get duration(): number {
    return this.trace.duration;
  }

  /** Empieza una pasada desde 0 con el valor inicial (SPEC §7.6, pasos 1 y 2). */
  begin(ms: number): void {
    this.pasadas++;
    this.state = 'grabando';
    this.interrumpida = false;
    this.value = VALOR_INICIAL;
    this.toques = 0;
    this.raw = [];
    this.trace.beginPass(0, this.value);
    this.pushRaw(0, ms);
  }

  /** El niño marca un valor; solo cuenta durante la grabación. */
  setValue(v: number): void {
    if (this.state === 'grabando' && Number.isFinite(v)) this.value = clamp01(v);
  }

  /** El niño pone el dedo en la gráfica o el deslizador. */
  touch(): void {
    if (this.state === 'grabando') this.toques++;
  }

  /** Muestra en el tiempo del video `t` (SPEC §7.6, paso 4). */
  sample(t: number, ms: number): void {
    if (this.state !== 'grabando' || !Number.isFinite(t)) return;
    this.trace.sample(t, this.value);
    const last = this.raw[this.raw.length - 1];
    if (!last || last.v !== this.value) this.pushRaw(t, ms);
  }

  /** Fin del video: última muestra en la duración y fin de la pasada (SPEC §7.6, paso 5). */
  finish(ms: number): void {
    if (this.state !== 'grabando') return;
    this.sample(this.duration, ms);
    this.state = 'terminada';
  }

  /** La pasada no vale (segundo plano, error al reproducir): se borra y hay que repetirla. */
  interrupt(): void {
    if (this.state !== 'grabando') return;
    this.trace.clear();
    this.raw = [];
    this.toques = 0;
    this.value = VALOR_INICIAL;
    this.state = 'espera';
    this.interrumpida = true;
  }

  /** Un gesto en la línea de tiempo. Devuelve false si está bloqueada (durante la grabación). */
  seek(): boolean {
    if (this.state === 'grabando') return false;
    this.saltos++;
    return true;
  }

  check(): ReadyCheck {
    const c = this.trace.coverage();
    if (c === 0) return 'vacia';
    return c < COBERTURA_MINIMA ? 'incompleta' : 'completa';
  }

  toRecord(dimension: Dimension, modo: ModoRespuesta, tiempoRespuestaS: number | null): DimensionRecord {
    return {
      dimension: { ...dimension },
      modo,
      duracionS: this.duration,
      valores: Array.from(this.trace.values),
      trazoCrudo: this.raw.map((p) => ({ ...p })),
      toques: this.toques,
      pasadas: this.pasadas,
      saltosVideo: this.saltos,
      tiempoRespuestaS,
    };
  }

  private pushRaw(t: number, ms: number): void {
    this.raw.push({ pasada: this.pasadas, t, v: this.value, ms });
  }
}
