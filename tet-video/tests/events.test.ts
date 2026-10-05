import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  eventToVideo,
  iconFor,
  parseEvents,
  parseNumber,
  splitLine,
  toVideoEvents,
  videoToLsl,
  type ParseResult,
} from '../src/data/events';

function ok(r: ParseResult) {
  if (!r.ok) throw new Error(`Se esperaba éxito: ${r.error}`);
  return r;
}

const SPEC_EXAMPLE = `tiempo,evento,icono
1532.40,sync,⚡
1535.10,inicio nivel 1,🚩
1561.80,acierto,⭐
1590.25,error,❌
`;

describe('parseNumber', () => {
  it('acepta punto y coma decimal', () => {
    expect(parseNumber('1532.40')).toBe(1532.4);
    expect(parseNumber('1532,40')).toBe(1532.4);
    expect(parseNumber(' -3 ')).toBe(-3);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('1e3')).toBe(1000);
  });

  it('rechaza celdas que no son un número completo', () => {
    for (const s of ['', 'abc', '12abc', '1.2.3', '1,2,3', undefined]) expect(parseNumber(s)).toBeNull();
  });
});

describe('separadores', () => {
  it('detecta coma, punto y coma y tabulador', () => {
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('1532,40;sync')).toBe(';');
  });

  it('respeta comillas al separar', () => {
    expect(splitLine('1.5,"acierto, rápido","⭐"', ',')).toEqual(['1.5', 'acierto, rápido', '⭐']);
    expect(splitLine('1;"dice ""hola""";x', ';')).toEqual(['1', 'dice "hola"', 'x']);
  });
});

describe('parseEvents', () => {
  it('lee el ejemplo del SPEC y separa la fila de sincronización', () => {
    const r = ok(parseEvents(SPEC_EXAMPLE));
    expect(r.hasHeader).toBe(true);
    expect(r.delimiter).toBe(',');
    expect(r.sync).toEqual({ t: 1532.4, label: 'sync', icon: '⚡' });
    expect(r.events).toEqual([
      { t: 1535.1, label: 'inicio nivel 1', icon: '🚩' },
      { t: 1561.8, label: 'acierto', icon: '⭐' },
      { t: 1590.25, label: 'error', icon: '❌' },
    ]);
    expect(r.skipped).toBe(0);
  });

  it('lee punto y coma con coma decimal', () => {
    const r = ok(parseEvents('Tiempo;Evento\n1532,40;Sincronización\n1535,10;inicio nivel 1\n'));
    expect(r.delimiter).toBe(';');
    expect(r.sync?.t).toBe(1532.4);
    expect(r.events).toEqual([{ t: 1535.1, label: 'inicio nivel 1', icon: '' }]);
  });

  it('lee tabuladores', () => {
    const r = ok(parseEvents('time\tlabel\n10.5\tstart\n12\thit\n'));
    expect(r.delimiter).toBe('\t');
    expect(r.events.map((e) => e.t)).toEqual([10.5, 12]);
    expect(r.sync).toBeNull();
  });

  it('reconoce encabezados sin distinguir mayúsculas y en cualquier orden', () => {
    const r = ok(parseEvents('EMOJI,Marker,LSL_Time\n🎁,premio,20.5\n'));
    expect(r.events).toEqual([{ t: 20.5, label: 'premio', icon: '🎁' }]);
  });

  it('reconoce todos los nombres de columna de tiempo', () => {
    for (const name of ['tiempo', 'time', 't', 'timestamp', 'lsl', 'lsl_time', 'tiempo_lsl', 'segundos', 'seg', 's']) {
      const r = ok(parseEvents(`evento,${name}\nacierto,3.5\n`));
      expect(r.events[0]?.t).toBe(3.5);
    }
  });

  it('sin encabezado usa columna 1 = tiempo y columna 2 = etiqueta', () => {
    const r = ok(parseEvents('1532.40,sync\n1535.10,inicio nivel 1\n'));
    expect(r.hasHeader).toBe(false);
    expect(r.sync?.t).toBe(1532.4);
    expect(r.events).toEqual([{ t: 1535.1, label: 'inicio nivel 1', icon: '' }]);
  });

  it('sin encabezado y con una sola columna: etiquetas vacías', () => {
    const r = ok(parseEvents('1\n2\n3\n'));
    expect(r.events.map((e) => e.label)).toEqual(['', '', '']);
  });

  it('ignora BOM, líneas vacías y finales de línea de Windows', () => {
    const r = ok(parseEvents('﻿tiempo,evento\r\n\r\n1,acierto\r\n2,error\r\n'));
    expect(r.hasHeader).toBe(true);
    expect(r.events).toHaveLength(2);
  });

  it('descarta y cuenta las filas inválidas', () => {
    const r = ok(parseEvents('tiempo,evento\n1,acierto\nabc,error\n,vacío\n3,fin\n'));
    expect(r.events.map((e) => e.t)).toEqual([1, 3]);
    expect(r.skipped).toBe(2);
  });

  it('ordena por tiempo', () => {
    const r = ok(parseEvents('5,b\n1,a\n3,c\n'));
    expect(r.events.map((e) => e.label)).toEqual(['a', 'c', 'b']);
  });

  it('usa la primera fila sync como referencia y no muestra ninguna fila sync', () => {
    const r = ok(parseEvents('100,sync inicio\n150,acierto\n200,SYNC fin\n'));
    expect(r.sync?.t).toBe(100);
    expect(r.events.map((e) => e.label)).toEqual(['acierto']);
  });

  it('error claro con archivo vacío', () => {
    expect(parseEvents('')).toEqual({ ok: false, error: expect.stringContaining('vacío') });
    expect(parseEvents('﻿\n  \n')).toMatchObject({ ok: false });
  });

  it('error claro si el encabezado no tiene columna de tiempo', () => {
    const r = parseEvents('evento,icono\nacierto,⭐\n');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('columna de tiempo') });
  });

  it('error claro si ninguna fila tiene tiempo numérico', () => {
    const r = parseEvents('hola,mundo\nfoo,bar\n');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('tiempo numérico') });
  });
});

describe('iconFor', () => {
  it('asigna ícono por la etiqueta', () => {
    expect(iconFor('acierto')).toBe('⭐');
    expect(iconFor('Error')).toBe('❌');
    expect(iconFor('inicio nivel 1')).toBe('🚩');
    expect(iconFor('Nivel 2')).toBe('🚩');
    expect(iconFor('fin')).toBe('🏁');
    expect(iconFor('fin nivel 1')).toBe('🏁');
    expect(iconFor('premio')).toBe('🎁');
    expect(iconFor('pausa')).toBe('◆');
    expect(iconFor('')).toBe('◆');
  });

  it('no confunde palabras que solo contienen las claves', () => {
    expect(iconFor('bloque')).toBe('◆'); // contiene «ok»
    expect(iconFor('infinito')).toBe('◆'); // contiene «fin»
  });
});

describe('sincronización (SPEC §8.2)', () => {
  const sync = { videoS: 12.4, lslS: 1532.4 };

  it('t_video = S_video + (t_evento − S_lsl)', () => {
    expect(eventToVideo(1561.8, sync)).toBeCloseTo(41.8, 9);
    expect(eventToVideo(1532.4, sync)).toBeCloseTo(12.4, 9);
  });

  it('t_lsl = S_lsl + (t_video − S_video)', () => {
    expect(videoToLsl(12.4, sync)).toBeCloseTo(1532.4, 9);
    expect(videoToLsl(0, sync)).toBeCloseTo(1520, 9);
  });

  it('ida y vuelta evento → video → LSL con error < 0,05 s, también con relojes LSL grandes', () => {
    const big = { videoS: 3.27, lslS: 734512.918273 };
    for (const t of [734512.918273, 734600.5, 735100.123456]) {
      expect(Math.abs(videoToLsl(eventToVideo(t, big), big)! - t)).toBeLessThan(0.05);
    }
  });

  it('sin fila sync: t_video = S_video + t_evento y sin tiempo LSL', () => {
    const noSync = { videoS: 2, lslS: null };
    expect(eventToVideo(10, noSync)).toBe(12);
    expect(videoToLsl(10, noSync)).toBeNull();
  });

  it('toVideoEvents ubica, asigna íconos y descarta lo que queda fuera de [0, duración]', () => {
    const r = ok(parseEvents(SPEC_EXAMPLE + '1500,antes del video\n1700,después del video\n1535.2,premio\n'));
    const ev = toVideoEvents(r.events, { videoS: 12.4, lslS: r.sync!.t }, 120);
    expect(ev.map((e) => e.label)).toEqual(['inicio nivel 1', 'premio', 'acierto', 'error']);
    expect(ev[0]!.t).toBeCloseTo(15.1, 9);
    expect(ev[1]!.icon).toBe('🎁');
    expect(ev[3]!.t).toBeCloseTo(70.25, 9);
  });

  it('incluye eventos exactamente en 0 y en la duración', () => {
    const ev = toVideoEvents(
      [
        { t: 0, label: 'a', icon: '' },
        { t: 10, label: 'b', icon: '' },
      ],
      { videoS: 0, lslS: null },
      10,
    );
    expect(ev).toHaveLength(2);
  });
});
