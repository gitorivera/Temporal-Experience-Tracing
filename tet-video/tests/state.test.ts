import { describe, expect, it } from 'vitest';
import { configPorDefecto, DIMENSIONES_POR_DEFECTO } from '../src/state';

describe('configuración por defecto (SPEC §6)', () => {
  it('usa los valores de la tabla de configuración', () => {
    const c = configPorDefecto();
    expect(c).toMatchObject({
      participante: '',
      condicion: 'RM',
      modo: 'trazo',
      velocidad: 1,
      ordenAleatorio: true,
      practica: true,
      syncVideoS: 0,
      resolucionS: 1,
    });
  });

  it('incluye las cuatro dimensiones por defecto en orden', () => {
    expect(configPorDefecto().dimensiones.map((d) => d.nombre)).toEqual([
      'Diversión',
      'Esfuerzo',
      'Aburrimiento',
      'Pensar en otra cosa',
    ]);
  });

  it('devuelve copias independientes de las dimensiones', () => {
    const c = configPorDefecto();
    c.dimensiones[0]!.nombre = 'Otra';
    expect(DIMENSIONES_POR_DEFECTO[0]!.nombre).toBe('Diversión');
  });
});
