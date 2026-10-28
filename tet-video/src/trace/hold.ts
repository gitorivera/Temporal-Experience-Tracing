// Modo botones: mientras se mantiene pulsado ▲ o ▼ (en pantalla o las flechas del teclado),
// el valor sube o baja a velocidad constante; al soltar se queda donde está. Sin DOM.

/** Cambio de valor por segundo con un botón pulsado: de abajo a arriba en 2 s. */
export const HOLD_RATE = 0.5;
/** Paso de tiempo máximo entre cuadros: tras un tirón, la línea no salta de golpe. */
export const HOLD_MAX_DT = 0.1;

export type HoldDir = -1 | 0 | 1;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Valor tras `dtS` segundos con la dirección `dir` pulsada. */
export function holdStep(v: number, dir: HoldDir, dtS: number, rate = HOLD_RATE): number {
  if (dir === 0 || !(dtS > 0)) return v;
  return clamp01(v + dir * rate * Math.min(dtS, HOLD_MAX_DT));
}

/**
 * Qué está pulsado ahora. Cada fuente (un dedo, el mouse, una tecla) se registra por separado,
 * para que soltar una no suelte la otra. Con ▲ y ▼ pulsados a la vez, el valor no se mueve.
 */
export class HoldInput {
  private readonly held = new Map<string, 1 | -1>();

  /** Registra una pulsación; true si esa fuente no estaba ya pulsada (cuenta como un toque). */
  press(source: string, dir: 1 | -1): boolean {
    const nueva = !this.held.has(source);
    this.held.set(source, dir);
    return nueva;
  }

  release(source: string): void {
    this.held.delete(source);
  }

  releaseAll(): void {
    this.held.clear();
  }

  isPressed(dir: 1 | -1): boolean {
    for (const d of this.held.values()) if (d === dir) return true;
    return false;
  }

  get direction(): HoldDir {
    const up = this.isPressed(1);
    const down = this.isPressed(-1);
    return up === down ? 0 : up ? 1 : -1;
  }
}
