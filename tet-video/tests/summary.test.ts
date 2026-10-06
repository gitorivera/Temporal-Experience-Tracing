import { describe, expect, it } from 'vitest';
import { interpretCorrelation, practiceSummary, summaryRows } from '../src/summary';
import { speedAt } from '../src/practice';
import type { DimensionRecord, SessionData } from '../src/state';

function rec(nombre: string, valores: number[], extra: Partial<DimensionRecord> = {}): DimensionRecord {
  return {
    dimension: { nombre, pregunta: '?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' },
    modo: 'trazo',
    duracionS: (valores.length - 1) / 10,
    valores,
    trazoCrudo: [],
    toques: 3,
    pasadas: 2,
    saltosVideo: 1,
    tiempoRespuestaS: 75.4,
    ...extra,
  };
}

function session(practica: DimensionRecord | null, dimensiones: DimensionRecord[]): SessionData {
  return {
    participante: 'P01',
    condicion: 'RM',
    inicio: '2026-10-05T15:04:46.123-05:00',
    grabacion: null,
    sincronizacion: { videoS: 0, lslS: null },
    eventos: [],
    modo: 'trazo',
    velocidad: 1,
    ordenAleatorio: true,
    resolucionS: 1,
    practica,
    dimensiones,
  };
}

describe('tabla de la pantalla final (SPEC §11)', () => {
  it('una fila por dimensión, con la práctica primero', () => {
    const s = session(rec('Práctica', [0.5, 0.5]), [rec('Diversión', [0.1, NaN, 0.3, 0.4]), rec('Esfuerzo', [0.2, 0.2])]);
    expect(summaryRows(s)).toEqual([
      { orden: 0, nombre: 'Práctica', cobertura: '100 %', tiempo: '1:15', pasadas: 2, toques: 3, saltos: 1 },
      { orden: 1, nombre: 'Diversión', cobertura: '75 %', tiempo: '1:15', pasadas: 2, toques: 3, saltos: 1 },
      { orden: 2, nombre: 'Esfuerzo', cobertura: '100 %', tiempo: '1:15', pasadas: 2, toques: 3, saltos: 1 },
    ]);
  });

  it('sin práctica y sin tiempo de respuesta', () => {
    const rows = summaryRows(session(null, [rec('Diversión', [NaN, NaN], { tiempoRespuestaS: null })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orden: 1, cobertura: '0 %', tiempo: '—' });
  });
});

describe('interpretación de la correlación de la práctica', () => {
  it('distingue buena, parcial y dudosa', () => {
    expect(interpretCorrelation(0.82)).toMatch(/^r = 0,82: .*bien/);
    expect(interpretCorrelation(0.5)).toMatch(/bien/);
    expect(interpretCorrelation(0.35)).toMatch(/en parte/);
    expect(interpretCorrelation(0.1)).toMatch(/no haya entendido/);
    expect(interpretCorrelation(-0.6)).toMatch(/^r = -0,60/);
    expect(interpretCorrelation(null)).toMatch(/insuficiente/);
  });

  it('un trazo que copia la velocidad da una buena correlación', () => {
    const valores = Array.from({ length: 401 }, (_, i) => speedAt(i / 10));
    expect(practiceSummary(session(rec('Práctica', valores), []))).toMatch(/^r = 1,00/);
  });

  it('sin práctica no hay frase', () => {
    expect(practiceSummary(session(null, []))).toBeNull();
  });
});
