// Estado de la sesión y configuración por defecto (SPEC §6).

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
