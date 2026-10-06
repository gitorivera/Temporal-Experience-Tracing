// Descarga y envío de los archivos de salida (SPEC §9): Blob con enlace `download`
// y, si el navegador lo permite, «Compartir» con navigator.share (correo, Drive).
import type { OutputFile } from './export';

function toBlob(f: OutputFile): Blob {
  return new Blob([f.content], { type: f.mime });
}

/** Descarga uno de los archivos de salida. */
export function downloadFile(f: OutputFile): void {
  downloadBlob(toBlob(f), f.name);
}

/** Descarga un Blob con un enlace temporal. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revocar después: algunos navegadores leen la URL de forma asíncrona.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Chrome (y los navegadores basados en él) solo comparte ciertos tipos de archivo: los CSV sí,
 * los .json no; y el envío es todo o nada. Por eso «Compartir» envía solo los CSV, con el tipo
 * MIME sin parámetros (`;charset=utf-8` puede hacer que no se reconozca).
 */
export function shareableFiles(files: readonly OutputFile[]): OutputFile[] {
  return files.filter((f) => f.name.toLowerCase().endsWith('.csv'));
}

function toFiles(files: readonly OutputFile[]): File[] {
  return files.map((f) => new File([f.content], f.name, { type: f.mime.split(';')[0]!.trim() }));
}

/** true si el navegador dice poder compartir estos archivos. */
export function canShareFiles(files: readonly OutputFile[]): boolean {
  if (files.length === 0) return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: toFiles(files) });
  } catch {
    return false;
  }
}

/** `compartido`; `cancelado`: el usuario cerró el menú; `ocupado`: ya hay un envío abierto. */
export type ShareResult = 'compartido' | 'cancelado' | 'ocupado';

/** El navegador admite un solo envío a la vez; uno nuevo antes de terminar da InvalidStateError. */
let sharing = false;

/** Abre el menú de compartir, salvo que ya haya uno abierto. */
export async function shareFiles(files: readonly OutputFile[], title: string): Promise<ShareResult> {
  if (sharing) return 'ocupado';
  sharing = true;
  try {
    await navigator.share({ files: toFiles(files), title });
    return 'compartido';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelado';
    // Un envío abierto desde otra pestaña o que el navegador aún no da por terminado.
    if (err instanceof Error && err.name === 'InvalidStateError') return 'ocupado';
    throw err;
  } finally {
    sharing = false;
  }
}

export const SHARE_BUSY_MESSAGE =
  'Ya hay un menú de compartir abierto (puede estar detrás de la ventana). Termínalo o ciérralo y vuelve a intentar.';

/** Mensaje para cuando el navegador rechaza el envío, con el motivo técnico para diagnosticar. */
export function shareErrorMessage(err: unknown): string {
  const why = err instanceof Error ? ` (${err.name}${err.message ? `: ${err.message}` : ''})` : '';
  return `Este navegador no permitió compartir los archivos${why}. Usa los botones de descarga.`;
}
