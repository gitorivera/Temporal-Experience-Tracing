// Recorrido del video en el navegador para detectar los destellos (SPEC §16.4) y visor cuadro a
// cuadro para revisarlos (§16.5). Usa un <video> propio, sin sonido, para no tocar el reproductor
// que verá el niño. El cálculo está en data/flash.ts.
import { findRuns, PulseAccumulator, whiteFraction, whiteMask, type Box, type FrameSample } from '../data/flash';
import { resolveDuration } from './videoPlayer';

/** Ancho del cuadro reducido con que se buscan los pulsos. */
export const SCAN_WIDTH = 240;
/** Velocidad del recorrido completo; a 4× el navegador se salta cuadros y por eso se refina después. */
const SCAN_RATE = 4;
/** Ventana y velocidad del refinamiento: a 0,5× el navegador entrega todos los cuadros. */
const REFINE_WINDOW_S = 0.5;
const REFINE_RATE = 0.5;
/** Lado del recorte del recuadro al medirlo. */
const BOX_SIDE = 32;
/** Duración de cuadro supuesta mientras no se haya medido una. */
export const DEFAULT_FRAME_S = 1 / 30;

/** Clave de un tiempo de cuadro (mediaTime) para el mapa de cuadros contiguos. */
const key = (t: number) => t.toFixed(5);

export class ScanCancelled extends Error {
  override name = 'ScanCancelled';
}

/**
 * Llama `cb` con el tiempo de cada cuadro presentado. Con `requestVideoFrameCallback` es el
 * `mediaTime` exacto del cuadro; sin él, `currentTime` en cada repintado (menos preciso).
 */
function onFrames(video: HTMLVideoElement, cb: (t: number) => void): () => void {
  let stopped = false;
  if (typeof video.requestVideoFrameCallback === 'function') {
    let id = 0;
    const step: VideoFrameRequestCallback = (_now, meta) => {
      if (stopped) return;
      cb(meta.mediaTime);
      id = video.requestVideoFrameCallback(step);
    };
    id = video.requestVideoFrameCallback(step);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback(id);
    };
  }
  let raf = 0;
  let last = -1;
  const tick = () => {
    if (stopped) return;
    if (video.currentTime !== last) {
      last = video.currentTime;
      cb(last);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

function once(target: EventTarget, type: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(type, done);
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      target.removeEventListener(type, done);
      reject(new ScanCancelled());
    };
    if (signal?.aborted) return reject(new ScanCancelled());
    target.addEventListener(type, done);
    signal?.addEventListener('abort', abort);
  });
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('El navegador no permite leer los cuadros del video.');
  return ctx;
}

export interface RefineResult {
  /** Tiempo del primer cuadro blanco; null si no se vio una racha cerca. */
  v: number | null;
  /** Mediana de la duración de los cuadros medidos. */
  frameS: number | null;
}

export class FlashVideo {
  readonly el: HTMLVideoElement;
  readonly duration: number;
  private readonly url: string;
  private readonly scanCanvas = document.createElement('canvas');
  private readonly boxCanvas = document.createElement('canvas');
  /**
   * Cuadro siguiente de cada cuadro, cuando se sabe que son contiguos (vistos seguidos en el
   * refinamiento o en un paso del visor): permite avanzar un cuadro sin tantear.
   */
  private readonly nextFrame = new Map<string, number>();

  private constructor(el: HTMLVideoElement, url: string, duration: number) {
    this.el = el;
    this.url = url;
    this.duration = duration;
    this.scanCanvas.width = SCAN_WIDTH;
    this.scanCanvas.height = Math.max(1, Math.round((SCAN_WIDTH * el.videoHeight) / Math.max(1, el.videoWidth)));
    this.boxCanvas.width = BOX_SIDE;
    this.boxCanvas.height = BOX_SIDE;
  }

  static async open(file: File): Promise<FlashVideo> {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    el.disablePictureInPicture = true;
    el.src = url;
    try {
      const duration = await resolveDuration(el);
      return new FlashVideo(el, url, duration);
    } catch (err) {
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  get scanHeight(): number {
    return this.scanCanvas.height;
  }

  /** Recorre todo el video a 4× y anota los pulsos de cada píxel del cuadro reducido. */
  async scan(onProgress: (fraction: number) => void, signal: AbortSignal): Promise<PulseAccumulator> {
    const { el } = this;
    const w = this.scanCanvas.width;
    const h = this.scanCanvas.height;
    const ctx = context(this.scanCanvas);
    const acc = new PulseAccumulator(w, h);
    const mask = new Uint8Array(w * h);

    el.pause();
    el.currentTime = 0;
    await once(el, 'seeked', signal);
    try {
      el.playbackRate = SCAN_RATE;
    } catch {
      // Si el navegador no admite 4×, se recorre a 1×: tarda más, pero funciona igual.
    }

    let lastT = -1;
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const stop = onFrames(el, (t) => {
      if (t <= lastT) return;
      lastT = t;
      ctx.drawImage(el, 0, 0, w, h);
      whiteMask(ctx.getImageData(0, 0, w, h).data, mask);
      acc.push(t, mask);
      onProgress(Math.min(1, t / this.duration));
      if (t >= this.duration - 0.05) finish();
    });
    el.addEventListener('ended', finish);
    const onAbort = () => finish();
    signal.addEventListener('abort', onAbort);
    try {
      await el.play();
      await finished;
    } finally {
      stop();
      el.pause();
      el.removeEventListener('ended', finish);
      signal.removeEventListener('abort', onAbort);
      el.playbackRate = 1;
    }
    if (signal.aborted) throw new ScanCancelled();
    onProgress(1);
    return acc;
  }

  /** Fracción de blanco en el interior del recuadro, en el cuadro que se muestra ahora. */
  measureBox(box: Box): number {
    const ctx = context(this.boxCanvas);
    const vw = this.el.videoWidth;
    const vh = this.el.videoHeight;
    ctx.drawImage(this.el, box.x * vw, box.y * vh, box.w * vw, box.h * vh, 0, 0, BOX_SIDE, BOX_SIDE);
    return whiteFraction(ctx.getImageData(0, 0, BOX_SIDE, BOX_SIDE).data, BOX_SIDE, BOX_SIDE);
  }

  /**
   * Busca el primer cuadro del destello cerca de `t`: reproduce a 0,5× desde t − 0,5 s hasta
   * t + 0,5 s midiendo el recuadro en cada cuadro.
   */
  async refine(t: number, box: Box, signal: AbortSignal): Promise<RefineResult> {
    const { el } = this;
    const from = Math.max(0, t - REFINE_WINDOW_S);
    const to = Math.min(this.duration, t + REFINE_WINDOW_S);
    el.pause();
    el.currentTime = from;
    await once(el, 'seeked', signal);
    el.playbackRate = REFINE_RATE;

    const samples: FrameSample[] = [];
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const stop = onFrames(el, (ft) => {
      if (samples.length > 0 && ft <= samples[samples.length - 1]!.t) return;
      samples.push({ t: ft, f: this.measureBox(box) });
      if (ft >= to) finish();
    });
    el.addEventListener('ended', finish);
    const onAbort = () => finish();
    signal.addEventListener('abort', onAbort);
    try {
      await el.play();
      await finished;
    } finally {
      stop();
      el.pause();
      el.removeEventListener('ended', finish);
      signal.removeEventListener('abort', onAbort);
      el.playbackRate = 1;
    }
    if (signal.aborted) throw new ScanCancelled();
    samples.forEach((smp, k) => {
      if (k > 0) this.nextFrame.set(key(samples[k - 1]!.t), smp.t);
    });

    const dts = samples.slice(1).map((s, k) => s.t - samples[k]!.t).sort((a, b) => a - b);
    const frameS = dts.length > 0 ? dts[Math.floor(dts.length / 2)]! : null;
    const near = findRuns(samples)
      .filter((r) => Math.abs(r.start - t) <= REFINE_WINDOW_S)
      .sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t));
    return { v: near[0]?.start ?? null, frameS };
  }

  /**
   * Salta a `t` en pausa y devuelve el tiempo (`mediaTime`) del cuadro que quedó a la vista.
   * Si no se presenta un cuadro nuevo (el salto cayó en el mismo cuadro), devuelve `unchanged`.
   * El aviso del cuadro se pide antes de saltar, porque puede llegar antes que `seeked`.
   */
  async showAt(t: number, unchanged?: number): Promise<number> {
    const { el } = this;
    el.pause();
    const rvfc = typeof el.requestVideoFrameCallback === 'function';
    let frameT: number | null = null;
    let id = 0;
    const presented = rvfc
      ? new Promise<void>((resolve) => {
          id = el.requestVideoFrameCallback((_now, meta) => {
            frameT = meta.mediaTime;
            resolve();
          });
        })
      : null;
    el.currentTime = Math.min(Math.max(0, t), this.duration);
    await once(el, 'seeked');
    if (!presented) return el.currentTime;
    await Promise.race([presented, new Promise((resolve) => setTimeout(resolve, 400))]);
    if (frameT === null) el.cancelVideoFrameCallback(id);
    return frameT ?? unchanged ?? el.currentTime;
  }

  /**
   * Un cuadro hacia atrás o adelante desde el cuadro a la vista (`shown`). Hacia atrás basta saltar
   * justo antes de él. Hacia adelante, si ya se conoce el cuadro siguiente se salta a él; si no, se
   * prueban pasos crecientes y finos, porque los cuadros no duran lo mismo (de 10 a 45 ms en la prueba).
   */
  async step(shown: number, dir: -1 | 1, frameS = DEFAULT_FRAME_S): Promise<number> {
    if (dir < 0) return this.showAt(Math.max(0, shown - 0.001), shown);
    const known = this.nextFrame.get(key(shown));
    if (known !== undefined) return this.showAt(known + 0.002, shown);
    for (const k of [0.35, 0.7, 1, 1.35, 1.7, 2.1, 2.6, 3.2, 4]) {
      const t = await this.showAt(shown + k * frameS, shown);
      if (t > shown + 1e-4) {
        this.nextFrame.set(key(shown), t);
        return t;
      }
    }
    return shown;
  }

  /** Máscara de blanco del cuadro a la vista, en la cuadrícula reducida (para marcar el recuadro). */
  grabMask(): { mask: Uint8Array; width: number; height: number } {
    const w = this.scanCanvas.width;
    const h = this.scanCanvas.height;
    const ctx = context(this.scanCanvas);
    ctx.drawImage(this.el, 0, 0, w, h);
    return { mask: whiteMask(ctx.getImageData(0, 0, w, h).data), width: w, height: h };
  }

  destroy(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.el.remove();
    URL.revokeObjectURL(this.url);
  }
}
