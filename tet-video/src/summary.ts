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
}

function row(rec: DimensionRecord, orden: number): SummaryRow {
  return {
    orden,
    nombre: rec.dimension.nombre,
    cobertura: `${Math.round(coverageOf(rec.valores) * 100)} %`,
    tiempo: rec.tiempoRespuestaS === null ? '—' : formatTime(rec.tiempoRespuestaS),
    pasadas: rec.pasadas,
    toques: rec.toques,
    saltos: rec.saltosVideo,
  };
}

/** Filas de la tabla: la práctica (orden 0) primero, si la hubo. */
export function summaryRows(s: SessionData): SummaryRow[] {
  const rows = s.dimensiones.map((rec, i) => row(rec, i + 1));
  return s.practica ? [row(s.practica, 0), ...rows] : rows;
}

/**
 * Frase para la correlación de la práctica. Los umbrales son orientativos:
 * r ≥ 0,5 buena, 0,2 ≤ r < 0,5 parcial, r < 0,2 dudosa.
 */
export function interpretCorrelation(r: number | null): string {
  if (r === null) return 'Trazo insuficiente para calcular la correlación (menos de 10 puntos o una línea plana).';
  const v = `r = ${r.toFixed(2).replace('.', ',')}`;
  if (r >= 0.5) return `${v}: el trazo sigue bien la velocidad de la pelota; el niño parece haber entendido la tarea.`;
  if (r >= 0.2) return `${v}: el trazo sigue la velocidad solo en parte; conviene revisar si entendió la tarea.`;
  return `${v}: el trazo casi no sigue la velocidad; es posible que el niño no haya entendido la tarea.`;
}

export function practiceSummary(s: SessionData): string | null {
  return s.practica ? interpretCorrelation(practiceCorrelation(s.practica.valores)) : null;
}
