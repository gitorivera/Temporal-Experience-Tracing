// Detección de destellos en el video (SPEC §16.4), sin DOM para poder probarla.
// El destello es un cuadrado blanco fijo en la pantalla: se ubica su recuadro buscando zonas
// que pasan a blanco casi puro durante 0,1 a 0,8 s, y se toma el primer cuadro blanco de cada pulso.

/** Canal mínimo (0 a 255) a partir del cual un píxel cuenta como blanco casi puro. */
export const WHITE_MIN = 220;
/** Duración aceptada de un destello, en segundos de video. */
export const FLASH_MIN_S = 0.1;
export const FLASH_MAX_S = 0.8;
/** Fracción del interior del recuadro que debe ser blanca para contar como destello. */
export const FLASH_ON_FRACTION = 0.8;
/** Margen de cada lado que se descarta al medir el interior del recuadro (el borde se mezcla con el marco). */
export const BOX_INSET = 0.15;

/** Recuadro en coordenadas relativas al cuadro (0 a 1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 1 donde el píxel RGBA es blanco casi puro. */
export function whiteMask(rgba: ArrayLike<number>, out = new Uint8Array(rgba.length / 4)): Uint8Array {
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = rgba[i]! > WHITE_MIN && rgba[i + 1]! > WHITE_MIN && rgba[i + 2]! > WHITE_MIN ? 1 : 0;
  }
  return out;
}

/** Fracción de píxeles blancos en el interior de una imagen RGBA (el recorte del recuadro). */
export function whiteFraction(rgba: ArrayLike<number>, width: number, height: number, inset = BOX_INSET): number {
  const x0 = Math.floor(width * inset);
  const y0 = Math.floor(height * inset);
  const x1 = Math.max(x0 + 1, width - x0);
  const y1 = Math.max(y0 + 1, height - y0);
  let white = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i]! > WHITE_MIN && rgba[i + 1]! > WHITE_MIN && rgba[i + 2]! > WHITE_MIN) white++;
    }
  }
  return white / ((x1 - x0) * (y1 - y0));
}

// ---------------------------------------------------------------------------
// Rachas en la medida del recuadro (refinamiento cuadro por cuadro)
// ---------------------------------------------------------------------------

/** Medida de un cuadro: su tiempo en el video y la fracción de blanco en el recuadro. */
export interface FrameSample {
  t: number;
  f: number;
}

export interface Run {
  /** Tiempo del primer cuadro blanco (V_k). */
  start: number;
  /** Tiempo del primer cuadro que ya no es blanco (o del último blanco, si el video termina). */
  end: number;
  frames: number;
}

/** Rachas de cuadros con fracción ≥ FLASH_ON_FRACTION que duran entre FLASH_MIN_S y FLASH_MAX_S. */
export function findRuns(samples: readonly FrameSample[]): Run[] {
  const s = [...samples].sort((a, b) => a.t - b.t);
  const runs: Run[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i]!.f < FLASH_ON_FRACTION) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < s.length && s[j + 1]!.f >= FLASH_ON_FRACTION) j++;
    const end = j + 1 < s.length ? s[j + 1]!.t : s[j]!.t;
    const dur = end - s[i]!.t;
    // Una racha que empieza en el primer cuadro medido puede haber empezado antes: su inicio no es fiable.
    if (i > 0 && dur >= FLASH_MIN_S && dur <= FLASH_MAX_S) runs.push({ start: s[i]!.t, end, frames: j - i + 1 });
    i = j + 1;
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Pulsos por píxel (ubicación automática del recuadro)
// ---------------------------------------------------------------------------

/**
 * Recorre los cuadros reducidos (máscara de blanco) y anota cada pulso: un píxel que pasa a blanco
 * desde no blanco y vuelve tras FLASH_MIN_S a FLASH_MAX_S. Guarda solo los pulsos, no los cuadros.
 */
export class PulseAccumulator {
  readonly width: number;
  readonly height: number;
  /** Pulsos en orden de llegada: píxel y tiempo de su primer cuadro blanco. */
  readonly pulsePixel: number[] = [];
  readonly pulseT: number[] = [];
  private readonly since: Float64Array;
  private started = false;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    // NaN: no está blanco; −Infinity: estaba blanco al empezar (su inicio no se conoce).
    this.since = new Float64Array(width * height).fill(NaN);
  }

  push(t: number, mask: ArrayLike<number>): void {
    const since = this.since;
    for (let p = 0; p < since.length; p++) {
      const s = since[p]!;
      if (mask[p]) {
        if (Number.isNaN(s)) since[p] = this.started ? t : -Infinity;
      } else if (!Number.isNaN(s)) {
        const dur = t - s;
        if (dur >= FLASH_MIN_S && dur <= FLASH_MAX_S) {
          this.pulsePixel.push(p);
          this.pulseT.push(s);
        }
        since[p] = NaN;
      }
    }
    this.started = true;
  }
}

/**
 * Destellos de un conjunto de píxeles: grupos de pulsos que empiezan juntos (en menos de 0,1 s)
 * y abarcan al menos la mitad de los píxeles. El tiempo es el del primer pulso del grupo.
 */
export function flashesOf(acc: PulseAccumulator, pixels: ReadonlySet<number>): number[] {
  const ts: { t: number; p: number }[] = [];
  for (let k = 0; k < acc.pulseT.length; k++) {
    const p = acc.pulsePixel[k]!;
    if (pixels.has(p)) ts.push({ t: acc.pulseT[k]!, p });
  }
  ts.sort((a, b) => a.t - b.t);
  const out: number[] = [];
  const need = Math.max(1, Math.ceil(pixels.size * 0.5));
  let i = 0;
  while (i < ts.length) {
    const seen = new Set<number>();
    let j = i;
    while (j < ts.length && ts[j]!.t - ts[i]!.t <= 0.1) seen.add(ts[j++]!.p);
    if (seen.size >= need) out.push(ts[i]!.t);
    i = j;
  }
  return out;
}

/** Píxeles (en la cuadrícula del acumulador) dentro de un recuadro relativo. */
export function pixelsInBox(acc: PulseAccumulator, box: Box): Set<number> {
  const out = new Set<number>();
  const x0 = Math.max(0, Math.floor(box.x * acc.width));
  const y0 = Math.max(0, Math.floor(box.y * acc.height));
  const x1 = Math.min(acc.width, Math.ceil((box.x + box.w) * acc.width));
  const y1 = Math.min(acc.height, Math.ceil((box.y + box.h) * acc.height));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.add(y * acc.width + x);
  return out;
}

export interface Region {
  box: Box;
  /** Fracción media del rectángulo que ocupa cada destello de la zona (1 = lleno). */
  fill: number;
  /** Tiempos de los destellos de la zona. */
  flashes: number[];
}

/** Tamaño aceptado del recuadro, como fracción del ancho del cuadro (SPEC §16.4). */
export const BOX_MIN_W = 0.02;
export const BOX_MAX_W = 0.2;

/** Bloque de píxeles vecinos que empiezan su pulso en el mismo cuadro. */
interface Blob {
  t: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fill: number;
}

/** Componentes conexas (vecindad de 4) de un conjunto de píxeles. */
function components(pixels: ReadonlySet<number>, W: number): Omit<Blob, 't'>[] {
  const seen = new Set<number>();
  const out: Omit<Blob, 't'>[] = [];
  for (const start of pixels) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    let size = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      size++;
      const x = p % W;
      const y = (p - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q >= 0 && pixels.has(q) && !seen.has(q)) {
          seen.add(q);
          stack.push(q);
        }
      }
    }
    out.push({ x0, y0, x1, y1, fill: size / ((x1 - x0 + 1) * (y1 - y0 + 1)) });
  }
  return out;
}

function iou(a: Blob, b: Blob): number {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (ix <= 0 || iy <= 0) return 0;
  const area = (r: Blob) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const inter = ix * iy;
  return inter / (area(a) + area(b) - inter);
}

/**
 * Zonas candidatas. En un destello, todos los píxeles del cuadrado empiezan su pulso en el mismo
 * cuadro y forman un bloque lleno y aproximadamente cuadrado; el movimiento de la cabeza, en cambio,
 * produce bordes delgados. Se buscan esos bloques en cada cuadro y se juntan los que se repiten en
 * el mismo lugar: cada grupo es una zona, con un destello por bloque.
 */
export function findRegions(acc: PulseAccumulator): Region[] {
  const W = acc.width;
  const H = acc.height;
  const byT = new Map<number, Set<number>>();
  for (let k = 0; k < acc.pulseT.length; k++) {
    const t = acc.pulseT[k]!;
    let set = byT.get(t);
    if (!set) byT.set(t, (set = new Set()));
    set.add(acc.pulsePixel[k]!);
  }
  const minSide = Math.max(2, Math.floor(BOX_MIN_W * W));
  const blobs: Blob[] = [];
  for (const [t, pixels] of byT) {
    if (pixels.size < minSide * minSide * 0.6) continue;
    for (const c of components(pixels, W)) {
      const w = c.x1 - c.x0 + 1;
      const h = c.y1 - c.y0 + 1;
      // La cuadrícula conserva la proporción del video: un cuadrado en pantalla mide lo mismo en x que en y.
      if (w < minSide || w > BOX_MAX_W * W || w / h < 0.6 || w / h > 1.6 || c.fill < 0.6) continue;
      blobs.push({ t, ...c });
    }
  }
  blobs.sort((a, b) => a.t - b.t);

  const groups: Blob[][] = [];
  for (const b of blobs) {
    const g = groups.find((g) => iou(g[0]!, b) >= 0.5);
    if (g) g.push(b);
    else groups.push([b]);
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  return groups.map((g) => {
    const x0 = median(g.map((b) => b.x0));
    const y0 = median(g.map((b) => b.y0));
    const x1 = median(g.map((b) => b.x1));
    const y1 = median(g.map((b) => b.y1));
    return {
      box: { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H },
      fill: g.reduce((a, b) => a + b.fill, 0) / g.length,
      flashes: g.map((b) => b.t),
    };
  });
}

// ---------------------------------------------------------------------------
// Emparejamiento de destellos con las filas sync del CSV
// ---------------------------------------------------------------------------

export interface FlashMatch {
  /** Por cada sync (en el orden recibido), el destello emparejado o null si falta en el video. */
  pairs: (number | null)[];
  matched: number;
  /** Destellos que no corresponden a ningún sync. */
  extra: number;
}

/**
 * Empareja los destellos del video con los sync del CSV: prueba cada par destello–sync como ancla
 * y busca, para cada sync, el destello más cercano a donde debería estar. La tolerancia crece con
 * la distancia al ancla para admitir la deriva de la transmisión. Así un destello que falta en el
 * video o uno de más no corren el resto del emparejamiento.
 */
export function matchFlashes(flashes: readonly number[], syncs: readonly number[], tol = 0.5): FlashMatch {
  const f = [...flashes].sort((a, b) => a - b);
  let best: { pairs: (number | null)[]; matched: number; err: number } = { pairs: syncs.map(() => null), matched: 0, err: 0 };
  for (const anchorF of f) {
    for (const anchorS of syncs) {
      const offset = anchorF - anchorS;
      const used = new Set<number>();
      const pairs: (number | null)[] = [];
      let matched = 0;
      let err = 0;
      for (const s of syncs) {
        const target = s + offset;
        const allowed = tol + 0.005 * Math.abs(s - anchorS);
        let pick = -1;
        for (let k = 0; k < f.length; k++) {
          if (used.has(k)) continue;
          const d = Math.abs(f[k]! - target);
          if (d <= allowed && (pick === -1 || d < Math.abs(f[pick]! - target))) pick = k;
        }
        if (pick === -1) pairs.push(null);
        else {
          used.add(pick);
          pairs.push(f[pick]!);
          matched++;
          err += Math.abs(f[pick]! - target);
        }
      }
      if (matched > best.matched || (matched === best.matched && err < best.err)) best = { pairs, matched, err };
    }
  }
  return { pairs: best.pairs, matched: best.matched, extra: f.length - best.matched };
}

/** Puntaje de una zona: destellos emparejados, menos la mitad de los que sobran. */
function regionScore(r: Region, syncs: readonly number[]): { score: number; match: FlashMatch } {
  const match = matchFlashes(r.flashes, syncs);
  return { score: match.matched - 0.5 * match.extra, match };
}

/**
 * La zona cuyos destellos mejor coinciden con los sync. Exige al menos dos emparejados
 * (o uno, si el CSV tiene un solo sync). Null si ninguna sirve.
 */
export function chooseRegion(regions: readonly Region[], syncs: readonly number[]): { region: Region; match: FlashMatch } | null {
  const need = Math.min(2, syncs.length);
  if (need === 0) return null;
  let best: { region: Region; match: FlashMatch; score: number } | null = null;
  for (const region of regions) {
    const { score, match } = regionScore(region, syncs);
    if (match.matched < need) continue;
    if (!best || score > best.score || (score === best.score && region.fill > best.region.fill)) {
      best = { region, match, score };
    }
  }
  return best && { region: best.region, match: best.match };
}

// ---------------------------------------------------------------------------
// Recuadro marcado a mano
// ---------------------------------------------------------------------------

/**
 * Zona blanca conectada alrededor de un toque (coordenadas relativas) en la máscara de un cuadro.
 * Si el toque no cae justo en blanco, se busca el píxel blanco más cercano en un radio del 3 % del ancho.
 * Null si no hay zona o su tamaño no es el de un destello.
 */
export function boxAround(mask: ArrayLike<number>, width: number, height: number, tx: number, ty: number): Box | null {
  const cx = Math.round(tx * (width - 1));
  const cy = Math.round(ty * (height - 1));
  const radius = Math.max(1, Math.round(width * 0.03));
  let seed = -1;
  let bestD = Infinity;
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (mask[y * width + x] && d < bestD) {
        bestD = d;
        seed = y * width + x;
      }
    }
  }
  if (seed === -1) return null;
  const seen = new Uint8Array(width * height);
  const stack = [seed];
  seen[seed] = 1;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % width;
    const y = (p - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    const near = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
    for (const q of near) {
      if (q >= 0 && !seen[q] && mask[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  const box = { x: x0 / width, y: y0 / height, w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height };
  return box.w >= BOX_MIN_W && box.w <= BOX_MAX_W ? box : null;
}

/** Recuadro válido leído de la configuración guardada; null si no sirve. */
export function sanitizeBox(raw: unknown): Box | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : NaN);
  const box = { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
  const ok = box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 1 && box.y + box.h <= 1;
  return ok ? box : null;
}
