// Resumen de la sesión para el investigador en la pantalla final (SPEC §11), sin DOM.
import { practiceCorrelation } from './practice';
import { formatTime } from './players/scenes';
import type { DimensionRecord, SessionData } from './state';
import { coverageOf } from './trace/trace';

export interface SummaryRow {
  orden: number;
  nombre: string;
  /** p. ej. «98 %». */
  cobertura: string;
  /** m:ss, o «—» si no se midió. */
  tiempo: string;
  pasadas: number;
  toques: number;
  saltos: number;
  /** Velocidad de reproducción de la pasada que quedó, p. ej. «1,5×». */
  velocidad: string;
}

/** «1×», «1,5×». */
export function velocidadTexto(v: number): string {
  return `${String(v).replace('.', ',')}×`;
}

function row(rec: DimensionRecord, orden: number, velocidadSesion: number): SummaryRow {
  return {
    orden,
    nombre: rec.dimension.nombre,
    cobertura: `${Math.round(coverageOf(rec.valores) * 100)} %`,
    tiempo: rec.tiempoRespuestaS === null ? '—' : formatTime(rec.tiempoRespuestaS),
    pasadas: rec.pasadas,
    toques: rec.toques,
    saltos: rec.saltosVideo,
    velocidad: velocidadTexto(rec.velocidad ?? velocidadSesion),
  };
}

/** Filas de la tabla: la práctica (orden 0) primero, si la hubo. */
export function summaryRows(s: SessionData): SummaryRow[] {
  const rows = s.dimensiones.map((rec, i) => row(rec, i + 1, s.velocidad));
  return s.practica ? [row(s.practica, 0, s.velocidad), ...rows] : rows;
}

export type CorrelationLevel = 'buena' | 'parcial' | 'dudosa' | 'insuficiente';

/** Umbrales orientativos: r ≥ 0,5 buena, 0,2 ≤ r < 0,5 parcial, r < 0,2 dudosa. */
export function correlationLevel(r: number | null): CorrelationLevel {
  if (r === null) return 'insuficiente';
  return r >= 0.5 ? 'buena' : r >= 0.2 ? 'parcial' : 'dudosa';
}

/** Frase para la correlación de la práctica (mismos umbrales que correlationLevel). */
export function interpretCorrelation(r: number | null): string {
  if (r === null) return 'Trazo insuficiente para calcular la correlación (menos de 10 puntos o una línea plana).';
  const v = `r = ${r.toFixed(2).replace('.', ',')}`;
  const nivel = correlationLevel(r);
  if (nivel === 'buena') return `${v}: el trazo sigue bien la velocidad de la pelota; el niño parece haber entendido la tarea.`;
  if (nivel === 'parcial') return `${v}: el trazo sigue la velocidad solo en parte; conviene revisar si entendió la tarea.`;
  return `${v}: el trazo casi no sigue la velocidad; es posible que el niño no haya entendido la tarea.`;
}

export function practiceSummary(s: SessionData): string | null {
  return s.practica ? interpretCorrelation(practiceCorrelation(s.practica.valores)) : null;
}
