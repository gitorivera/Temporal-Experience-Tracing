import { describe, expect, it } from 'vitest';
import {
  boxAround,
  chooseRegion,
  findRegions,
  findRuns,
  flashesOf,
  matchFlashes,
  pixelsInBox,
  PulseAccumulator,
  sanitizeBox,
  whiteFraction,
  whiteMask,
  type FrameSample,
} from '../src/data/flash';

// ---------------------------------------------------------------------------
// Video sintético: máscaras de blanco de 96×54 (16:9), como el cuadro reducido del navegador.
// ---------------------------------------------------------------------------
const W = 96;
const H = 54;
/** Destello: cuadrado de 8×8 en (44, 6). */
const FLASH = { x: 44, y: 6, s: 8 };
/** Tiempos LSL de los sync de una partida (como en la grabación real: 0, 60, 120 y el final). */
const LSL = [4689.15, 4749.15, 4809.15, 4833.11];
/** El video empieza 7,1 s antes del primer destello. */
const toVideo = (l: number) => 7.1 + (l - LSL[0]!);

interface Scene {
  flashes: number[];
  /** Señuelos: cuadrados blancos que aparecen una vez en otro lugar. */
  decoys?: { t: number; x: number; y: number }[];
}

function frame(t: number, scene: Scene): Uint8Array {
  const m = new Uint8Array(W * H);
  const rect = (x0: number, y0: number, w: number, h: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) m[y * W + x] = 1;
  };
  // Pared blanca que se desliza (movimiento de la cabeza): bordes que cambian en cada cuadro.
  rect(Math.floor((t * 37) % W), 20, 6, 34);
  for (const f of scene.flashes) if (t >= f && t < f + 0.3) rect(FLASH.x, FLASH.y, FLASH.s, FLASH.s);
  for (const d of scene.decoys ?? []) if (t >= d.t && t < d.t + 0.3) rect(d.x, d.y, 8, 8);
  return m;
}

/** Recorre el video con un cuadro cada `dt` segundos (a 4× en el navegador se ve uno de cada 2 o 3). */
function scan(scene: Scene, duration: number, dt = 1 / 30): PulseAccumulator {
  const acc = new PulseAccumulator(W, H);
  for (let k = 0; k * dt <= duration; k++) acc.push(k * dt, frame(k * dt, scene));
  return acc;
}

const rgba = (pixels: [number, number, number][]) => new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('blanco casi puro', () => {
  it('whiteMask exige los tres canales por encima de 220', () => {
    expect([...whiteMask(rgba([[255, 255, 255], [230, 230, 221], [255, 255, 200], [220, 255, 255]]))]).toEqual([1, 1, 0, 0]);
  });

  it('whiteFraction mide solo el interior del recorte', () => {
    // 10×10: marco negro de 1 px, interior blanco.
    const px: [number, number, number][] = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) px.push(x === 0 || y === 0 || x === 9 || y === 9 ? [0, 0, 0] : [255, 255, 255]);
    expect(whiteFraction(rgba(px), 10, 10)).toBe(1);
    expect(whiteFraction(rgba(px), 10, 10, 0)).toBeCloseTo(64 / 100, 9);
  });
});

describe('rachas de la medida del recuadro (refinamiento)', () => {
  const samples = (on: [number, number][], from = 0, to = 3, dt = 1 / 30): FrameSample[] => {
    const out: FrameSample[] = [];
    for (let t = from; t <= to; t += dt) out.push({ t, f: on.some(([a, b]) => t >= a && t < b) ? 0.97 : 0.1 });
    return out;
  };

  it('el inicio de la racha es el primer cuadro blanco', () => {
    const runs = findRuns(samples([[1.0, 1.3]]));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.start).toBeGreaterThanOrEqual(1.0);
    expect(runs[0]!.start).toBeLessThan(1.0 + 1 / 30);
    expect(runs[0]!.frames).toBeGreaterThanOrEqual(8);
  });

  it('descarta rachas demasiado cortas o largas', () => {
    expect(findRuns(samples([[1, 1.05]]))).toEqual([]);
    expect(findRuns(samples([[1, 2]]))).toEqual([]);
  });

  it('descarta una racha que empieza en el primer cuadro medido: su inicio no se conoce', () => {
    expect(findRuns(samples([[0, 0.3]]))).toEqual([]);
  });

  it('acepta cuadros con duración variable y desordenados', () => {
    const s: FrameSample[] = [0.5, 0.52, 0.56, 0.6, 0.61, 0.66, 0.7, 0.75, 0.8, 0.82, 0.9, 0.95, 1.0, 1.05].map((t) => ({ t, f: t >= 0.6 && t < 0.9 ? 1 : 0 }));
    expect(findRuns(s.reverse())).toEqual([{ start: 0.6, end: 0.9, frames: 7 }]);
  });
});

describe('ubicación automática del recuadro (SPEC §16.4)', () => {
  const flashes = LSL.map(toVideo);

  it('encuentra el destello entre el movimiento y un señuelo, y lo empareja con los sync', () => {
    const scene: Scene = { flashes, decoys: [{ t: 30, x: 10, y: 5 }] };
    const acc = scan(scene, 160);
    const choice = chooseRegion(findRegions(acc), LSL);
    expect(choice).not.toBeNull();
    const { box } = choice!.region;
    expect(box.x * W).toBeCloseTo(FLASH.x, 0);
    expect(box.y * H).toBeCloseTo(FLASH.y, 0);
    expect(box.w * W).toBeCloseTo(FLASH.s, 0);
    expect(choice!.match.matched).toBe(4);
    choice!.match.pairs.forEach((v, k) => expect(Math.abs(v! - flashes[k]!)).toBeLessThan(1 / 30 + 1e-9));
  });

  it('funciona con cuadros salteados, como a 4×', () => {
    const acc = scan({ flashes }, 160, 0.075);
    const choice = chooseRegion(findRegions(acc), LSL);
    expect(choice?.match.matched).toBe(4);
    // El tiempo aproximado queda a menos de un cuadro salteado; el refinamiento lo precisa.
    choice!.match.pairs.forEach((v, k) => expect(Math.abs(v! - flashes[k]!)).toBeLessThan(0.075 + 1e-9));
  });

  it('un destello que falta en el video queda sin pareja y no corre a los demás', () => {
    const acc = scan({ flashes: flashes.filter((_, k) => k !== 1) }, 160);
    const choice = chooseRegion(findRegions(acc), LSL);
    expect(choice?.match.matched).toBe(3);
    expect(choice!.match.pairs[1]).toBeNull();
    expect(Math.abs(choice!.match.pairs[2]! - flashes[2]!)).toBeLessThan(0.04);
  });

  it('sin destellos no elige nada', () => {
    expect(chooseRegion(findRegions(scan({ flashes: [] }, 60)), LSL)).toBeNull();
  });

  it('un recuadro conocido da los mismos destellos sin buscarlo', () => {
    const acc = scan({ flashes }, 160);
    const box = { x: FLASH.x / W, y: FLASH.y / H, w: FLASH.s / W, h: FLASH.s / H };
    const found = flashesOf(acc, pixelsInBox(acc, box));
    expect(found).toHaveLength(4);
    found.forEach((v, k) => expect(Math.abs(v - flashes[k]!)).toBeLessThan(0.04));
  });
});

describe('emparejamiento con los sync', () => {
  it('con desfase y deriva', () => {
    const f = LSL.map((l) => 3 + (l - LSL[0]!) * 1.001);
    const m = matchFlashes(f, LSL);
    expect(m).toEqual({ pairs: f, matched: 4, extra: 0 });
  });

  it('un destello de más se ignora', () => {
    const f = LSL.map(toVideo);
    const m = matchFlashes([...f, 40], LSL);
    expect(m.pairs).toEqual(f);
    expect(m.extra).toBe(1);
  });

  it('si falta el primero, los demás se emparejan bien', () => {
    const f = LSL.map(toVideo);
    const m = matchFlashes(f.slice(1), LSL);
    expect(m.pairs).toEqual([null, ...f.slice(1)]);
  });

  it('sin destellos', () => {
    expect(matchFlashes([], LSL)).toEqual({ pairs: [null, null, null, null], matched: 0, extra: 0 });
  });
});

describe('recuadro marcado a mano', () => {
  const mask = frame(toVideo(LSL[0]!) + 0.1, { flashes: [toVideo(LSL[0]!)] });

  it('toma la zona blanca alrededor del toque', () => {
    const box = boxAround(mask, W, H, (FLASH.x + 3) / W, (FLASH.y + 3) / H);
    expect(box).toEqual({ x: FLASH.x / W, y: FLASH.y / H, w: FLASH.s / W, h: FLASH.s / H });
  });

  it('un toque un poco afuera también sirve', () => {
    expect(boxAround(mask, W, H, (FLASH.x - 1) / W, (FLASH.y + 3) / H)).not.toBeNull();
  });

  it('lejos de cualquier blanco, o sobre una zona demasiado grande, no hay recuadro', () => {
    expect(boxAround(mask, W, H, 0.95, 0.05)).toBeNull();
    expect(boxAround(new Uint8Array(W * H).fill(1), W, H, 0.5, 0.5)).toBeNull();
  });

  it('sanitizeBox acepta solo recuadros dentro del cuadro', () => {
    expect(sanitizeBox({ x: 0.48, y: 0.12, w: 0.08, h: 0.15 })).toEqual({ x: 0.48, y: 0.12, w: 0.08, h: 0.15 });
    expect(sanitizeBox({ x: 0.95, y: 0.12, w: 0.08, h: 0.15 })).toBeNull();
    expect(sanitizeBox(undefined)).toBeNull();
  });
});
