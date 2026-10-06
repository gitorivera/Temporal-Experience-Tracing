// Generación de los archivos de salida (SPEC §8.3). No cambiar columnas ni formatos sin autorización.
import { APP_VERSION, type DimensionRecord, type SessionData } from '../state';
import { coverageOf, HZ, resample, round } from '../trace/trace';
import { practiceCorrelation } from '../practice';
import { syncJson, videoToLsl, type Sync } from './sync';

/** UTF-8 con BOM en los CSV para que Excel muestre bien las tildes (el JSON va sin BOM). */
const BOM = '﻿';
const EOL = '\r\n';

const SERIES_HEADER = 'participante,condicion,modo,dimension,orden,tiempo_video_s,tiempo_lsl_s,valor';
const TOQUES_HEADER =
  'participante,condicion,modo,dimension,orden,pasada,tiempo_video_s,tiempo_lsl_s,valor,ms_desde_inicio_sesion';

export interface OutputFile {
  kind: 'ventanas' | 'hz10' | 'toques' | 'json';
  name: string;
  mime: string;
  content: string;
}

/** Fecha en ISO-8601 con el desfase local (p. ej. 2026-10-05T15:54:46.123-05:00). */
export function isoLocal(d: Date): string {
  const p = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

/** Código del participante apto para nombre de archivo: tildes quitadas, lo no alfanumérico → «_». */
export function sanitizeId(id: string): string {
  return id
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '_');
}

/** TET_{participante}_{condicion}_{AAAA-MM-DD-HH-MM}, con la hora local en que empezó la sesión. */
export function fileBase(s: Pick<SessionData, 'participante' | 'condicion' | 'inicio'>): string {
  const stamp = s.inicio.slice(0, 16).replace(/[:T]/g, '-');
  return `TET_${sanitizeId(s.participante)}_${s.condicion}_${stamp}`;
}

/** Campo CSV, entre comillas si contiene separador, comillas o saltos de línea. */
export function csvField(x: string | number): string {
  const s = String(x);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fmtT = (t: number) => t.toFixed(3);
const fmtV = (v: number | null) => (v === null || Number.isNaN(v) ? '' : v.toFixed(4));

/** Tiempo LSL formateado; vacío sin fila sync o en la práctica (no ocurre durante el juego). */
function fmtLsl(t: number, sync: Sync, practica: boolean): string {
  if (practica) return '';
  const lsl = videoToLsl(t, sync);
  return lsl === null ? '' : lsl.toFixed(3);
}

/** Práctica (orden 0) seguida de las dimensiones (orden 1…N). */
function ordered(s: SessionData): { rec: DimensionRecord; orden: number }[] {
  const out = s.dimensiones.map((rec, i) => ({ rec, orden: i + 1 }));
  return s.practica ? [{ rec: s.practica, orden: 0 }, ...out] : out;
}

function prefix(s: SessionData, rec: DimensionRecord, orden: number): string {
  return [csvField(s.participante), s.condicion, rec.modo, csvField(rec.dimension.nombre), orden].join(',');
}

const csv = (header: string, rows: string[]) => BOM + [header, ...rows].join(EOL) + EOL;

/** Promedios por ventana de `resolucionS` segundos; solo dimensiones, sin práctica. */
export function buildVentanasCsv(s: SessionData): string {
  const rows: string[] = [];
  s.dimensiones.forEach((rec, i) => {
    const pre = prefix(s, rec, i + 1);
    for (const w of resample(rec.valores, rec.duracionS, s.resolucionS)) {
      rows.push([pre, fmtT(w.t), fmtLsl(w.t, s.sincronizacion, false), fmtV(w.v)].join(','));
    }
  });
  return csv(SERIES_HEADER, rows);
}

/** Serie completa a 10 Hz; incluye la práctica con orden 0. */
export function build10HzCsv(s: SessionData): string {
  const rows: string[] = [];
  for (const { rec, orden } of ordered(s)) {
    const pre = prefix(s, rec, orden);
    rec.valores.forEach((v, i) => {
      const t = i / HZ;
      rows.push([pre, fmtT(t), fmtLsl(t, s.sincronizacion, orden === 0), fmtV(v)].join(','));
    });
  }
  return csv(SERIES_HEADER, rows);
}

/** Cada cambio de valor registrado, de todas las pasadas. */
export function buildToquesCsv(s: SessionData): string {
  const rows: string[] = [];
  for (const { rec, orden } of ordered(s)) {
    const pre = prefix(s, rec, orden);
    for (const p of rec.trazoCrudo) {
      rows.push([pre, p.pasada, fmtT(p.t), fmtLsl(p.t, s.sincronizacion, orden === 0), fmtV(p.v), Math.round(p.ms)].join(','));
    }
  }
  return csv(TOQUES_HEADER, rows);
}

function packDimension(rec: DimensionRecord, orden: number) {
  return {
    orden,
    dimension: rec.dimension.nombre,
    pregunta: rec.dimension.pregunta,
    modo: rec.modo,
    duracion_s: rec.duracionS,
    hz: HZ,
    valores_10hz: rec.valores.map((v) => (Number.isNaN(v) ? null : round(v, 4))),
    trazo_crudo: rec.trazoCrudo.map((p) => ({ pasada: p.pasada, t: round(p.t, 3), v: round(p.v, 4), ms: Math.round(p.ms) })),
    cobertura: round(coverageOf(rec.valores), 4),
    toques: rec.toques,
    pasadas: rec.pasadas,
    saltos_video: rec.saltosVideo,
    tiempo_respuesta_s: rec.tiempoRespuestaS === null ? null : round(rec.tiempoRespuestaS, 2),
  };
}

export function buildJson(s: SessionData): string {
  const r = s.practica ? practiceCorrelation(s.practica.valores) : null;
  const data = {
    version_app: APP_VERSION,
    participante: s.participante,
    condicion: s.condicion,
    inicio: s.inicio,
    grabacion: s.grabacion,
    // video_s y lsl_s se conservan para los scripts existentes; el resto es de la v2 (SPEC §16.6).
    sincronizacion: syncJson(s.sincronizacion),
    eventos: s.eventos.map((e) => ({ t: round(e.t, 3), label: e.label, icon: e.icon })),
    configuracion: {
      modo: s.modo,
      velocidad_reproduccion: s.velocidad,
      valor_inicial: 0.5,
      orden_aleatorio: s.ordenAleatorio,
    },
    practica: s.practica
      ? { ...packDimension(s.practica, 0), correlacion_con_velocidad: r === null ? null : round(r, 4) }
      : null,
    dimensiones: s.dimensiones.map((rec, i) => packDimension(rec, i + 1)),
  };
  // Sin BOM (autorizado por el investigador): muchos lectores de JSON lo rechazan.
  return JSON.stringify(data, null, 1);
}

/** Los cuatro archivos de la sesión. */
export function buildAllFiles(s: SessionData): OutputFile[] {
  const base = fileBase(s);
  const CSV = 'text/csv;charset=utf-8';
  return [
    { kind: 'ventanas', name: `${base}_ventanas.csv`, mime: CSV, content: buildVentanasCsv(s) },
    { kind: 'hz10', name: `${base}_10hz.csv`, mime: CSV, content: build10HzCsv(s) },
    { kind: 'toques', name: `${base}_toques.csv`, mime: CSV, content: buildToquesCsv(s) },
    { kind: 'json', name: `${base}.json`, mime: 'application/json;charset=utf-8', content: buildJson(s) },
  ];
}
