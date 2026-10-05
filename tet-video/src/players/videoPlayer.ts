// Envoltorio de <video> (SPEC §10) con los casos límite de §13:
// duración infinita de WebM, saltos rápidos encadenados y autoplay solo desde un gesto.
import { clamp, Listeners, type Player } from './player';

export class VideoLoadError extends Error {
  override name = 'VideoLoadError';
}

const UNREADABLE = 'No se pudo leer este video. Prueba con MP4 (H.264) o WebM.';

/** Si un salto no termina en este tiempo, se da por perdido y se permite el siguiente. */
const STALE_SEEK_MS = 2000;

/**
 * Espera los metadatos y devuelve una duración finita.
 * Los WebM de MediaRecorder reportan duración Infinity: se fuerza el cálculo saltando a 1e101,
 * se espera `durationchange` con un valor finito y se vuelve a 0.
 */
export function resolveDuration(video: HTMLVideoElement, timeoutMs = 15000): Promise<number> {
  return new Promise((resolve, reject) => {
    const off: (() => void)[] = [];
    const on = (type: string, fn: () => void) => {
      video.addEventListener(type, fn);
      off.push(() => video.removeEventListener(type, fn));
    };
    const timer = setTimeout(() => fail(UNREADABLE), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      off.forEach((f) => f());
    };
    const fail = (msg: string) => {
      done();
      reject(new VideoLoadError(msg));
    };
    const finite = () => Number.isFinite(video.duration) && video.duration > 0;

    const onMetadata = () => {
      if (finite()) {
        done();
        resolve(video.duration);
        return;
      }
      if (video.duration === 0) return fail('El video está vacío (duración 0).');
      let found = false;
      on('durationchange', () => {
        if (found || !finite()) return;
        found = true;
        const d = video.duration;
        on('seeked', () => {
          done();
          resolve(d);
        });
        video.currentTime = 0;
      });
      video.currentTime = 1e101;
    };

    on('error', () => fail(UNREADABLE));
    // HAVE_METADATA = 1: los metadatos pueden haber llegado antes de suscribirse.
    if (video.readyState >= 1) onMetadata();
    else on('loadedmetadata', onMetadata);
  });
}

function createVideoElement(): HTMLVideoElement {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.controls = false;
  v.disablePictureInPicture = true;
  return v;
}

/** Carga un archivo de video y devuelve el reproductor listo, o rechaza con VideoLoadError. */
export async function loadVideo(file: File, timeoutMs?: number): Promise<VideoPlayer> {
  const url = URL.createObjectURL(file);
  const video = createVideoElement();
  video.src = url;
  try {
    const duration = await resolveDuration(video, timeoutMs);
    return new VideoPlayer(video, duration, () => URL.revokeObjectURL(url));
  } catch (err) {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    throw err;
  }
}

export class VideoPlayer implements Player {
  readonly el: HTMLVideoElement;
  readonly duration: number;

  private readonly ended = new Listeners();
  private readonly off: (() => void)[] = [];
  /** Hay un salto en curso (entre asignar currentTime y `seeked`). */
  private seeking = false;
  private seekStartedAt = 0;
  /** Último salto pedido mientras había otro en curso; se aplica en `seeked`. */
  private pendingSeek: number | null = null;

  constructor(
    video: HTMLVideoElement,
    duration: number,
    private readonly onDestroy: () => void = () => {},
  ) {
    this.el = video;
    this.duration = duration;
    this.listen('ended', () => this.ended.emit());
    this.listen('seeked', () => {
      this.seeking = false;
      if (this.pendingSeek !== null) {
        const t = this.pendingSeek;
        this.pendingSeek = null;
        this.startSeek(t);
      }
    });
    this.listen('error', () => {
      this.seeking = false;
      this.pendingSeek = null;
    });
  }

  get currentTime(): number {
    return this.pendingSeek ?? clamp(this.el.currentTime, 0, this.duration);
  }

  set currentTime(t: number) {
    t = clamp(Number.isFinite(t) ? t : 0, 0, this.duration);
    if (this.seeking && Date.now() - this.seekStartedAt < STALE_SEEK_MS) {
      // No encadenar saltos: guardar solo el último pedido.
      this.pendingSeek = t;
      return;
    }
    this.pendingSeek = null;
    this.startSeek(t);
  }

  get paused(): boolean {
    return this.el.paused;
  }

  get playbackRate(): number {
    return this.el.playbackRate;
  }

  set playbackRate(r: number) {
    if (r > 0) this.el.playbackRate = r;
  }

  async play(): Promise<void> {
    try {
      await this.el.play();
    } catch (err) {
      // AbortError: una pausa interrumpió el play(); no es un fallo.
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    }
  }

  pause(): void {
    this.el.pause();
  }

  onEnded(cb: () => void): () => void {
    return this.ended.add(cb);
  }

  destroy(): void {
    this.el.pause();
    this.off.forEach((f) => f());
    this.ended.clear();
    this.el.removeAttribute('src');
    this.el.load();
    this.onDestroy();
  }

  private startSeek(t: number): void {
    this.seeking = true;
    this.seekStartedAt = Date.now();
    // fastSeek (salto al cuadro clave más cercano) solo en pausa: es más rápido al arrastrar la línea de tiempo.
    if (this.el.paused && typeof this.el.fastSeek === 'function') this.el.fastSeek(t);
    else this.el.currentTime = t;
  }

  private listen(type: string, fn: () => void): void {
    this.el.addEventListener(type, fn);
    this.off.push(() => this.el.removeEventListener(type, fn));
  }
}
