import { describe, expect, it } from 'vitest';
import {
  build10HzCsv,
  buildAllFiles,
  buildJson,
  buildToquesCsv,
  buildVentanasCsv,
  csvField,
  fileBase,
  isoLocal,
  sanitizeId,
} from '../src/data/export';
import { parseEvents, toVideoEvents } from '../src/data/events';
import { PRACTICE_DIMENSION, PRACTICE_DURATION, speedAt } from '../src/practice';
import { configPorDefecto, type DimensionRecord, type SessionData } from '../src/state';
import { Trace } from '../src/trace/trace';

const DIMS = configPorDefecto().dimensiones;

/** Simula una pasada continua: cuadros de ~16 ms con tirones, valor que sube y baja. */
function record(duration: number, fn: (t: number) => number = (t) => 0.5 + 0.4 * Math.sin(t / 7)): Trace {
  const tr = new Trace(duration);
  tr.beginPass(0, 0.5);
  let t = 0;
  let seed = 7;
  while (t < duration) {
    seed = (seed * 16807) % 2147483647;
    t = Math.min(duration, t + (seed % 10 === 0 ? 0.25 : 0.0167));
    tr.sample(t, fn(t));
  }
  return tr;
}

function rec(trace: Trace, i: number, extra: Partial<DimensionRecord> = {}): DimensionRecord {
  return {
    dimension: DIMS[i]!,
    modo: 'trazo',
    duracionS: trace.duration,
    valores: Array.from(trace.values),
    trazoCrudo: [
      { pasada: 1, t: 0, v: 0.5, ms: 10234 },
      { pasada: 1, t: 12.4, v: 0.75, ms: 22634.4 },
    ],
    toques: 3,
    pasadas: 1,
    saltosVideo: 2,
    tiempoRespuestaS: 131.234,
    ...extra,
  };
}

function session(over: Partial<SessionData> = {}): SessionData {
  return {
    participante: 'P01',
    condicion: 'RM',
    inicio: '2026-10-05T15:04:46.123-05:00',
    grabacion: 'partida.mp4',
    sincronizacion: { videoS: 12.4, lslS: 1532.4 },
    eventos: [{ t: 15.1, label: 'inicio nivel 1', icon: '🚩' }],
    modo: 'trazo',
    velocidad: 1,
    ordenAleatorio: true,
    resolucionS: 1,
    practica: null,
    dimensiones: [],
    ...over,
  };
}

/** Filas de datos de un CSV (sin BOM, sin encabezado, sin línea final vacía). */
function rows(csv: string): string[][] {
  expect(csv.startsWith('\uFEFF')).toBe(true);
  return csv
    .slice(1)
    .split('\r\n')
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split(','));
}

const header = (csv: string) => csv.slice(1).split('\r\n')[0];

describe('nombre de archivo (SPEC §8.3)', () => {
  it('TET_{participante}_{condicion}_{AAAA-MM-DD-HH-MM}', () => {
    expect(fileBase(session())).toBe('TET_P01_RM_2026-10-05-15-04');
  });

  it('quita tildes y reemplaza lo no alfanumérico por «_»', () => {
    expect(sanitizeId('Pé-01 ñ/x')).toBe('Pe_01_n_x');
    expect(fileBase(session({ participante: 'Niño 3', condicion: 'Tablet' }))).toBe(
      'TET_Nino_3_Tablet_2026-10-05-15-04',
    );
  });

  it('isoLocal es ISO-8601 con desfase y representa el mismo instante', () => {
    const d = new Date(2026, 9, 5, 8, 7, 6, 5);
    const iso = isoLocal(d);
    expect(iso).toMatch(/^2026-10-05T08:07:06\.005[+-]\d\d:\d\d$/);
    expect(Date.parse(iso)).toBe(d.getTime());
  });
});

describe('csvField', () => {
  it('pone comillas solo cuando hace falta', () => {
    expect(csvField('Diversión')).toBe('Diversión');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvField(3)).toBe('3');
  });
});

describe('CSV a 10 Hz', () => {
  it('criterio de aceptación: video de 2 min → 1201 filas por dimensión y cobertura 1,0', () => {
    const traces = [0, 1, 2, 3].map(() => record(120));
    for (const tr of traces) expect(tr.coverage()).toBe(1);
    const s = session({ dimensiones: traces.map((tr, i) => rec(tr, i)) });
    const r = rows(build10HzCsv(s));
    expect(r).toHaveLength(4 * 1201);
    for (let k = 1; k <= 4; k++) {
      const dim = r.filter((x) => x[4] === String(k));
      expect(dim).toHaveLength(1201);
      expect(dim.every((x) => x[7] !== '')).toBe(true);
    }
    const json = JSON.parse(buildJson(s));
    expect(json.dimensiones.map((d: { cobertura: number }) => d.cobertura)).toEqual([1, 1, 1, 1]);
  });

  it('tiene el encabezado exacto del SPEC', () => {
    expect(header(build10HzCsv(session()))).toBe(
      'participante,condicion,modo,dimension,orden,tiempo_video_s,tiempo_lsl_s,valor',
    );
  });

  it('criterio de aceptación: el tiempo LSL coincide en el punto de sincronización (error < 0,05 s)', () => {
    const s = session({ dimensiones: [rec(record(120), 0)] });
    const atSync = rows(build10HzCsv(s)).find((x) => x[5] === '12.400')!;
    expect(Math.abs(Number(atSync[6]) - 1532.4)).toBeLessThan(0.05);
  });

  it('el tiempo LSL de un evento ubicado en el video vuelve a su tiempo original', () => {
    const parsed = parseEvents('tiempo,evento\n1532.40,sync\n1561.80,acierto\n');
    if (!parsed.ok) throw new Error(parsed.error);
    const sync = { videoS: 12.4, lslS: parsed.sync!.t };
    const ev = toVideoEvents(parsed.events, sync, 120)[0]!; // t_video = 41,8
    const s = session({ sincronizacion: sync, dimensiones: [rec(record(120), 0)] });
    const row = rows(build10HzCsv(s)).find((x) => x[5] === ev.t.toFixed(1) + '00')!;
    expect(Math.abs(Number(row[6]) - 1561.8)).toBeLessThan(0.05);
  });

  it('deja tiempo_lsl_s vacío sin fila sync', () => {
    const s = session({ sincronizacion: { videoS: 0, lslS: null }, dimensiones: [rec(record(5), 0)] });
    expect(rows(build10HzCsv(s)).every((x) => x[6] === '')).toBe(true);
  });

  it('incluye la práctica con orden 0 y sin tiempo LSL', () => {
    const p = record(PRACTICE_DURATION, speedAt);
    const s = session({
      practica: { ...rec(p, 0), dimension: { ...PRACTICE_DIMENSION } },
      dimensiones: [rec(record(10), 0)],
    });
    const r = rows(build10HzCsv(s));
    const prac = r.filter((x) => x[4] === '0');
    expect(prac).toHaveLength(401);
    expect(prac[0]![3]).toBe('Práctica');
    expect(prac.every((x) => x[6] === '')).toBe(true);
    expect(r.filter((x) => x[4] === '1')).toHaveLength(101);
  });

  it('deja vacío el valor donde no hay dato y usa punto decimal', () => {
    const tr = new Trace(1);
    tr.setRange(0, 0.123456, 0, 0.123456);
    const r = rows(build10HzCsv(session({ dimensiones: [rec(tr, 0)] })));
    expect(r[0]!.slice(5)).toEqual(['0.000', '1520.000', '0.1235']);
    expect(r[1]![7]).toBe('');
  });

  it('escapa participantes con comas o comillas', () => {
    const s = session({ participante: 'P,"1"', dimensiones: [rec(record(1), 0)] });
    const line = build10HzCsv(s).slice(1).split('\r\n')[1]!;
    expect(line.startsWith('"P,""1""",RM,trazo,Diversión,1,')).toBe(true);
  });
});

describe('CSV de ventanas', () => {
  it('promedia por la resolución configurada y excluye la práctica', () => {
    const s = session({
      practica: rec(record(PRACTICE_DURATION, speedAt), 0),
      dimensiones: [rec(record(120), 0), rec(record(120), 1)],
    });
    const r = rows(buildVentanasCsv(s));
    expect(r).toHaveLength(240);
    expect(r.some((x) => x[4] === '0')).toBe(false);
    expect(r[0]!.slice(0, 7)).toEqual(['P01', 'RM', 'trazo', 'Diversión', '1', '0.000', '1520.000']);
    expect(r[120]![3]).toBe('Esfuerzo');
  });

  it('respeta resoluciones distintas de 1 s', () => {
    const r = rows(buildVentanasCsv(session({ resolucionS: 2.5, dimensiones: [rec(record(10), 0)] })));
    expect(r.map((x) => x[5])).toEqual(['0.000', '2.500', '5.000', '7.500']);
  });

  it('valor vacío en ventanas sin datos', () => {
    const tr = new Trace(3);
    tr.setRange(0, 0.2, 0.9, 0.2);
    const r = rows(buildVentanasCsv(session({ dimensiones: [rec(tr, 0)] })));
    expect(r.map((x) => x[7])).toEqual(['0.2000', '', '']);
  });
});

describe('CSV de toques', () => {
  it('tiene el encabezado del SPEC y una fila por cambio de valor', () => {
    const s = session({ dimensiones: [rec(record(20), 0)] });
    const csv = buildToquesCsv(s);
    expect(header(csv)).toBe(
      'participante,condicion,modo,dimension,orden,pasada,tiempo_video_s,tiempo_lsl_s,valor,ms_desde_inicio_sesion',
    );
    expect(rows(csv)).toEqual([
      ['P01', 'RM', 'trazo', 'Diversión', '1', '1', '0.000', '1520.000', '0.5000', '10234'],
      ['P01', 'RM', 'trazo', 'Diversión', '1', '1', '12.400', '1532.400', '0.7500', '22634'],
    ]);
  });
});

describe('JSON', () => {
  it('sigue el esquema del SPEC', () => {
    const p = record(PRACTICE_DURATION, speedAt);
    const s = session({
      practica: { ...rec(p, 0), dimension: { ...PRACTICE_DIMENSION } },
      dimensiones: [rec(record(120), 0, { modo: 'deslizador' })],
    });
    const text = buildJson(s);
    expect(text.startsWith('{')).toBe(true); // sin BOM
    const j = JSON.parse(text);
    expect(Object.keys(j)).toEqual([
      'version_app', 'participante', 'condicion', 'inicio', 'grabacion', 'sincronizacion',
      'eventos', 'configuracion', 'practica', 'dimensiones',
    ]);
    expect(j.version_app).toBe('1.0.0');
    expect(j.sincronizacion).toEqual({ video_s: 12.4, lsl_s: 1532.4 });
    expect(j.eventos).toEqual([{ t: 15.1, label: 'inicio nivel 1', icon: '🚩' }]);
    expect(j.configuracion).toEqual({ modo: 'trazo', velocidad_reproduccion: 1, valor_inicial: 0.5, orden_aleatorio: true });

    const d = j.dimensiones[0];
    expect(Object.keys(d)).toEqual([
      'orden', 'dimension', 'pregunta', 'modo', 'duracion_s', 'hz', 'valores_10hz', 'trazo_crudo',
      'cobertura', 'toques', 'pasadas', 'saltos_video', 'tiempo_respuesta_s',
    ]);
    expect(d).toMatchObject({ orden: 1, dimension: 'Diversión', modo: 'deslizador', duracion_s: 120, hz: 10, cobertura: 1 });
    expect(d.valores_10hz).toHaveLength(1201);
    expect(d.trazo_crudo[1]).toEqual({ pasada: 1, t: 12.4, v: 0.75, ms: 22634 });
    expect(d.tiempo_respuesta_s).toBe(131.23);

    expect(j.practica.orden).toBe(0);
    expect(j.practica.dimension).toBe('Práctica');
    expect(j.practica.correlacion_con_velocidad).toBeGreaterThan(0.99);
  });

  it('valores sin dato como null; práctica null si no la hubo', () => {
    const tr = new Trace(0.2);
    tr.setRange(0, 0.5, 0, 0.5);
    const j = JSON.parse(buildJson(session({ grabacion: null, dimensiones: [rec(tr, 0)] })));
    expect(j.dimensiones[0].valores_10hz).toEqual([0.5, null, null]);
    expect(j.practica).toBeNull();
    expect(j.grabacion).toBeNull();
  });
});

describe('buildAllFiles', () => {
  it('genera los cuatro archivos con sus nombres', () => {
    const files = buildAllFiles(session({ dimensiones: [rec(record(3), 0)] }));
    expect(files.map((f) => f.name)).toEqual([
      'TET_P01_RM_2026-10-05-15-04_ventanas.csv',
      'TET_P01_RM_2026-10-05-15-04_10hz.csv',
      'TET_P01_RM_2026-10-05-15-04_toques.csv',
      'TET_P01_RM_2026-10-05-15-04.json',
    ]);
    // BOM solo en los CSV.
    expect(files.map((f) => f.content.startsWith('\uFEFF'))).toEqual([true, true, true, false]);
  });
});
