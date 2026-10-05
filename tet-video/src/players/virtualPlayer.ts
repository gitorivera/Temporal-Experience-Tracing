// Reproductor de canvas 960×540 para la práctica y la grabación de ejemplo (SPEC §10).
import { clamp, Listeners, type Player } from './player';

export type DrawScene = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

export const VIRTUAL_WIDTH = 960;
export const VIRTUAL_HEIGHT = 540;

/** Dependencias del entorno, reemplazables en las pruebas. */
export interface VirtualEnv {
  canvas: HTMLCanvasElement;
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
}

function browserEnv(): VirtualEnv {
  const canvas = document.createElement('canvas');
  return {
    canvas,
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
  };
}

export class VirtualPlayer implements Player {
  readonly el: HTMLCanvasElement;
  readonly duration: number;

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly env: VirtualEnv;
  private readonly ended = new Listeners();
  private rate = 1;
  private isPaused = true;
  // El tiempo se calcula con el reloj: t = baseT + (ahora − baseWall) · velocidad.
  // Así currentTime es exacto en cualquier momento, no solo cuando corre el cuadro.
  private baseT = 0;
  private baseWall = 0;
  private frame: number | null = null;

  constructor(
    duration: number,
    private readonly draw: DrawScene,
    env: VirtualEnv = browserEnv(),
  ) {
    if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError(`Duración inválida: ${duration}`);
    this.duration = duration;
    this.env = env;
    this.el = env.canvas;
    this.el.width = VIRTUAL_WIDTH;
    this.el.height = VIRTUAL_HEIGHT;
    this.ctx = this.el.getContext('2d');
    this.render();
  }

  get currentTime(): number {
    if (this.isPaused) return this.baseT;
    const t = this.baseT + ((this.env.now() - this.baseWall) / 1000) * this.rate;
    return Math.min(t, this.duration);
  }

  set currentTime(t: number) {
    this.baseT = clamp(Number.isFinite(t) ? t : 0, 0, this.duration);
    this.baseWall = this.env.now();
    this.render();
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(r: number) {
    if (!(r > 0)) return;
    this.rebase();
    this.rate = r;
  }

  play(): Promise<void> {
    if (!this.isPaused) return Promise.resolve();
    // Igual que <video>: si terminó, play() vuelve a empezar desde 0.
    if (this.baseT >= this.duration) this.baseT = 0;
    this.baseWall = this.env.now();
    this.isPaused = false;
    this.schedule();
    return Promise.resolve();
  }

  pause(): void {
    if (this.isPaused) return;
    this.rebase();
    this.isPaused = true;
    this.unschedule();
    this.render();
  }

  onEnded(cb: () => void): () => void {
    return this.ended.add(cb);
  }

  destroy(): void {
    this.isPaused = true;
    this.unschedule();
    this.ended.clear();
  }

  /** Avanza un cuadro: dibuja y detecta el fin. Público para las pruebas. */
  tick(): void {
    this.frame = null;
    if (this.isPaused) return;
    const t = this.currentTime;
    if (t >= this.duration) {
      this.baseT = this.duration;
      this.isPaused = true;
      this.render();
      this.ended.emit();
      return;
    }
    this.render();
    this.schedule();
  }

  /** Fija el tiempo actual como nueva base del reloj. */
  private rebase(): void {
    this.baseT = this.currentTime;
    this.baseWall = this.env.now();
  }

  private schedule(): void {
    if (this.frame === null) this.frame = this.env.requestFrame(() => this.tick());
  }

  private unschedule(): void {
    if (this.frame !== null) this.env.cancelFrame(this.frame);
    this.frame = null;
  }

  private render(): void {
    if (this.ctx) this.draw(this.ctx, this.currentTime, this.el.width, this.el.height);
  }
}
