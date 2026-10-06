import { describe, expect, it } from 'vitest';
import { DimensionRecorder, VALOR_INICIAL } from '../src/trace/recorder';
import {
  sliderTopFromValue,
  sliderValueFromY,
  timeFromX,
  valueFromY,
  xFromTime,
  yFromValue,
} from '../src/trace/render';
import type { Dimension } from '../src/state';

const DIM: Dimension = { nombre: 'Diversión', pregunta: '¿Cuánto?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' };

/** Simula una pasada completa a ~60 cuadros por segundo; `valueAt` da el valor del dedo. */
function runPass(rec: DimensionRecorder, valueAt: (t: number) => number, stopAt = rec.duration) {
  rec.begin(0);
  for (let t = 0; t < stopAt; t += 1 / 60) {
    rec.setValue(valueAt(t));
    rec.sample(t, t * 1000);
  }
  if (stopAt >= rec.duration) rec.finish(rec.duration * 1000);
}

describe('DimensionRecorder: pasadas (SPEC §7.6)', () => {
  it('criterio de aceptación: 2 minutos dan 1201 muestras con cobertura 1,0', () => {
    const rec = new DimensionRecorder(120);
    runPass(rec, () => 0.7);
    expect(rec.state).toBe('terminada');
    expect(rec.trace.values.length).toBe(1201);
    expect(rec.trace.coverage()).toBe(1);
    expect(rec.check()).toBe('completa');
  });

  it('la pasada empieza en (0, 0,5) y registra ese punto crudo', () => {
    const rec = new DimensionRecorder(10);
    rec.begin(1234);
    expect(rec.value).toBe(VALOR_INICIAL);
    expect(rec.trace.values[0]).toBe(0.5);
    expect(rec.raw).toEqual([{ pasada: 1, t: 0, v: 0.5, ms: 1234 }]);
  });

  it('registra un punto crudo solo cuando el valor cambia', () => {
    const rec = new DimensionRecorder(10);
    rec.begin(0);
    rec.sample(0.5, 500);
    rec.sample(1, 1000);
    rec.setValue(0.8);
    rec.sample(1.5, 1500);
    rec.sample(2, 2000);
    expect(rec.raw.map((p) => [p.t, p.v])).toEqual([
      [0, 0.5],
      [1.5, 0.8],
    ]);
  });

  it('interpola entre muestras y mantiene el valor al soltar', () => {
    const rec = new DimensionRecorder(10);
    rec.begin(0);
    rec.setValue(1);
    rec.sample(1, 1000); // de 0,5 en t=0 a 1 en t=1
    rec.sample(2, 2000); // se mantiene en 1
    expect(rec.trace.values[5]).toBeCloseTo(0.75, 10);
    expect(rec.trace.values[20]).toBe(1);
  });

  it('el valor se recorta a [0, 1] y no cambia fuera de la grabación', () => {
    const rec = new DimensionRecorder(10);
    rec.setValue(0.9);
    expect(rec.value).toBe(0.5);
    rec.begin(0);
    rec.setValue(1.7);
    expect(rec.value).toBe(1);
    rec.setValue(-3);
    expect(rec.value).toBe(0);
  });

  it('la última muestra se toma en la duración aunque el video se detenga un poco antes', () => {
    const rec = new DimensionRecorder(12.3);
    runPass(rec, () => 0.2, 12.25);
    rec.finish(12300);
    expect(rec.trace.coverage()).toBe(1);
    expect(rec.trace.values[rec.trace.n - 1]).toBe(0.2);
  });

  it('«Repetir» borra la línea, el trazo crudo y los toques, y cuenta otra pasada', () => {
    const rec = new DimensionRecorder(5);
    rec.begin(0);
    rec.touch();
    rec.touch();
    rec.setValue(0.9);
    rec.sample(5, 5000);
    rec.finish(5000);
    rec.begin(6000);
    expect(rec.pasadas).toBe(2);
    expect(rec.toques).toBe(0);
    expect(rec.raw).toEqual([{ pasada: 2, t: 0, v: 0.5, ms: 6000 }]);
    expect(rec.trace.coverage()).toBeCloseTo(1 / rec.trace.n, 10);
  });

  it('los toques solo cuentan durante la grabación', () => {
    const rec = new DimensionRecorder(5);
    rec.touch();
    rec.begin(0);
    rec.touch();
    rec.finish(5000);
    rec.touch();
    expect(rec.toques).toBe(1);
  });

  it('no muestrea fuera de la grabación', () => {
    const rec = new DimensionRecorder(5);
    rec.sample(1, 1000);
    expect(rec.trace.coverage()).toBe(0);
    rec.begin(0);
    rec.finish(5000);
    rec.sample(2, 9000);
    expect(rec.raw).toHaveLength(1);
  });
});

describe('DimensionRecorder: interrupción y saltos (SPEC §7.5, §13)', () => {
  it('una interrupción borra la pasada y obliga a repetir', () => {
    const rec = new DimensionRecorder(10);
    runPass(rec, () => 0.3, 4);
    rec.interrupt();
    expect(rec.state).toBe('espera');
    expect(rec.interrumpida).toBe(true);
    expect(rec.trace.coverage()).toBe(0);
    expect(rec.raw).toEqual([]);
    expect(rec.check()).toBe('vacia');
    expect(rec.pasadas).toBe(1);
    rec.begin(0);
    expect(rec.interrumpida).toBe(false);
    expect(rec.pasadas).toBe(2);
  });

  it('interrumpir fuera de la grabación no borra una pasada terminada', () => {
    const rec = new DimensionRecorder(5);
    runPass(rec, () => 0.6);
    rec.interrupt();
    expect(rec.state).toBe('terminada');
    expect(rec.trace.coverage()).toBe(1);
  });

  it('la línea de tiempo está bloqueada durante la grabación y cada gesto fuera de ella es un salto', () => {
    const rec = new DimensionRecorder(5);
    expect(rec.seek()).toBe(true);
    rec.begin(0);
    expect(rec.seek()).toBe(false);
    rec.finish(5000);
    expect(rec.seek()).toBe(true);
    expect(rec.saltos).toBe(2);
  });
});

describe('DimensionRecorder: «Listo» (SPEC §7.8)', () => {
  it('sin línea, con huecos o completa', () => {
    const rec = new DimensionRecorder(10);
    expect(rec.check()).toBe('vacia');
    rec.trace.setRange(0, 0.5, 8.9, 0.5);
    expect(rec.check()).toBe('incompleta'); // 90 de 101 muestras
    rec.trace.setRange(0, 0.5, 9.1, 0.5);
    expect(rec.check()).toBe('completa'); // 92 de 101
  });

  it('toRecord copia los datos de la última pasada', () => {
    const rec = new DimensionRecorder(3);
    runPass(rec, (t) => (t < 1 ? 0.5 : 0.9));
    const r = rec.toRecord(DIM, 'trazo', 42.5);
    expect(r).toMatchObject({ modo: 'trazo', duracionS: 3, pasadas: 1, saltosVideo: 0, tiempoRespuestaS: 42.5 });
    expect(r.dimension).toEqual(DIM);
    expect(r.dimension).not.toBe(DIM);
    expect(r.valores).toHaveLength(31);
    expect(r.trazoCrudo.map((p) => p.v)).toEqual([0.5, 0.9]);
    r.valores[0] = 0;
    expect(rec.trace.values[0]).toBe(0.5);
  });
});

describe('geometría de la gráfica (SPEC §7.3)', () => {
  it('valor = clamp(1 − (y − 14) / (alto − 28), 0, 1)', () => {
    expect(valueFromY(14, 228)).toBe(1);
    expect(valueFromY(214, 228)).toBe(0);
    expect(valueFromY(114, 228)).toBe(0.5);
    expect(valueFromY(0, 228)).toBe(1);
    expect(valueFromY(500, 228)).toBe(0);
  });

  it('yFromValue es la inversa de valueFromY', () => {
    for (const v of [0, 0.25, 0.5, 0.8, 1]) expect(valueFromY(yFromValue(v, 300), 300)).toBeCloseTo(v, 10);
  });

  it('la gráfica y la línea de tiempo usan la misma x para el mismo instante', () => {
    expect(xFromTime(0, 120, 840)).toBe(20);
    expect(xFromTime(120, 120, 840)).toBe(820);
    expect(xFromTime(60, 120, 840)).toBe(420);
    expect(timeFromX(420, 120, 840)).toBe(60);
    expect(timeFromX(0, 120, 840)).toBe(0);
    expect(timeFromX(900, 120, 840)).toBe(120);
  });

  it('el deslizador: arriba 1, abajo 0, el pulgar no se sale', () => {
    expect(sliderValueFromY(38, 400, 76)).toBe(1);
    expect(sliderValueFromY(362, 400, 76)).toBe(0);
    expect(sliderValueFromY(200, 400, 76)).toBeCloseTo(0.5, 10);
    expect(sliderTopFromValue(1, 400, 76)).toBe(0);
    expect(sliderTopFromValue(0, 400, 76)).toBe(324);
  });

  it('tamaños degenerados no producen NaN', () => {
    expect(valueFromY(5, 10)).toBe(0.5);
    expect(timeFromX(5, 10, 20)).toBe(0);
    expect(sliderValueFromY(5, 50, 76)).toBe(0.5);
  });
});
