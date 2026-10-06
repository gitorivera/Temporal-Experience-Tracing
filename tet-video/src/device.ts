// Pantalla y dispositivo durante la sesión (SPEC §7.9): pantalla completa, orientación
// horizontal y Screen Wake Lock. Todo es opcional: si el navegador no lo permite, se sigue sin ello.

/**
 * Pide pantalla completa y bloquea la orientación en horizontal.
 * Llamar desde un gesto del usuario (el botón «Comenzar sesión»): sin gesto, el navegador lo rechaza.
 * En Android, el bloqueo de orientación solo funciona en pantalla completa, por eso va después.
 */
export async function enterSessionMode(): Promise<void> {
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    // Sin pantalla completa (p. ej. Safari en iPhone): la sesión sigue igual.
  }
  try {
    // `lock` no está en todos los tipos de TypeScript ni en todos los navegadores.
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (typeof o?.lock === 'function') await o.lock('landscape');
  } catch {
    // Escritorio o navegador sin bloqueo de orientación.
  }
}

/** Sale de la pantalla completa y libera la orientación (al volver a la configuración). */
export function exitSessionMode(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Nada que liberar.
  }
  if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    document.exitFullscreen().catch(() => {});
  }
}

/**
 * Mantiene la pantalla encendida mientras esté activo. El navegador suelta el bloqueo al pasar
 * a segundo plano; se vuelve a pedir al regresar (SPEC §7.9).
 */
export class ScreenAwake {
  private sentinel: WakeLockSentinel | null = null;
  private active = false;
  private readonly onVisibility = () => {
    if (this.active && document.visibilityState === 'visible') void this.request();
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.request();
  }

  stop(): void {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    s?.release().catch(() => {});
  }

  private async request(): Promise<void> {
    if (!('wakeLock' in navigator) || (this.sentinel && !this.sentinel.released)) return;
    try {
      const s = await navigator.wakeLock.request('screen');
      if (!this.active) {
        void s.release();
        return;
      }
      this.sentinel = s;
    } catch {
      // Batería baja, permisos o navegador sin Wake Lock: la sesión sigue igual.
    }
  }
}
