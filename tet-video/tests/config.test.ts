import { describe, expect, it } from 'vitest';
import {
  dimensionOrder,
  isCompleteDimension,
  loadSavedConfig,
  roundSync,
  sanitizeConfig,
  saveConfig,
  shuffled,
  validateConfig,
  type KeyValueStore,
} from '../src/config';
import { configPorDefecto, type Config, type Dimension } from '../src/state';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const dim = (nombre: string, extra: Partial<Dimension> = {}): Dimension => ({
  nombre,
  pregunta: `¿${nombre}?`,
  etiquetaInferior: 'Nada',
  etiquetaSuperior: 'Muchísimo',
  ...extra,
});

const valid = (over: Partial<Config> = {}): Config => ({ ...configPorDefecto(), participante: 'P01', ...over });

describe('recordar la configuración (SPEC §6)', () => {
  it('sin nada guardado devuelve la configuración por defecto', () => {
    expect(loadSavedConfig(memoryStore())).toEqual(configPorDefecto());
    expect(loadSavedConfig(null)).toEqual(configPorDefecto());
  });

  it('guarda y recupera todo salvo el código del participante', () => {
    const store = memoryStore();
    const cfg = valid({
      participante: 'Niño 3',
      condicion: 'Tablet',
      modo: 'deslizador',
      velocidad: 1.5,
      ordenAleatorio: false,
      practica: false,
      syncVideoS: 12.4,
      resolucionS: 0.5,
      dimensiones: [dim('Diversión')],
      recuadroDestello: { x: 0.48, y: 0.125, w: 0.084, h: 0.15 },
    });
    saveConfig(store, cfg);
    expect([...store.data.values()][0]).not.toContain('Niño 3');
    expect(loadSavedConfig(store)).toEqual({ ...cfg, participante: '' });
  });

  it('un recuadro del destello inválido se descarta (SPEC §16.4)', () => {
    for (const recuadroDestello of [null, 'x', { x: 0.9, y: 0, w: 0.2, h: 0.1 }, { x: 0.1, y: 0.1, w: 0, h: 0.1 }, { x: NaN, y: 0, w: 0.1, h: 0.1 }]) {
      expect(sanitizeConfig({ recuadroDestello }).recuadroDestello).toBeNull();
    }
  });

  it('un JSON dañado no impide arrancar', () => {
    const store = memoryStore();
    store.setItem('tet-video:config', '{no es json');
    expect(loadSavedConfig(store)).toEqual(configPorDefecto());
  });

  it('un almacenamiento que lanza al guardar no rompe nada', () => {
    const store: KeyValueStore = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cuota llena');
      },
    };
    expect(() => saveConfig(store, valid())).not.toThrow();
    expect(loadSavedConfig(store)).toEqual(configPorDefecto());
  });

  it('cada campo inválido toma su valor por defecto', () => {
    const c = sanitizeConfig({
      participante: 'P99',
      condicion: 'VR',
      modo: 'otro',
      velocidad: 3,
      ordenAleatorio: 'sí',
      practica: null,
      syncVideoS: -1,
      resolucionS: 0.05,
      dimensiones: 'Diversión',
    });
    expect(c).toEqual(configPorDefecto());
  });

  it('conserva valores válidos y repara dimensiones a medias', () => {
    const c = sanitizeConfig({
      velocidad: 2,
      syncVideoS: 0,
      dimensiones: [{ nombre: 'Calma', pregunta: 5 }, null, 'x'],
    });
    expect(c.velocidad).toBe(2);
    expect(c.syncVideoS).toBe(0);
    expect(c.dimensiones).toEqual([{ nombre: 'Calma', pregunta: '', etiquetaInferior: '', etiquetaSuperior: '' }]);
  });

  it('una lista de dimensiones vacía vuelve a las de ejemplo', () => {
    expect(sanitizeConfig({ dimensiones: [] }).dimensiones).toHaveLength(4);
  });

  it('acepta cosas que no son objeto', () => {
    expect(sanitizeConfig(null)).toEqual(configPorDefecto());
    expect(sanitizeConfig(42)).toEqual(configPorDefecto());
  });
});

describe('validación antes de empezar (SPEC §6)', () => {
  it('la configuración por defecto con un código es válida', () => {
    const v = validateConfig(valid());
    expect(v.ok).toBe(true);
  });

  it('exige el código del participante (los espacios no cuentan)', () => {
    const v = validateConfig(valid({ participante: '   ' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toContain('Escribe el código del participante.');
  });

  it('quita espacios sobrantes del código y de las dimensiones', () => {
    const v = validateConfig(valid({ participante: '  P01 ', dimensiones: [dim(' Diversión ', { pregunta: ' ¿Qué? ' })] }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.config.participante).toBe('P01');
      expect(v.config.dimensiones[0]).toEqual(dim('Diversión', { pregunta: '¿Qué?' }));
    }
  });

  it('exige al menos una dimensión completa', () => {
    const v = validateConfig(valid({ dimensiones: [] }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toContain('Agrega al menos una dimensión completa.');
  });

  it('ignora las filas vacías', () => {
    const empty = { nombre: ' ', pregunta: '', etiquetaInferior: '', etiquetaSuperior: '' };
    const v = validateConfig(valid({ dimensiones: [empty, dim('Diversión'), empty] }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.config.dimensiones.map((d) => d.nombre)).toEqual(['Diversión']);
  });

  it('una fila a medio llenar es un error que la nombra', () => {
    const v = validateConfig(valid({ dimensiones: [dim('Diversión'), dim('Calma', { etiquetaSuperior: '' }), dim('', { pregunta: '¿Algo?' })] }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.some((e) => e.includes('«Calma»'))).toBe(true);
      expect(v.errors.some((e) => e.includes('«n.º 3»'))).toBe(true);
    }
  });

  it('no admite dos dimensiones con el mismo nombre', () => {
    const v = validateConfig(valid({ dimensiones: [dim('Diversión'), dim('diversión')] }));
    expect(v.ok).toBe(false);
  });

  it('rechaza un destello negativo o no numérico y una resolución menor que 0,1', () => {
    for (const over of [{ syncVideoS: -0.01 }, { syncVideoS: NaN }, { resolucionS: 0.09 }, { resolucionS: NaN }]) {
      expect(validateConfig(valid(over)).ok).toBe(false);
    }
    expect(validateConfig(valid({ resolucionS: 0.1, syncVideoS: 0 })).ok).toBe(true);
  });

  it('reúne todos los errores a la vez', () => {
    const v = validateConfig(valid({ participante: '', dimensiones: [], resolucionS: 0 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toHaveLength(3);
  });

  it('isCompleteDimension pide los cuatro campos', () => {
    expect(isCompleteDimension(dim('A'))).toBe(true);
    expect(isCompleteDimension(dim('A', { etiquetaInferior: '  ' }))).toBe(false);
  });
});

describe('orden de las dimensiones', () => {
  const dims = ['A', 'B', 'C', 'D'].map((n) => dim(n));

  it('sin orden aleatorio respeta el orden de la lista', () => {
    expect(dimensionOrder(valid({ dimensiones: dims, ordenAleatorio: false })).map((d) => d.nombre)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('con orden aleatorio usa Fisher–Yates sin modificar la lista original', () => {
    // rand = 0 siempre intercambia con el primero: A B C D → B C D A
    const out = dimensionOrder(valid({ dimensiones: dims, ordenAleatorio: true }), () => 0);
    expect(out.map((d) => d.nombre)).toEqual(['B', 'C', 'D', 'A']);
    expect(dims.map((d) => d.nombre)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('shuffled es una permutación', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let k = 0; k < 20; k++) {
      expect(shuffled([1, 2, 3, 4, 5], rand).sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });
});

describe('roundSync', () => {
  it('redondea a 2 decimales', () => {
    expect(roundSync(12.345)).toBe(12.35);
    expect(roundSync(12.344)).toBe(12.34);
    expect(roundSync(0)).toBe(0);
  });
});
