import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildZip, estadoTexto, sessionId, sortSessions, toStored, zipName } from '../src/data/storage';
import type { DimensionRecord, SessionData } from '../src/state';

function rec(nombre: string): DimensionRecord {
  return {
    dimension: { nombre, pregunta: '?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' },
    modo: 'trazo',
    duracionS: 2,
    valores: Array.from({ length: 21 }, () => 0.5),
    trazoCrudo: [{ pasada: 1, t: 0, v: 0.5, ms: 10 }],
    toques: 1,
    pasadas: 1,
    saltosVideo: 0,
    tiempoRespuestaS: 5,
  };
}

function session(participante: string, inicio: string, dims: number): SessionData {
  return {
    participante,
    condicion: 'Tablet',
    inicio,
    grabacion: 'partida.mp4',
    sincronizacion: { videoS: 1, lslS: 100 },
    eventos: [],
    modo: 'trazo',
    velocidad: 1,
    ordenAleatorio: false,
    resolucionS: 1,
    practica: null,
    dimensiones: Array.from({ length: dims }, (_, i) => rec(`D${i + 1}`)),
  };
}

describe('sesiones guardadas (SPEC §9)', () => {
  it('el id es inicio + participante', () => {
    expect(sessionId({ inicio: '2026-10-05T15:04:46.123-05:00', participante: 'P01' })).toBe('2026-10-05T15:04:46.123-05:00_P01');
  });

  it('una sesión con 2 de 4 dimensiones queda incompleta', () => {
    const st = toStored(session('P01', '2026-10-05T15:04:46.123-05:00', 2), 4, new Date(2026, 9, 5, 15, 10));
    expect(st.completa).toBe(false);
    expect(st.totalDimensiones).toBe(4);
    expect(st.guardadaEn.startsWith('2026-10-05T15:10:00.000')).toBe(true);
    expect(estadoTexto(st)).toBe('Incompleta (2 de 4 dimensiones)');
  });

  it('con todas las dimensiones queda completa', () => {
    const st = toStored(session('P01', '2026-10-05T15:04:46.123-05:00', 4), 4);
    expect(st.completa).toBe(true);
    expect(estadoTexto(st)).toBe('Completa');
    expect(estadoTexto(toStored(session('P01', '2026-10-05T15:04:46.123-05:00', 0), 1))).toBe('Incompleta (0 de 1 dimensión)');
  });

  it('ordena de la más reciente a la más antigua, aunque tengan otro desfase horario', () => {
    const a = toStored(session('A', '2026-10-05T10:00:00.000-05:00', 1), 1);
    const b = toStored(session('B', '2026-10-05T16:30:00.000+00:00', 1), 1); // 11:30 en Colombia
    const c = toStored(session('C', '2026-10-04T23:00:00.000-05:00', 1), 1);
    expect(sortSessions([c, a, b]).map((x) => x.sesion.participante)).toEqual(['B', 'A', 'C']);
  });
});

describe('ZIP de todas las sesiones', () => {
  it('una carpeta por sesión con sus 4 archivos', () => {
    const a = toStored(session('Niño 3', '2026-10-05T15:04:46.123-05:00', 2), 4);
    const b = toStored(session('P02', '2026-10-05T16:00:00.000-05:00', 1), 1);
    const files = unzipSync(buildZip([a, b]));
    // Sin las entradas de carpeta («nombre/»).
    const names = Object.keys(files)
      .filter((n) => !n.endsWith('/'))
      .sort();
    expect(names).toEqual([
      'TET_Nino_3_Tablet_2026-10-05-15-04/TET_Nino_3_Tablet_2026-10-05-15-04.json',
      'TET_Nino_3_Tablet_2026-10-05-15-04/TET_Nino_3_Tablet_2026-10-05-15-04_10hz.csv',
      'TET_Nino_3_Tablet_2026-10-05-15-04/TET_Nino_3_Tablet_2026-10-05-15-04_toques.csv',
      'TET_Nino_3_Tablet_2026-10-05-15-04/TET_Nino_3_Tablet_2026-10-05-15-04_ventanas.csv',
      'TET_P02_Tablet_2026-10-05-16-00/TET_P02_Tablet_2026-10-05-16-00.json',
      'TET_P02_Tablet_2026-10-05-16-00/TET_P02_Tablet_2026-10-05-16-00_10hz.csv',
      'TET_P02_Tablet_2026-10-05-16-00/TET_P02_Tablet_2026-10-05-16-00_toques.csv',
      'TET_P02_Tablet_2026-10-05-16-00/TET_P02_Tablet_2026-10-05-16-00_ventanas.csv',
    ]);
  });

  it('conserva el contenido exacto (BOM y tildes incluidos)', () => {
    const a = toStored(session('Niño 3', '2026-10-05T15:04:46.123-05:00', 2), 4);
    const files = unzipSync(buildZip([a]));
    const csv = files['TET_Nino_3_Tablet_2026-10-05-15-04/TET_Nino_3_Tablet_2026-10-05-15-04_10hz.csv']!;
    expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = strFromU8(csv);
    expect(text).toContain('Niño 3,Tablet,trazo,D2,2,');
    // Dos dimensiones de 21 muestras más el encabezado.
    expect(text.trim().split('\r\n')).toHaveLength(43);
    const json = JSON.parse(strFromU8(files['TET_Nino_3_Tablet_2026-10-05-15-04/TET_Nino_3_Tablet_2026-10-05-15-04.json']!));
    expect(json.dimensiones).toHaveLength(2);
  });

  it('dos sesiones con el mismo nombre base no se pisan', () => {
    const a = toStored(session('P01', '2026-10-05T15:04:10.000-05:00', 1), 1);
    const b = toStored(session('P01', '2026-10-05T15:04:50.000-05:00', 1), 1);
    const folders = new Set(
      Object.keys(unzipSync(buildZip([a, b])))
        .filter((n) => !n.endsWith('/'))
        .map((n) => n.split('/')[0]),
    );
    expect([...folders].sort()).toEqual(['TET_P01_Tablet_2026-10-05-15-04', 'TET_P01_Tablet_2026-10-05-15-04_2']);
  });

  it('nombre del ZIP con la hora local', () => {
    expect(zipName(new Date(2026, 9, 5, 9, 7))).toBe('TET_sesiones_2026-10-05-09-07.zip');
  });
});
