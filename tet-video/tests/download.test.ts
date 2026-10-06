import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareErrorMessage, shareableFiles, shareFiles } from '../src/data/download';
import type { OutputFile } from '../src/data/export';

const f = (kind: OutputFile['kind'], name: string): OutputFile => ({ kind, name, mime: 'text/csv;charset=utf-8', content: '' });

describe('Compartir (SPEC §9)', () => {
  it('solo se comparten los CSV: Chrome no permite compartir .json', () => {
    const files = [f('ventanas', 'a_ventanas.csv'), f('hz10', 'a_10hz.csv'), f('toques', 'a_toques.csv'), f('json', 'a.json')];
    expect(shareableFiles(files).map((x) => x.kind)).toEqual(['ventanas', 'hz10', 'toques']);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const named = (name: string) => Object.assign(new Error(name), { name });

  it('no lanza un segundo envío mientras el primero sigue abierto', async () => {
    let finish!: () => void;
    const share = vi.fn(() => new Promise<void>((r) => (finish = r)));
    vi.stubGlobal('navigator', { share });
    const csv = [f('hz10', 'a_10hz.csv')];
    const first = shareFiles(csv, 'a');
    expect(await shareFiles(csv, 'a')).toBe('ocupado');
    expect(share).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBe('compartido');
    // Terminado el primero, se puede volver a compartir.
    share.mockImplementationOnce(() => Promise.reject(named('AbortError')));
    expect(await shareFiles(csv, 'a')).toBe('cancelado');
  });

  it('InvalidStateError del navegador se trata como «ocupado»; otros errores se propagan', async () => {
    vi.stubGlobal('navigator', { share: () => Promise.reject(named('InvalidStateError')) });
    expect(await shareFiles([f('hz10', 'a.csv')], 'a')).toBe('ocupado');
    vi.stubGlobal('navigator', { share: () => Promise.reject(named('NotAllowedError')) });
    await expect(shareFiles([f('hz10', 'a.csv')], 'a')).rejects.toThrow('NotAllowedError');
  });

  it('el aviso de error incluye el motivo técnico', () => {
    const err = new Error('Permission denied');
    err.name = 'NotAllowedError';
    expect(shareErrorMessage(err)).toBe(
      'Este navegador no permitió compartir los archivos (NotAllowedError: Permission denied). Usa los botones de descarga.',
    );
    expect(shareErrorMessage('x')).toBe('Este navegador no permitió compartir los archivos. Usa los botones de descarga.');
  });
});
