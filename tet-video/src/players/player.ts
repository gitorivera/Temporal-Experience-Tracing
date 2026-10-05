// Interfaz común de reproductores (SPEC §10): la pantalla de trazado no distingue
// entre el video de la partida y las escenas dibujadas en canvas.

export interface Player {
  /** Elemento que se inserta en la pantalla. */
  readonly el: HTMLVideoElement | HTMLCanvasElement;
  /** Tiempo actual en segundos; al asignarlo se salta a ese punto (recortado a [0, duración]). */
  currentTime: number;
  /** Duración finita en segundos. */
  readonly duration: number;
  readonly paused: boolean;
  playbackRate: number;
  /** Reproduce. Llamar solo desde un gesto del usuario (botón «Empezar»). Rechaza si el navegador lo impide. */
  play(): Promise<void>;
  pause(): void;
  /** Suscribe al fin de la reproducción; devuelve la función para cancelar la suscripción. */
  onEnded(cb: () => void): () => void;
  /** Libera recursos (URL del video, animación). */
  destroy(): void;
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Lista mínima de oyentes para el evento de fin. */
export class Listeners {
  private set = new Set<() => void>();
  add(cb: () => void): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(): void {
    for (const cb of [...this.set]) cb();
  }
  clear(): void {
    this.set.clear();
  }
}
