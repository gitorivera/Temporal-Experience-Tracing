import { describe, expect, it } from 'vitest';
import { HOLD_MAX_DT, HOLD_RATE, HoldInput, holdStep } from '../src/trace/hold';
import { DimensionRecorder } from '../src/trace/recorder';

describe('modo botones: mantener pulsado', () => {
  it('sube y baja a velocidad constante: de abajo a arriba en 2 s', () => {
    expect(HOLD_RATE).toBe(0.5);
    let v = 0;
    for (let k = 0; k < 120; k++) v = holdStep(v, 1, 1 / 60);
    expect(v).toBeCloseTo(1, 6);
    expect(holdStep(0.5, -1, 0.1)).toBeCloseTo(0.45, 9);
  });

  it('no sale de 0 a 1 y sin botón no se mueve', () => {
    expect(holdStep(0.98, 1, 0.1)).toBe(1);
    expect(holdStep(0.02, -1, 0.1)).toBe(0);
    expect(holdStep(0.3, 0, 0.1)).toBe(0.3);
    expect(holdStep(0.3, 1, -1)).toBe(0.3);
    expect(holdStep(0.3, 1, NaN)).toBe(0.3);
  });

  it('tras un tirón largo el paso se limita (la línea no salta)', () => {
    expect(holdStep(0.2, 1, 3)).toBeCloseTo(0.2 + HOLD_RATE * HOLD_MAX_DT, 9);
  });

  it('cada fuente se suelta por separado; ▲ y ▼ a la vez se anulan', () => {
    const h = new HoldInput();
    expect(h.direction).toBe(0);
    expect(h.press('kArrowUp', 1)).toBe(true);
    // La repetición de la misma tecla no es un toque nuevo.
    expect(h.press('kArrowUp', 1)).toBe(false);
    expect(h.direction).toBe(1);
    expect(h.press('p1', 1)).toBe(true);
    h.release('kArrowUp');
    expect(h.direction).toBe(1);
    h.press('p2', -1);
    expect(h.direction).toBe(0);
    expect(h.isPressed(-1)).toBe(true);
    h.release('p1');
    expect(h.direction).toBe(-1);
    h.releaseAll();
    expect(h.direction).toBe(0);
  });

  it('con el registro: mantener ▲ 1 s desde 0,5 llega al tope y se queda al soltar', () => {
    const rec = new DimensionRecorder(10);
    const h = new HoldInput();
    rec.begin(0);
    h.press('kArrowUp', 1);
    rec.touch();
    let t = 0;
    for (; t < 1; t += 1 / 60) {
      rec.setValue(holdStep(rec.value, h.direction, 1 / 60));
      rec.sample(t, t * 1000);
    }
    h.release('kArrowUp');
    for (; t < 10; t += 1 / 60) {
      rec.setValue(holdStep(rec.value, h.direction, 1 / 60));
      rec.sample(t, t * 1000);
    }
    rec.finish(10000);
    expect(rec.toques).toBe(1);
    // Empieza en 0,5 (más lo que avanzó en el primer cuadro).
    expect(rec.trace.values[0]).toBeLessThan(0.55);
    expect(rec.trace.values[100]).toBeCloseTo(1, 2);
    expect(rec.value).toBeCloseTo(1, 2);
  });
});
