import { describe, expect, it, vi } from 'vitest';
import { VirtualPlayer, type VirtualEnv } from '../src/players/virtualPlayer';
import { resolveDuration, VideoLoadError, VideoPlayer } from '../src/players/videoPlayer';
import { createDemoPlayer, createPracticePlayer, DEMO_EVENTS, drawDemo, drawPractice, formatTime } from '../src/players/scenes';

// ---------------------------------------------------------------------------
// Entorno falso para VirtualPlayer: reloj y cuadros controlados a mano.
// ---------------------------------------------------------------------------

function fakeEnv(ctx: object = {}) {
  let now = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  const draws: number[] = [];
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const env: VirtualEnv = {
    canvas,
    now: () => now,
    requestFrame: (cb) => {
      frames.set(next, cb);
      return next++;
    },
    cancelFrame: (id) => frames.delete(id),
  };
  return {
    env,
    draws,
    pendingFrames: () => frames.size,
    /** Avanza el reloj `ms` y ejecuta los cuadros pendientes. */
    advance(ms: number) {
      now += ms;
      const cbs = [...frames.values()];
      frames.clear();
      cbs.forEach((cb) => cb());
    },
  };
}

function virtual(duration = 10) {
  const f = fakeEnv();
  const p = new VirtualPlayer(duration, (_ctx, t) => f.draws.push(t), f.env);
  return { p, f };
}

describe('VirtualPlayer', () => {
  it('tiene canvas de 960×540, empieza en pausa en 0 y dibuja el primer cuadro', () => {
    const { p, f } = virtual();
    expect([p.el.width, p.el.height]).toEqual([960, 540]);
    expect(p.paused).toBe(true);
    expect(p.currentTime).toBe(0);
    expect(f.draws).toEqual([0]);
  });

  it('avanza con el reloj y currentTime es exacto entre cuadros', () => {
    const { p, f } = virtual();
    p.play();
    f.advance(1500);
    expect(p.currentTime).toBeCloseTo(1.5);
    expect(f.draws.at(-1)).toBeCloseTo(1.5);
  });

  it('respeta la velocidad de reproducción, también si cambia mientras reproduce', () => {
    const { p, f } = virtual();
    p.playbackRate = 2;
    p.play();
    f.advance(1000);
    expect(p.currentTime).toBeCloseTo(2);
    p.playbackRate = 1.5;
    f.advance(1000);
    expect(p.currentTime).toBeCloseTo(3.5);
  });

  it('ignora velocidades no positivas', () => {
    const { p } = virtual();
    p.playbackRate = 0;
    p.playbackRate = -1;
    expect(p.playbackRate).toBe(1);
  });

  it('en pausa el tiempo no avanza y no quedan cuadros pendientes', () => {
    const { p, f } = virtual();
    p.play();
    f.advance(1000);
    p.pause();
    f.advance(5000);
    expect(p.currentTime).toBeCloseTo(1);
    expect(p.paused).toBe(true);
    expect(f.pendingFrames()).toBe(0);
  });

  it('saltar recorta a [0, duración] y redibuja', () => {
    const { p, f } = virtual(10);
    p.currentTime = 4.2;
    expect(p.currentTime).toBe(4.2);
    expect(f.draws.at(-1)).toBe(4.2);
    p.currentTime = 99;
    expect(p.currentTime).toBe(10);
    p.currentTime = -3;
    expect(p.currentTime).toBe(0);
    p.currentTime = NaN;
    expect(p.currentTime).toBe(0);
  });

  it('saltar mientras reproduce continúa desde el nuevo punto', () => {
    const { p, f } = virtual();
    p.play();
    f.advance(1000);
    p.currentTime = 5;
    f.advance(500);
    expect(p.currentTime).toBeCloseTo(5.5);
  });

  it('al llegar al final se detiene en la duración y avisa una sola vez', () => {
    const { p, f } = virtual(2);
    const ended = vi.fn();
    p.onEnded(ended);
    p.play();
    f.advance(1000);
    f.advance(1500);
    f.advance(1000);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.paused).toBe(true);
    expect(p.currentTime).toBe(2);
    expect(f.draws.at(-1)).toBe(2);
  });

  it('play() al final vuelve a empezar desde 0, como <video>', () => {
    const { p, f } = virtual(1);
    p.play();
    f.advance(2000);
    p.play();
    expect(p.currentTime).toBe(0);
    f.advance(300);
    expect(p.currentTime).toBeCloseTo(0.3);
  });

  it('cancelar la suscripción y destroy dejan de avisar el fin', () => {
    const { p, f } = virtual(1);
    const a = vi.fn();
    const b = vi.fn();
    const offA = p.onEnded(a);
    p.onEnded(b);
    offA();
    p.play();
    f.advance(2000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    p.play();
    p.destroy();
    f.advance(2000);
    expect(b).toHaveBeenCalledTimes(1);
    expect(f.pendingFrames()).toBe(0);
  });

  it('rechaza duraciones inválidas', () => {
    expect(() => new VirtualPlayer(0, () => {}, fakeEnv().env)).toThrow();
    expect(() => new VirtualPlayer(Infinity, () => {}, fakeEnv().env)).toThrow();
  });

  it('las fábricas crean la práctica de 40 s y el ejemplo de 120 s', () => {
    expect(createPracticePlayer(fakeEnv(recordingCtx().ctx).env).duration).toBe(40);
    expect(createDemoPlayer(fakeEnv(recordingCtx().ctx).env).duration).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// <video> falso: registra los saltos y dispara los eventos a mano.
// ---------------------------------------------------------------------------

class FakeVideo extends EventTarget {
  duration = NaN;
  readyState = 0;
  paused = true;
  playbackRate = 1;
  seeks: { t: number; fast: boolean }[] = [];
  fastSeek: ((t: number) => void) | undefined = (t) => this.seekTo(t, true);
  playResult: Promise<void> = Promise.resolve();
  private time = 0;
  get currentTime() {
    return this.time;
  }
  set currentTime(t: number) {
    this.seekTo(t, false);
  }
  private seekTo(t: number, fast: boolean) {
    this.time = t;
    this.seeks.push({ t, fast });
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
  play() {
    this.paused = false;
    return this.playResult;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
  load() {}
}

const asVideo = (v: FakeVideo) => v as unknown as HTMLVideoElement;

describe('resolveDuration', () => {
  it('devuelve la duración cuando llegan los metadatos', async () => {
    const v = new FakeVideo();
    const p = resolveDuration(asVideo(v));
    v.duration = 125.4;
    v.fire('loadedmetadata');
    await expect(p).resolves.toBe(125.4);
  });

  it('funciona si los metadatos ya estaban cargados', async () => {
    const v = new FakeVideo();
    v.duration = 30;
    v.readyState = 1;
    await expect(resolveDuration(asVideo(v))).resolves.toBe(30);
  });

  it('WebM con duración Infinity: salta a 1e101, espera durationchange y vuelve a 0', async () => {
    const v = new FakeVideo();
    const p = resolveDuration(asVideo(v));
    v.duration = Infinity;
    v.fire('loadedmetadata');
    expect(v.seeks).toEqual([{ t: 1e101, fast: false }]);
    v.fire('durationchange'); // todavía Infinity: se ignora
    v.duration = 61.7;
    v.fire('durationchange');
    v.fire('durationchange'); // repetido: no vuelve a saltar
    expect(v.seeks.map((s) => s.t)).toEqual([1e101, 0]);
    let settled = false;
    p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // espera a que termine el salto a 0
    v.fire('seeked');
    await expect(p).resolves.toBe(61.7);
  });

  it('rechaza con un mensaje claro si el video no se puede leer', async () => {
    const v = new FakeVideo();
    const p = resolveDuration(asVideo(v));
    v.fire('error');
    await expect(p).rejects.toThrow(VideoLoadError);
    await expect(p).rejects.toThrow(/MP4/);
  });

  it('rechaza si los metadatos no llegan a tiempo', async () => {
    vi.useFakeTimers();
    const p = resolveDuration(asVideo(new FakeVideo()), 1000);
    const check = expect(p).rejects.toThrow(VideoLoadError);
    vi.advanceTimersByTime(1001);
    await check;
    vi.useRealTimers();
  });

  it('rechaza un video de duración 0', async () => {
    const v = new FakeVideo();
    const p = resolveDuration(asVideo(v));
    v.duration = 0;
    v.fire('loadedmetadata');
    await expect(p).rejects.toThrow(/vacío/);
  });
});

describe('VideoPlayer', () => {
  const make = (duration = 60) => {
    const v = new FakeVideo();
    v.duration = duration;
    const onDestroy = vi.fn();
    return { v, p: new VideoPlayer(asVideo(v), duration, onDestroy), onDestroy };
  };

  it('no encadena saltos: guarda el último pedido y lo aplica en seeked', () => {
    const { v, p } = make();
    p.currentTime = 10;
    p.currentTime = 20;
    p.currentTime = 30;
    expect(v.seeks.map((s) => s.t)).toEqual([10]);
    expect(p.currentTime).toBe(30); // refleja el último pedido
    v.fire('seeked');
    expect(v.seeks.map((s) => s.t)).toEqual([10, 30]);
    v.fire('seeked');
    p.currentTime = 40;
    expect(v.seeks.map((s) => s.t)).toEqual([10, 30, 40]);
  });

  it('usa fastSeek en pausa y currentTime al reproducir', () => {
    const { v, p } = make();
    p.currentTime = 5;
    v.fire('seeked');
    v.paused = false;
    p.currentTime = 6;
    expect(v.seeks).toEqual([
      { t: 5, fast: true },
      { t: 6, fast: false },
    ]);
  });

  it('sin fastSeek usa currentTime', () => {
    const { v, p } = make();
    v.fastSeek = undefined;
    p.currentTime = 5;
    expect(v.seeks).toEqual([{ t: 5, fast: false }]);
  });

  it('recorta los saltos a [0, duración]', () => {
    const { v, p } = make(60);
    p.currentTime = 100;
    v.fire('seeked');
    p.currentTime = -5;
    expect(v.seeks.map((s) => s.t)).toEqual([60, 0]);
  });

  it('si un salto nunca termina, a los 2 s permite el siguiente', () => {
    vi.useFakeTimers();
    const { v, p } = make();
    p.currentTime = 10;
    vi.advanceTimersByTime(2500);
    p.currentTime = 20;
    expect(v.seeks.map((s) => s.t)).toEqual([10, 20]);
    vi.useRealTimers();
  });

  it('avisa el fin con el evento ended', () => {
    const { v, p } = make();
    const ended = vi.fn();
    p.onEnded(ended);
    v.fire('ended');
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('play() ignora AbortError pero propaga el bloqueo de autoplay', async () => {
    const { v, p } = make();
    v.playResult = Promise.reject(Object.assign(new Error('pausado'), { name: 'AbortError' }));
    await expect(p.play()).resolves.toBeUndefined();
    v.playResult = Promise.reject(Object.assign(new Error('sin gesto'), { name: 'NotAllowedError' }));
    await expect(p.play()).rejects.toThrow('sin gesto');
  });

  it('pasa la velocidad al video', () => {
    const { v, p } = make();
    p.playbackRate = 1.5;
    expect(v.playbackRate).toBe(1.5);
    p.playbackRate = 0;
    expect(p.playbackRate).toBe(1.5);
  });

  it('destroy pausa, deja de escuchar y libera el archivo', () => {
    const { v, p, onDestroy } = make();
    const ended = vi.fn();
    p.onEnded(ended);
    v.paused = false;
    p.destroy();
    v.fire('ended');
    expect(v.paused).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    expect(onDestroy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Escenas: se dibujan sin fallar y muestran el texto del evento durante 2 s.
// ---------------------------------------------------------------------------

function recordingCtx() {
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'fillText' ? (s: string) => texts.push(s) : () => {}),
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe('escenas', () => {
  it('la práctica se dibuja en todo su rango', () => {
    const { ctx, texts } = recordingCtx();
    for (let t = 0; t <= 40; t += 0.5) drawPractice(ctx, t, 960, 540);
    expect(texts.at(-1)).toBe('Práctica · 0:40');
  });

  it('el ejemplo muestra el texto del evento durante 2 s', () => {
    const first = DEMO_EVENTS[0]!;
    const at = (t: number) => {
      const { ctx, texts } = recordingCtx();
      drawDemo(ctx, t, 960, 540);
      return texts;
    };
    expect(at(first.t - 0.1)).not.toContain(`${first.icon} ${first.label}`);
    expect(at(first.t)).toContain(`${first.icon} ${first.label}`);
    expect(at(first.t + 1.9)).toContain(`${first.icon} ${first.label}`);
    expect(at(first.t + 2)).not.toContain(`${first.icon} ${first.label}`);
  });

  it('los eventos del ejemplo caben en los 120 s e incluyen inicio, aciertos, errores, premio y fin', () => {
    expect(DEMO_EVENTS.every((e) => e.t >= 0 && e.t <= 120)).toBe(true);
    const labels = DEMO_EVENTS.map((e) => e.label).join(' ');
    for (const w of ['inicio', 'acierto', 'error', 'premio', 'fin']) expect(labels).toContain(w);
  });

  it('formatTime da m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});
