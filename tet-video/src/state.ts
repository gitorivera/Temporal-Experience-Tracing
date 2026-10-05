// Estado de la sesión y configuración por defecto (SPEC §6).
import type { Sync, VideoEvent } from './data/events';

export type Condicion = 'RM' | 'Tablet';
export type ModoRespuesta = 'trazo' | 'deslizador';
export type Velocidad = 1 | 1.5 | 2;

export interface Dimension {
  nombre: string;
  pregunta: string;
  etiquetaInferior: string;
  etiquetaSuperior: string;
}

export interface Config {
  participante: string;
  condicion: Condicion;
  modo: ModoRespuesta;
  velocidad: Velocidad;
  ordenAleatorio: boolean;
  practica: boolean;
  /** Segundo del destello de sincronización en el video. */
  syncVideoS: number;
  /** Resolución de exportación en segundos (≥ 0,1). */
  resolucionS: number;
  dimensiones: Dimension[];
}

/** Cambio de valor registrado durante una pasada (trazo crudo). */
export interface RawPoint {
  pasada: number;
  /** Tiempo del video (s). */
  t: number;
  v: number;
  /** Milisegundos desde el inicio de la sesión. */
  ms: number;
}

/** Resultado de una dimensión (o de la práctica) al pulsar «Listo». */
export interface DimensionRecord {
  dimension: Dimension;
  modo: ModoRespuesta;
  duracionS: number;
  /** Buffer a HZ; NaN donde no hay dato. */
  valores: number[];
  trazoCrudo: RawPoint[];
  toques: number;
  pasadas: number;
  saltosVideo: number;
  tiempoRespuestaS: number | null;
}

/** Todo lo necesario para generar los archivos de salida (SPEC §8.3). */
export interface SessionData {
  participante: string;
  condicion: Condicion;
  /** ISO-8601 con el desfase de la hora local, p. ej. 2026-10-05T15:54:46.123-05:00. */
  inicio: string;
  /** Nombre del archivo de video; null si se usó la grabación de ejemplo. */
  grabacion: string | null;
  sincronizacion: Sync;
  eventos: VideoEvent[];
  modo: ModoRespuesta;
  velocidad: Velocidad;
  ordenAleatorio: boolean;
  resolucionS: number;
  practica: DimensionRecord | null;
  /** En el orden en que el niño las respondió. */
  dimensiones: DimensionRecord[];
}

export const APP_VERSION: string = __APP_VERSION__;

export const DIMENSIONES_POR_DEFECTO: readonly Dimension[] = [
  { nombre: 'Diversión', pregunta: '¿Cuánto te estabas divirtiendo?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' },
  { nombre: 'Esfuerzo', pregunta: '¿Cuánto esfuerzo estabas haciendo?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' },
  { nombre: 'Aburrimiento', pregunta: '¿Qué tan aburrido estabas?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' },
  { nombre: 'Pensar en otra cosa', pregunta: '¿Cuánto pensabas en cosas que no eran el juego?', etiquetaInferior: 'Nada', etiquetaSuperior: 'Muchísimo' },
];

export function configPorDefecto(): Config {
  return {
    participante: '',
    condicion: 'RM',
    modo: 'trazo',
    velocidad: 1,
    ordenAleatorio: true,
    practica: true,
    syncVideoS: 0,
    resolucionS: 1,
    dimensiones: DIMENSIONES_POR_DEFECTO.map((d) => ({ ...d })),
  };
}
