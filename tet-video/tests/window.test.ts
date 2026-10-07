import { describe, expect, it } from 'vitest';
import { syncFromPoints, type Sync } from '../src/data/sync';
import { eventsInWindow, traceWindow } from '../src/data/window';
import { VirtualPlayer, type VirtualEnv } from '../src/players/virtualPlayer';
import { WindowedPlayer } from '../src/players/windowedPlayer';
import { bufferLength } from '../src/trace/trace';

// Grabación real de RM (2026-10-07): 4 sync y sus destellos; el video termina en 167,005 s.
const LSL = [4689.15254, 4749.152609, 4809.15126, 4833.108605];
const V = [7.127, 67.143, 127.142, 151.067];
const tramos = syncFromPoints(LSL.map((l, k) => ({ etiqueta: `sync_${k + 1}`, videoS: V[k]!, lslS: l, origen: 'auto' as const })));
const END = 167.005;

/** El fin queda en (objetivo − 0,1 s, objetivo] y la duración es un múltiplo de 0,1 s. */
function expectEnd(v: { inicioS: number; finS: number }, objetivo: number) {
  expect(v.finS).toBeLessThanOrEqual(objetivo + 1e-9);
  expect(v.finS).toBeGreaterThan(objetivo - 0.1);
  const muestras = (v.finS - v.inicioS) * 10;
  expect(Math.abs(muestras - Math.round(muestras))).toBeLessThan(1e-6);
}

describe('ventana de trazado (SPEC §16.8)', () => {
  it('va del destello de la primera fila sync al de la última', () => {
    const v = traceWindow(LSL, tramos, END);
    expect(v.inicioS).toBeCloseTo(7.127, 9);
    expectEnd(v, 151.067);
  });

  it('con un solo destello, la última fila sync se ubica con la misma sincronización', () => {
    const uno: Sync = { videoS: 7.13, lslS: LSL[0]! };
    const v = traceWindow(LSL, uno, END);
    expect(v.inicioS).toBeCloseTo(7.13, 9);
    expectEnd(v, 7.13 + (LSL[3]! - LSL[0]!));
  });

  it('si falta el destello de la primera fila, el inicio sale de la sincronización de las demás', () => {
    const sinPrimero = syncFromPoints(LSL.slice(1).map((l, k) => ({ etiqueta: `sync_${k + 2}`, videoS: V[k + 1]!, lslS: l, origen: 'auto' as const })));
    expect(traceWindow(LSL, sinPrimero, END).inicioS).toBeCloseTo(7.127, 1);
  });

  it('con una sola fila sync termina al final del video', () => {
    const v = traceWindow([LSL[0]!], { videoS: 7.13, lslS: LSL[0]! }, END);
    expect(v.inicioS).toBe(7.13);
    expectEnd(v, END);
  });

  it('nunca pasa del último cuadro ni empieza antes de 0', () => {
    expectEnd(traceWindow(LSL, tramos, 140), 140);
    const antes: Sync = { videoS: 2, lslS: LSL[0]! + 5 }; // la primera fila cae 5 s antes del video
    expect(traceWindow(LSL, antes, END).inicioS).toBe(0);
  });

  it('sin filas sync (sin LSL), o con una ventana degenerada, el video completo', () => {
    for (const v of [traceWindow([], { videoS: 7, lslS: null }, END), traceWindow(LSL, { videoS: 200, lslS: LSL[0]! }, END)]) {
      expect(v.inicioS).toBe(0);
      expectEnd(v, END);
    }
  });

  it('la última muestra del buffer cae en el fin: no hay filas después', () => {
    const v = traceWindow(LSL, tramos, END);
    const d = v.finS - v.inicioS;
    expect((bufferLength(d) - 1) / 10).toBeCloseTo(d, 9);
  });

  it('los eventos pasan a tiempo de la ventana y se descartan los de fuera', () => {
    const ev = [
      { t: 5, label: 'antes', icon: '◆' },
      { t: 7.127, label: 'inicio partida', icon: '🚩' },
      { t: 100, label: 'acierto', icon: '⭐' },
      { t: 160, label: 'después', icon: '◆' },
    ];
    expect(eventsInWindow(ev, { inicioS: 7.127, finS: 151.067 }).map((e) => [e.label, Math.round(e.t * 1000) / 1000])).toEqual([
      ['inicio partida', 0],
      ['acierto', 92.873],
    ]);
  });
});

// ---------------------------------------------------------------------------
// WindowedPlayer sobre un VirtualPlayer con reloj controlado a mano
// ---------------------------------------------------------------------------
function setup(duration = 20, ventana = { inicioS: 5, finS: 12 }) {
  let now = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  const env: VirtualEnv = {
    canvas: { width: 0, height: 0, getContext: () => ({}) } as unknown as HTMLCanvasElement,
    now: () => now,
    requestFrame: (cb) => (frames.set(next, cb), next++),
    cancelFrame: (id) => frames.delete(id),
  };
  const inner = new VirtualPlayer(duration, () => {}, env);
  const p = new WindowedPlayer(inner, ventana, { requestFrame: env.requestFrame, cancelFrame: env.cancelFrame });
  const advance = (ms: number) => {
    for (let k = 0; k < ms / 16; k++) {
      now += 16;
      const cbs = [...frames.values()];
      frames.clear();
      cbs.forEach((cb) => cb());
    }
  };
  return { p, inner, advance };
}

describe('WindowedPlayer', () => {
  it('muestra la ventana en tiempo local', () => {
    const { p, inner } = setup();
    expect(p.duration).toBe(7);
    p.currentTime = 0;
    expect(inner.currentTime).toBe(5);
    p.currentTime = 3;
    expect(inner.currentTime).toBe(8);
    expect(p.currentTime).toBe(3);
  });

  it('no deja salir de la ventana al saltar', () => {
    const { p, inner } = setup();
    p.currentTime = -4;
    expect(inner.currentTime).toBe(5);
    p.currentTime = 99;
    expect(inner.currentTime).toBe(12);
    expect(p.currentTime).toBe(7);
  });

  it('se detiene en el fin de la ventana, avisa una vez y no pasa de ahí', async () => {
    const { p, inner, advance } = setup();
    let fin = 0;
    p.onEnded(() => fin++);
    p.currentTime = 0;
    await p.play();
    advance(8000);
    expect(fin).toBe(1);
    expect(p.paused).toBe(true);
    expect(inner.currentTime).toBe(12);
    expect(p.currentTime).toBe(7);
  });

  it('si la ventana llega al final del video, avisa una sola vez', async () => {
    const { p, advance } = setup(10, { inicioS: 5, finS: 10 });
    let fin = 0;
    p.onEnded(() => fin++);
    await p.play();
    advance(6000);
    expect(fin).toBe(1);
  });

  it('play() al final vuelve al inicio de la ventana', async () => {
    const { p, inner, advance } = setup();
    p.currentTime = 7;
    await p.play();
    expect(inner.currentTime).toBeCloseTo(5, 6);
    advance(1000);
    expect(p.currentTime).toBeGreaterThan(0.9);
  });

  it('rechaza una ventana vacía', () => {
    expect(() => setup(20, { inicioS: 8, finS: 8 })).toThrow(RangeError);
  });
});
