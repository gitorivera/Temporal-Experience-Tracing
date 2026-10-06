// IndexedDB: sesiones y respaldos (SPEC §9).
// La sesión completa se guarda (upsert) al terminar cada dimensión, con `completa: boolean`.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { SessionData } from '../state';
import { buildAllFiles, fileBase, isoLocal } from './export';

export interface StoredSession {
  /** inicio + participante (SPEC §9). */
  id: string;
  completa: boolean;
  /** Dimensiones planeadas (sin la práctica), para mostrar «2 de 4». */
  totalDimensiones: number;
  /** Última vez que se guardó (ISO-8601 local). */
  guardadaEn: string;
  sesion: SessionData;
}

export function sessionId(s: Pick<SessionData, 'inicio' | 'participante'>): string {
  return `${s.inicio}_${s.participante}`;
}

export function toStored(s: SessionData, totalDimensiones: number, now: Date = new Date()): StoredSession {
  return {
    id: sessionId(s),
    completa: s.dimensiones.length >= totalDimensiones,
    totalDimensiones,
    guardadaEn: isoLocal(now),
    sesion: s,
  };
}

/** Más recientes primero. */
export function sortSessions(list: readonly StoredSession[]): StoredSession[] {
  return [...list].sort((a, b) => Date.parse(b.sesion.inicio) - Date.parse(a.sesion.inicio));
}

export function estadoTexto(st: StoredSession): string {
  if (st.completa) return 'Completa';
  const n = st.sesion.dimensiones.length;
  return `Incompleta (${n} de ${st.totalDimensiones} ${st.totalDimensiones === 1 ? 'dimensión' : 'dimensiones'})`;
}

/**
 * ZIP con los 4 archivos de cada sesión, cada una en su carpeta (SPEC §9).
 * Si dos sesiones dan el mismo nombre base (mismo participante en el mismo minuto), la segunda lleva «_2».
 */
export function buildZip(list: readonly StoredSession[]): Uint8Array {
  const data: Zippable = {};
  const used = new Map<string, number>();
  for (const st of list) {
    const base = fileBase(st.sesion);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const folder = n === 1 ? base : `${base}_${n}`;
    const files: Zippable = {};
    for (const f of buildAllFiles(st.sesion)) files[f.name] = strToU8(f.content);
    data[folder] = files;
  }
  return zipSync(data, { level: 6 });
}

export function zipName(now: Date = new Date()): string {
  return `TET_sesiones_${isoLocal(now).slice(0, 16).replace(/[:T]/g, '-')}.zip`;
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

interface TetDB extends DBSchema {
  sesiones: { key: string; value: StoredSession };
}

const DB_NAME = 'tet-video';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TetDB>> | null = null;

function db(): Promise<IDBPDatabase<TetDB>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Este navegador no tiene IndexedDB.'));
    dbPromise = openDB<TetDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('sesiones', { keyPath: 'id' });
      },
      // Otra pestaña con una versión nueva pide cerrar la conexión.
      blocking() {
        void dbPromise?.then((x) => x.close());
        dbPromise = null;
      },
    }).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Guarda o reemplaza la sesión (upsert por id). */
export async function putSession(st: StoredSession): Promise<void> {
  await (await db()).put('sesiones', st);
}

export async function getSession(id: string): Promise<StoredSession | undefined> {
  return (await db()).get('sesiones', id);
}

export async function listSessions(): Promise<StoredSession[]> {
  return sortSessions(await (await db()).getAll('sesiones'));
}

export async function deleteSession(id: string): Promise<void> {
  await (await db()).delete('sesiones', id);
}

let persistPromise: Promise<boolean | null> | null = null;

/**
 * Pide almacenamiento persistente para reducir el riesgo de que el navegador borre los datos (SPEC §9).
 * true: concedido; false: negado; null: el navegador no lo permite pedir.
 */
export function requestPersistence(): Promise<boolean | null> {
  if (!persistPromise) {
    persistPromise =
      typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function'
        ? navigator.storage.persist().catch(() => false)
        : Promise.resolve(null);
  }
  return persistPromise;
}
