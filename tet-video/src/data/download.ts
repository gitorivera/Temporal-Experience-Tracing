// Descarga y envío de los archivos de salida (SPEC §9): Blob con enlace `download`
// y, si el navegador lo permite, «Compartir» con navigator.share (correo, Drive).
import type { OutputFile } from './export';

function toBlob(f: OutputFile): Blob {
  return new Blob([f.content], { type: f.mime });
}

/** Descarga un archivo con un enlace temporal. */
export function downloadFile(f: OutputFile): void {
  const url = URL.createObjectURL(toBlob(f));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revocar después: algunos navegadores leen la URL de forma asíncrona.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function toFiles(files: readonly OutputFile[]): File[] {
  return files.map((f) => new File([f.content], f.name, { type: f.mime }));
}

/** true si el navegador puede compartir estos archivos (Android con Chrome, por lo general). */
export function canShareFiles(files: readonly OutputFile[]): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: toFiles(files) });
  } catch {
    return false;
  }
}

/** Abre el menú de compartir. Devuelve false si el usuario lo cerró sin compartir. */
export async function shareFiles(files: readonly OutputFile[], title: string): Promise<boolean> {
  try {
    await navigator.share({ files: toFiles(files), title });
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return false;
    throw err;
  }
}
