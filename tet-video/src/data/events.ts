// Lectura del CSV de eventos y sincronización con LSL (SPEC §8.1, §8.2).

/** Fila del CSV tal como viene (tiempo en el reloj del archivo, normalmente LSL). */
export interface RawEvent {
  t: number;
  label: string;
  /** Ícono del archivo; vacío si no tenía. */
  icon: string;
}

/** Evento ubicado en el tiempo del video. */
export interface VideoEvent {
  t: number;
  label: string;
  icon: string;
}

export type Delimiter = ',' | ';' | '\t';

export type ParseResult =
  | {
      ok: true;
      /** Eventos sin la fila de sincronización, ordenados por tiempo. */
      events: RawEvent[];
      /** Primera fila cuya etiqueta empieza por «sync» o «sincron». */
      sync: RawEvent | null;
      /** Filas descartadas por no tener un tiempo numérico. */
      skipped: number;
      delimiter: Delimiter;
      hasHeader: boolean;
    }
  | { ok: false; error: string };

const TIME_NAMES = ['tiempo', 'time', 't', 'timestamp', 'lsl', 'lsl_time', 'tiempo_lsl', 'segundos', 'seg', 's'];
const LABEL_NAMES = ['evento', 'event', 'label', 'marker', 'marcador', 'etiqueta', 'nombre'];
const ICON_NAMES = ['icono', 'icon', 'emoji'];

const SYNC_RE = /^(sync|sincron)/i;

/** Minúsculas y sin tildes, para comparar nombres y etiquetas. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Número con punto o coma decimal; null si la celda no es un número completo. */
export function parseNumber(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const s = cell.trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

/** Tabulador si aparece; si no, punto y coma cuando hay al menos tantos como comas. */
export function detectDelimiter(line: string): Delimiter {
  if (line.includes('\t')) return '\t';
  const semis = line.split(';').length - 1;
  const commas = line.split(',').length - 1;
  return semis > 0 && semis >= commas ? ';' : ',';
}

/** Separa una línea respetando comillas dobles ("a,b" y "" como comilla escapada). */
export function splitLine(line: string, delim: Delimiter): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseEvents(text: string): ParseResult {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return { ok: false, error: 'El archivo de eventos está vacío.' };

  // Ambigüedad conocida: con separador coma, «1532,40,sync» se lee como tiempo 1532 y etiqueta «40».
  // No se corrige; la pantalla de configuración (fase 4) debe advertirlo.
  const delimiter = detectDelimiter(lines[0]!);
  const rows = lines.map((l) => splitLine(l, delimiter));

  // Encabezado: la primera fila no empieza por un número y tiene algún nombre de columna reconocido.
  // Sin encabezado: columna 1 = tiempo, columna 2 = etiqueta.
  const head = rows[0]!.map(normalize);
  const find = (names: string[]) => head.findIndex((c) => names.includes(c));
  let ti = 0;
  let li = 1;
  let ii = -1;
  const hasHeader =
    parseNumber(rows[0]![0]) === null && (find(TIME_NAMES) >= 0 || find(LABEL_NAMES) >= 0 || find(ICON_NAMES) >= 0);
  if (hasHeader) {
    ti = find(TIME_NAMES);
    if (ti < 0) {
      return { ok: false, error: 'No encontré la columna de tiempo. Usa un encabezado como «tiempo» o «time».' };
    }
    li = find(LABEL_NAMES);
    ii = find(ICON_NAMES);
    rows.shift();
  }

  const parsed: RawEvent[] = [];
  let skipped = 0;
  for (const r of rows) {
    const t = parseNumber(r[ti]);
    if (t === null) {
      skipped++;
      continue;
    }
    parsed.push({ t, label: li >= 0 ? (r[li] ?? '') : '', icon: ii >= 0 ? (r[ii] ?? '') : '' });
  }
  if (parsed.length === 0) {
    return { ok: false, error: 'No encontré filas con un tiempo numérico.' };
  }

  parsed.sort((a, b) => a.t - b.t);
  const sync = parsed.find((e) => SYNC_RE.test(e.label.trim())) ?? null;
  const events = parsed.filter((e) => !SYNC_RE.test(e.label.trim()));
  return { ok: true, events, sync, skipped, delimiter, hasHeader };
}

/** Ícono por la etiqueta cuando el archivo no trae uno (SPEC §8.1). */
export function iconFor(label: string): string {
  const l = normalize(label);
  if (/\b(acierto|aciertos|correct[oa]?|bien|hit)\b/.test(l)) return '⭐';
  if (/\b(error|errores|fallo|falla|incorrect[oa]|miss|fail)\b/.test(l)) return '❌';
  if (/\b(fin|final\w*|termin\w*|end)\b/.test(l)) return '🏁';
  if (/\b(inicio|empieza|comienzo|nivel|start|level)\b/.test(l)) return '🚩';
  if (/\b(premio|recompensa|reward|bonus)\b/.test(l)) return '🎁';
  return '◆';
}

// ---------------------------------------------------------------------------
// Sincronización (SPEC §8.2)
// ---------------------------------------------------------------------------

export interface Sync {
  /** Segundo del destello en el video (S_video). */
  videoS: number;
  /** Tiempo LSL de la fila sync (S_lsl); null si el archivo no la tiene. */
  lslS: number | null;
}

/** t_video = S_video + (t_evento − S_lsl); sin fila sync, t_video = S_video + t_evento. */
export function eventToVideo(tEvento: number, sync: Sync): number {
  return sync.videoS + (tEvento - (sync.lslS ?? 0));
}

/** t_lsl = S_lsl + (t_video − S_video); null sin fila sync. */
export function videoToLsl(tVideo: number, sync: Sync): number | null {
  return sync.lslS === null ? null : sync.lslS + (tVideo - sync.videoS);
}

/** Eventos en tiempo de video, con ícono, dentro de [0, duración]. */
export function toVideoEvents(events: readonly RawEvent[], sync: Sync, duration: number): VideoEvent[] {
  return events
    .map((e) => ({ t: eventToVideo(e.t, sync), label: e.label, icon: e.icon || iconFor(e.label) }))
    .filter((e) => e.t >= 0 && e.t <= duration);
}
