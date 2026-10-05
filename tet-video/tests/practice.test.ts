import { describe, expect, it } from 'vitest';
import {
  ballPosition,
  distanceAt,
  pearson,
  practiceCorrelation,
  PRACTICE_DURATION,
  SPEED_KEYS,
  speedAt,
} from '../src/practice';
import { HZ, Trace } from '../src/trace/trace';

describe('perfil de velocidad (SPEC §10)', () => {
  it('pasa por los puntos del perfil', () => {
    for (const [t, v] of SPEED_KEYS) expect(speedAt(t)).toBeCloseTo(v, 12);
  });

  it('interpola con coseno: en el punto medio vale el promedio y es suave en los extremos', () => {
    expect(speedAt(9.5)).toBeCloseTo((0.2 + 0.9) / 2, 12);
    // Cerca de un punto del perfil la pendiente es casi nula (coseno), no lineal.
    expect(speedAt(7.25) - 0.2).toBeLessThan(0.01);
  });

  it('se mantiene en los extremos fuera de [0, 40]', () => {
    expect(speedAt(-5)).toBe(0.2);
    expect(speedAt(50)).toBe(0.7);
  });

  it('dura 40 s', () => {
    expect(PRACTICE_DURATION).toBe(40);
  });
});

describe('posición de la pelota', () => {
  it('es determinista al saltar en el tiempo', () => {
    const a = ballPosition(23.37);
    ballPosition(5);
    ballPosition(39);
    expect(ballPosition(23.37)).toBe(a);
  });

  it('la distancia es continua y creciente (sin escalones de 0,05 s)', () => {
    let prev = distanceAt(0);
    for (let t = 0.01; t <= PRACTICE_DURATION; t += 0.01) {
      const d = distanceAt(t);
      expect(d).toBeGreaterThan(prev);
      expect(d - prev).toBeLessThan(0.0101);
      prev = d;
    }
  });

  it('se mantiene dentro de la pista', () => {
    for (let t = 0; t <= PRACTICE_DURATION; t += 0.1) {
      const p = ballPosition(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('empieza a la izquierda', () => {
    expect(ballPosition(0)).toBe(0);
  });
});

describe('correlación de Pearson', () => {
  it('vale 1, −1 y null en casos conocidos', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });

  it('coincide con un valor calculado a mano', () => {
    // x = 1..5, y = 2,1,4,3,5 → r = 0,8
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 12);
  });
});

describe('correlación de la práctica', () => {
  const traceOf = (fn: (t: number) => number) => {
    const tr = new Trace(PRACTICE_DURATION);
    for (let i = 0; i < tr.n; i++) tr.setRange(i / HZ, fn(i / HZ), i / HZ, fn(i / HZ));
    return tr.values;
  };

  it('es 1 si el trazo sigue la velocidad real', () => {
    expect(practiceCorrelation(traceOf(speedAt))).toBeCloseTo(1, 9);
  });

  it('no depende de la escala del trazo', () => {
    expect(practiceCorrelation(traceOf((t) => 0.1 + 0.5 * speedAt(t)))).toBeCloseTo(1, 9);
  });

  it('es negativa si el trazo va al revés', () => {
    expect(practiceCorrelation(traceOf((t) => 1 - speedAt(t)))).toBeCloseTo(-1, 9);
  });

  it('usa solo los índices con dato', () => {
    const vals = traceOf(speedAt);
    for (let i = 0; i < vals.length; i += 2) vals[i] = NaN;
    expect(practiceCorrelation(vals)).toBeCloseTo(1, 9);
  });

  it('devuelve null con menos de 10 puntos', () => {
    const vals = new Float64Array(401).fill(NaN);
    for (let i = 0; i < 9; i++) vals[i * 40] = speedAt(i * 4);
    expect(practiceCorrelation(vals)).toBeNull();
    vals[399] = 0.5;
    expect(practiceCorrelation(vals)).not.toBeNull();
  });

  it('devuelve null si el trazo es plano', () => {
    expect(practiceCorrelation(new Float64Array(401).fill(0.5))).toBeNull();
  });
});
