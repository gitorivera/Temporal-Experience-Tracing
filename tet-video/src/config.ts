// Lógica de la pantalla de configuración (SPEC §6), sin DOM para poder probarla:
// recordar la configuración entre sesiones, validarla y ordenar las dimensiones.
import { configPorDefecto, type Condicion, type Config, type Dimension, type ModoRespuesta, type Velocidad } from './state';

const STORAGE_KEY = 'tet-video:config';

/** Lo mínimo de `Storage` que se usa; permite pasar uno falso en las pruebas. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const CONDICIONES: readonly Condicion[] = ['RM', 'Tablet'];
const MODOS: readonly ModoRespuesta[] = ['trazo', 'deslizador'];
const VELOCIDADES: readonly Velocidad[] = [1, 1.5, 2];

export const RESOLUCION_MIN = 0.1;

/** Segundo del destello redondeado a 2 decimales (SPEC §6). */
export function roundSync(x: number): number {
  return Math.round(x * 100) / 100;
}

function str(x: unknown, fallback: string): string {
  return typeof x === 'string' ? x : fallback;
}

/**
 * Convierte lo guardado (posiblemente de otra versión o dañado) en una Config válida.
 * Cada campo inválido toma su valor por defecto. El código del participante nunca se recuerda.
 */
export function sanitizeConfig(raw: unknown): Config {
  const d = configPorDefecto();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;

  const dims = Array.isArray(r.dimensiones)
    ? r.dimensiones
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          nombre: str(x.nombre, ''),
          pregunta: str(x.pregunta, ''),
          etiquetaInferior: str(x.etiquetaInferior, ''),
          etiquetaSuperior: str(x.etiquetaSuperior, ''),
        }))
    : [];

  const sync = typeof r.syncVideoS === 'number' && Number.isFinite(r.syncVideoS) && r.syncVideoS >= 0 ? r.syncVideoS : d.syncVideoS;
  const res = typeof r.resolucionS === 'number' && Number.isFinite(r.resolucionS) && r.resolucionS >= RESOLUCION_MIN ? r.resolucionS : d.resolucionS;

  return {
    participante: '',
    condicion: CONDICIONES.includes(r.condicion as Condicion) ? (r.condicion as Condicion) : d.condicion,
    modo: MODOS.includes(r.modo as ModoRespuesta) ? (r.modo as ModoRespuesta) : d.modo,
    velocidad: VELOCIDADES.includes(r.velocidad as Velocidad) ? (r.velocidad as Velocidad) : d.velocidad,
    ordenAleatorio: typeof r.ordenAleatorio === 'boolean' ? r.ordenAleatorio : d.ordenAleatorio,
    practica: typeof r.practica === 'boolean' ? r.practica : d.practica,
    syncVideoS: sync,
    resolucionS: res,
    dimensiones: dims.length > 0 ? dims : d.dimensiones,
  };
}

/** Configuración recordada, o la de por defecto si no hay o no se puede leer. */
export function loadSavedConfig(store: KeyValueStore | null): Config {
  if (!store) return configPorDefecto();
  try {
    const text = store.getItem(STORAGE_KEY);
    return text === null ? configPorDefecto() : sanitizeConfig(JSON.parse(text));
  } catch {
    return configPorDefecto();
  }
}

/** Guarda todo menos el código del participante. Falla en silencio (modo privado, cuota llena). */
export function saveConfig(store: KeyValueStore | null, cfg: Config): void {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...cfg, participante: '' }));
  } catch {
    // Recordar la configuración es una comodidad; no debe impedir la sesión.
  }
}

// ---------------------------------------------------------------------------
// Validación (SPEC §6: código del participante y al menos una dimensión completa)
// ---------------------------------------------------------------------------

const FIELDS: readonly (keyof Dimension)[] = ['nombre', 'pregunta', 'etiquetaInferior', 'etiquetaSuperior'];

export function isCompleteDimension(d: Dimension): boolean {
  return FIELDS.every((k) => d[k].trim() !== '');
}

export function isEmptyDimension(d: Dimension): boolean {
  return FIELDS.every((k) => d[k].trim() === '');
}

export function trimDimension(d: Dimension): Dimension {
  return {
    nombre: d.nombre.trim(),
    pregunta: d.pregunta.trim(),
    etiquetaInferior: d.etiquetaInferior.trim(),
    etiquetaSuperior: d.etiquetaSuperior.trim(),
  };
}

export type Validation =
  | { ok: true; config: Config }
  | { ok: false; errors: string[] };

/**
 * Comprueba la configuración antes de empezar. Las filas de dimensión vacías se ignoran;
 * una fila a medio llenar es un error, para no descartar en silencio algo que el investigador escribió.
 * Si es válida, devuelve la configuración limpia (textos sin espacios sobrantes, solo dimensiones completas).
 */
export function validateConfig(cfg: Config): Validation {
  const errors: string[] = [];
  const participante = cfg.participante.trim();
  if (participante === '') errors.push('Escribe el código del participante.');

  cfg.dimensiones.forEach((d, i) => {
    if (!isEmptyDimension(d) && !isCompleteDimension(d)) {
      const name = d.nombre.trim() || `n.º ${i + 1}`;
      errors.push(`La dimensión «${name}» está incompleta: llena nombre, pregunta y las dos etiquetas, o bórrala.`);
    }
  });
  const used = cfg.dimensiones.filter((d) => !isEmptyDimension(d));
  if (used.length === 0) errors.push('Agrega al menos una dimensión completa.');

  const names = used.map((d) => d.nombre.trim().toLowerCase()).filter((n) => n !== '');
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup !== undefined) errors.push('Hay dos dimensiones con el mismo nombre: en los archivos no se podrían distinguir.');

  if (!Number.isFinite(cfg.syncVideoS) || cfg.syncVideoS < 0) {
    errors.push('El segundo del destello debe ser un número mayor o igual que 0.');
  }
  if (!Number.isFinite(cfg.resolucionS) || cfg.resolucionS < RESOLUCION_MIN) {
    errors.push('La resolución de exportación debe ser un número mayor o igual que 0,1 s.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { ...cfg, participante, dimensiones: used.map(trimDimension) } };
}

// ---------------------------------------------------------------------------
// Orden de las dimensiones
// ---------------------------------------------------------------------------

/** Fisher–Yates sobre una copia. `rand` devuelve [0, 1), como Math.random. */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Orden en que el niño responderá las dimensiones. */
export function dimensionOrder(cfg: Config, rand: () => number = Math.random): Dimension[] {
  return cfg.ordenAleatorio ? shuffled(cfg.dimensiones, rand) : cfg.dimensiones.slice();
}
