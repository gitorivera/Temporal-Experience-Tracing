// Reproductor recortado a la ventana de trazado (SPEC §16.8): envuelve otro reproductor y muestra
// solo el tramo [inicio, fin] del video, en tiempo local (0 = inicio). La pantalla de trazado no
// necesita saber del recorte: ve un video de duración fin − inicio.
import type { Ventana } from '../data/window';
import { clamp, Listeners, type Player } from './player';

/** Reloj de cuadros; se inyecta para poder probarlo sin navegador. */
export interface FrameClock {
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
}

const browserClock: FrameClock = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

export class WindowedPlayer implements Player {
  readonly el: Player['el'];
  readonly duration: number;
  readonly ventana: Ventana;

  private readonly ended = new Listeners();
  private readonly offInner: () => void;
  private frame: number | null = null;
  /** Ya se avisó el fin de esta reproducción (el del recorte o el del video, no los dos). */
  private endedSent = false;

  constructor(
    private readonly inner: Player,
    ventana: Ventana,
    private readonly clock: FrameClock = browserClock,
  ) {
    const inicioS = clamp(ventana.inicioS, 0, inner.duration);
    const finS = clamp(ventana.finS, inicioS, inner.duration);
    if (!(finS > inicioS)) throw new RangeError(`Ventana vacía: ${ventana.inicioS}–${ventana.finS}`);
    this.ventana = { inicioS, finS };
    this.el = inner.el;
    this.duration = finS - inicioS;
    this.offInner = inner.onEnded(() => this.sendEnded());
  }

  get currentTime(): number {
    return clamp(this.inner.currentTime - this.ventana.inicioS, 0, this.duration);
  }

  set currentTime(t: number) {
    this.inner.currentTime = this.ventana.inicioS + clamp(Number.isFinite(t) ? t : 0, 0, this.duration);
  }

  get paused(): boolean {
    return this.inner.paused;
  }

  get playbackRate(): number {
    return this.inner.playbackRate;
  }

  set playbackRate(r: number) {
    this.inner.playbackRate = r;
  }

  async play(): Promise<void> {
    // Como <video>: al final, play() vuelve a empezar desde el inicio (de la ventana).
    // Tampoco se reproduce nada de antes del inicio.
    const t = this.inner.currentTime;
    if (t < this.ventana.inicioS || t >= this.ventana.finS - 1e-3) this.currentTime = 0;
    this.endedSent = false;
    await this.inner.play();
    this.watch();
  }

  pause(): void {
    this.stopWatch();
    this.inner.pause();
  }

  onEnded(cb: () => void): () => void {
    return this.ended.add(cb);
  }

  destroy(): void {
    this.stopWatch();
    this.offInner();
    this.ended.clear();
    this.inner.destroy();
  }

  /** Vigila cada cuadro el final de la ventana: ahí pausa, deja el video en el fin y avisa. */
  private watch(): void {
    this.stopWatch();
    const tick = () => {
      this.frame = null;
      if (this.inner.paused) return;
      if (this.inner.currentTime >= this.ventana.finS) {
        this.inner.pause();
        this.inner.currentTime = this.ventana.finS;
        this.sendEnded();
        return;
      }
      this.frame = this.clock.requestFrame(tick);
    };
    this.frame = this.clock.requestFrame(tick);
  }

  private stopWatch(): void {
    if (this.frame !== null) this.clock.cancelFrame(this.frame);
    this.frame = null;
  }

  private sendEnded(): void {
    if (this.endedSent) return;
    this.endedSent = true;
    this.stopWatch();
    this.ended.emit();
  }
}
