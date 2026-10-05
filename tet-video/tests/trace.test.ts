import { describe, expect, it } from 'vitest';
import { bufferLength, coverageOf, HZ, resample, Trace } from '../src/trace/trace';

const defined = (t: Trace) => Array.from(t.values).map((v) => (Number.isNaN(v) ? null : +v.toFixed(6)));

describe('Trace: tamaño del buffer (SPEC §7.7)', () => {
  it('n = ceil(duración · HZ) + 1', () => {
    expect(HZ).toBe(10);
    expect(new Trace(120).n).toBe(1201);
    expect(new Trace(119.95).n).toBe(1201);
    expect(new Trace(0.05).n).toBe(2);
  });

  it('no suma una muestra por errores de coma flotante', () => {
    // 12,3 · 10 = 123,00000000000001 en coma flotante.
    expect(bufferLength(12.3)).toBe(124);
  });

  it('empieza con todos los valores en NaN', () => {
    const t = new Trace(2);
    expect(t.values.every(Number.isNaN)).toBe(true);
    expect(t.coverage()).toBe(0);
  });

  it('rechaza duraciones inválidas', () => {
    expect(() => new Trace(0)).toThrow();
    expect(() => new Trace(Infinity)).toThrow();
    expect(() => new Trace(NaN)).toThrow();
  });
});

describe('Trace.setRange', () => {
  it('interpola linealmente entre los dos puntos', () => {
    const t = new Trace(1);
    t.setRange(0, 0, 0.4, 0.8);
    expect(defined(t).slice(0, 6)).toEqual([0, 0.2, 0.4, 0.6, 0.8, null]);
  });

  it('da el mismo resultado con los puntos en orden inverso', () => {
    const a = new Trace(1);
    const b = new Trace(1);
    a.setRange(0.1, 0.2, 0.5, 0.6);
    b.setRange(0.5, 0.6, 0.1, 0.2);
    expect(defined(b)).toEqual(defined(a));
    expect(defined(a).slice(0, 7)).toEqual([null, 0.2, 0.3, 0.4, 0.5, 0.6, null]);
  });

  it('con t0 y t1 en el mismo índice escribe el valor final', () => {
    const t = new Trace(1);
    t.setRange(0.31, 0.2, 0.34, 0.7);
    expect(t.values[3]).toBeCloseTo(0.7);
    expect(t.coverage()).toBeCloseTo(1 / 11);
  });

  it('convierte tiempos a índices con redondeo', () => {
    const t = new Trace(1);
    t.setRange(0.149, 0.5, 0.149, 0.5); // round(1,49) = 1
    t.setRange(0.25, 0.5, 0.25, 0.5); // round(2,5) = 3
    expect(defined(t).slice(0, 5)).toEqual([null, 0.5, null, 0.5, null]);
  });

  it('escribe los bordes del buffer (primer y último índice)', () => {
    const t = new Trace(2);
    t.setRange(0, 0.3, 2, 0.3);
    expect(t.values[0]).toBeCloseTo(0.3);
    expect(t.values[t.n - 1]).toBeCloseTo(0.3);
    expect(t.coverage()).toBe(1);
  });

  it('ignora la parte fuera del buffer sin alterar la pendiente', () => {
    const t = new Trace(1); // índices 0..10
    t.setRange(-0.5, 0, 1.5, 1); // pendiente 0,05 por índice, de -5 a 15
    expect(t.values[0]).toBeCloseTo(0.25);
    expect(t.values[10]).toBeCloseTo(0.75);
    expect(t.coverage()).toBe(1);
  });

  it('no escribe nada si todo el tramo queda fuera', () => {
    const t = new Trace(1);
    t.setRange(5, 0.5, 6, 0.5);
    t.setRange(-3, 0.5, -1, 0.5);
    expect(t.coverage()).toBe(0);
  });

  it('recorta los valores a [0, 1]', () => {
    const t = new Trace(1);
    t.setRange(0, -0.5, 0.2, 1.7);
    expect(t.values[0]).toBe(0);
    expect(t.values[1]).toBeCloseTo(0.6);
    expect(t.values[2]).toBe(1);
  });

  it('ignora valores no finitos', () => {
    const t = new Trace(1);
    t.setRange(0, NaN, 0.5, 0.5);
    t.setRange(0, 0.5, Infinity, 0.5);
    expect(t.coverage()).toBe(0);
  });

  it('sobrescribe lo que ya había', () => {
    const t = new Trace(1);
    t.setRange(0, 0.2, 1, 0.2);
    t.setRange(0.3, 0.9, 0.5, 0.9);
    expect(defined(t).slice(2, 7)).toEqual([0.2, 0.9, 0.9, 0.9, 0.2]);
  });
});

describe('cobertura', () => {
  it('es la fracción de índices no NaN', () => {
    const t = new Trace(0.9); // 10 muestras
    expect(t.n).toBe(10);
    t.setRange(0, 0.5, 0.3, 0.5); // 4 índices
    expect(t.coverage()).toBeCloseTo(0.4);
  });

  it('funciona sobre arreglos guardados', () => {
    expect(coverageOf([0.1, NaN, 0.3, NaN])).toBe(0.5);
    expect(coverageOf([])).toBe(0);
  });

  it('clear vuelve a cero', () => {
    const t = new Trace(1);
    t.setRange(0, 0.5, 1, 0.5);
    t.clear();
    expect(t.coverage()).toBe(0);
  });
});

describe('grabación con beginPass/sample (SPEC §7.6)', () => {
  it('rellena desde el último tiempo muestreado aunque los cuadros lleguen irregulares', () => {
    const t = new Trace(5);
    t.beginPass(0, 0.5);
    // Cuadros a ~16 ms con tirones de hasta 300 ms.
    const times = [0.016, 0.033, 0.35, 0.36, 1.2, 1.21, 2.9, 4.0, 4.99, 5];
    for (const time of times) t.sample(time, 0.5 + (time / 5) * 0.4);
    expect(t.coverage()).toBe(1);
    expect(t.values[t.n - 1]).toBeCloseTo(0.9);
  });

  it('beginPass borra la pasada anterior', () => {
    const t = new Trace(2);
    t.beginPass(0, 0.5);
    t.sample(2, 0.5);
    t.beginPass(0, 0.5);
    expect(t.coverage()).toBeCloseTo(1 / t.n);
    expect(t.values[0]).toBe(0.5);
  });

  it('el valor se mantiene entre cambios: rellena con interpolación hasta el nuevo valor', () => {
    const t = new Trace(1);
    t.beginPass(0, 0.5);
    t.sample(0.5, 0.5);
    t.sample(1, 1);
    expect(defined(t)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it('toJSONValues convierte NaN en null y redondea a 4 decimales', () => {
    const t = new Trace(0.2);
    t.setRange(0, 1 / 3, 0, 1 / 3);
    expect(t.toJSONValues()).toEqual([0.3333, null, null]);
  });
});

describe('remuestreo por ventanas', () => {
  const ramp = (n: number) => Array.from({ length: n }, (_, i) => i / (n - 1));

  it('promedia ventanas semiabiertas [t, t + paso) de 1 s', () => {
    const vals = ramp(21); // 2 s a 10 Hz, 0..1
    const w = resample(vals, 2, 1);
    expect(w.map((x) => x.t)).toEqual([0, 1]);
    // Ventana 0: índices 0..9 → media de 0..0,45 = 0,225; ventana 1: 10..19 → 0,725.
    expect(w[0]!.v).toBeCloseTo(0.225);
    expect(w[1]!.v).toBeCloseTo(0.725);
  });

  it('da 120 ventanas para 120 s con paso de 1 s', () => {
    expect(resample(new Array(1201).fill(0.5), 120, 1)).toHaveLength(120);
  });

  it('ignora NaN y devuelve null si la ventana no tiene datos', () => {
    const vals = [0.2, NaN, 0.4, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
    const w = resample(vals, 1, 0.5);
    expect(w).toHaveLength(2);
    expect(w[0]!.v).toBeCloseTo(0.3);
    expect(w[1]!.v).toBeNull();
  });

  it('con paso 0,1 cada ventana es una muestra', () => {
    const vals = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const w = resample(vals, 0.5, 0.1);
    expect(w.map((x) => x.t)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(w.map((x) => x.v)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('con pasos que no son múltiplo de 0,1 las ventanas no se solapan ni dejan huecos', () => {
    const vals = Array.from({ length: 101 }, (_, i) => i);
    const w = resample(vals, 10, 0.25);
    expect(w).toHaveLength(40);
    expect(w[39]!.t).toBe(9.75);
    // Cada índice 0..99 entra exactamente en una ventana: la suma de medias·tamaños cuadra.
    let i0 = 0;
    let total = 0;
    for (let k = 0; k < w.length; k++) {
      const i1 = Math.round((k + 1) * 0.25 * HZ) - 1;
      total += w[k]!.v! * (i1 - i0 + 1);
      i0 = i1 + 1;
    }
    expect(i0).toBe(100);
    expect(total).toBeCloseTo((99 * 100) / 2);
  });

  it('la última ventana parcial se recorta al final del buffer', () => {
    const w = resample(new Array(26).fill(0.5), 2.5, 1);
    expect(w.map((x) => x.t)).toEqual([0, 1, 2]);
    expect(w[2]!.v).toBe(0.5);
  });

  it('rechaza pasos no positivos', () => {
    expect(() => resample([0.5], 1, 0)).toThrow();
  });
});
