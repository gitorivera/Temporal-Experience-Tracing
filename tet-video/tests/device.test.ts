import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenAwake } from '../src/device';

/** document y navigator mínimos para probar el wake lock sin navegador. */
function fakeEnv(withWakeLock = true) {
  const listeners = new Map<string, () => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t: string, fn: () => void) => listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
  };
  const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
  const request = vi.fn(async () => {
    const s = { released: false, release: async () => void (s.released = true) };
    sentinels.push(s);
    return s;
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', withWakeLock ? { wakeLock: { request } } : {});
  return {
    request,
    sentinels,
    /** El navegador suelta el bloqueo al ocultarse la página y luego vuelve a mostrarla. */
    hideAndShow() {
      for (const s of sentinels) s.released = true;
      doc.visibilityState = 'visible';
      listeners.get('visibilitychange')?.();
    },
    listening: () => listeners.has('visibilitychange'),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ScreenAwake (SPEC §7.9)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pide el bloqueo al empezar y lo vuelve a pedir al regresar de segundo plano', async () => {
    const env = fakeEnv();
    const a = new ScreenAwake();
    a.start();
    await flush();
    expect(env.request).toHaveBeenCalledTimes(1);
    env.hideAndShow();
    await flush();
    expect(env.request).toHaveBeenCalledTimes(2);
  });

  it('no pide otro mientras el actual sigue activo', async () => {
    const env = fakeEnv();
    const a = new ScreenAwake();
    a.start();
    await flush();
    env.hideAndShow(); // libera y vuelve
    await flush();
    // Un evento de visibilidad sin haber perdido el bloqueo no pide otro.
    a.start();
    await flush();
    expect(env.request).toHaveBeenCalledTimes(2);
  });

  it('al terminar suelta el bloqueo y deja de escuchar', async () => {
    const env = fakeEnv();
    const a = new ScreenAwake();
    a.start();
    await flush();
    a.stop();
    await flush();
    expect(env.sentinels[0]!.released).toBe(true);
    expect(env.listening()).toBe(false);
  });

  it('sin Wake Lock en el navegador no falla', async () => {
    fakeEnv(false);
    const a = new ScreenAwake();
    expect(() => a.start()).not.toThrow();
    await flush();
    a.stop();
  });
});
