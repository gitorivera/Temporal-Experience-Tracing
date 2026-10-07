import { describe, expect, it } from 'vitest';
import {
  lslToVideo,
  MAX_DIF_INTERVALO_S,
  pointsOf,
  syncFromPoints,
  syncJson,
  syncModel,
  syncQuality,
  videoToLsl,
  type SyncPoint,
} from '../src/data/sync';
import { parseEvents, toVideoEvents } from '../src/data/events';

/** Partida de 5 min: destello al iniciar, cada 60 s y al final (GAME-SPECS §3.1). */
const LSL = [1000, 1060, 1120, 1180, 1240, 1290];

/** Puntos con el video en función del tiempo LSL. */
const points = (videoOf: (l: number) => number, lsl = LSL): SyncPoint[] =>
  lsl.map((l, k) => ({ etiqueta: `sync_${k + 1}`, videoS: videoOf(l), lslS: l, origen: 'auto' }));

describe('modelo de sincronización (SPEC §16.3)', () => {
  it('sin puntos, con uno o con varios', () => {
    expect(syncModel({ videoS: 3, lslS: null })).toBe('sin_sync');
    expect(syncModel({ videoS: 3, lslS: 1000 })).toBe('un_punto');
    expect(syncModel(syncFromPoints(points((l) => l - 988)))).toBe('tramos');
  });

  it('un solo punto en `puntos` funciona como el caso de un destello', () => {
    const s = syncFromPoints([{ etiqueta: 'sync', videoS: 12.4, lslS: 1532.4, origen: 'manual' }]);
    expect(syncModel(s)).toBe('un_punto');
    expect(videoToLsl(20, s)).toBeCloseTo(1540, 9);
  });

  it('las sesiones guardadas antes de la v2 (sin `puntos`) siguen igual', () => {
    const viejo = { videoS: 12.4, lslS: 1532.4 };
    expect(videoToLsl(12.4, viejo)).toBeCloseTo(1532.4, 9);
    expect(lslToVideo(1561.8, viejo)).toBeCloseTo(41.8, 9);
    expect(pointsOf(viejo)).toEqual([{ etiqueta: 'sync', videoS: 12.4, lslS: 1532.4, origen: 'manual' }]);
    expect(lslToVideo(10, { videoS: 2, lslS: null })).toBe(12);
    expect(videoToLsl(10, { videoS: 2, lslS: null })).toBeNull();
  });

  it('corrige la deriva: video 0,1 % más lento que LSL', () => {
    const s = syncFromPoints(points((l) => 12 + (l - 1000) * 1.001));
    // Instante a mitad de la partida: 150 s LSL después del primer destello.
    const v = 12 + 150 * 1.001;
    expect(videoToLsl(v, s)).toBeCloseTo(1150, 6);
    // Con un solo destello habría 0,15 s de error ahí.
    expect(Math.abs(videoToLsl(v, { videoS: 12, lslS: 1000 })! - 1150)).toBeCloseTo(0.15, 6);
  });

  it('corrige un salto de la transmisión entre dos destellos', () => {
    // La transmisión se congela 0,4 s entre sync_3 y sync_4: desde ahí el video va 0,4 s adelantado.
    const s = syncFromPoints(points((l) => 12 + (l - 1000) + (l >= 1180 ? 0.4 : 0)));
    expect(videoToLsl(12 + 180 + 0.4, s)).toBeCloseTo(1180, 9);
    expect(videoToLsl(12 + 250 + 0.4, s)).toBeCloseTo(1250, 9);
    const q = syncQuality(pointsOf(s));
    expect(q.ok).toBe(true);
    expect(q.difIntervaloMaxS).toBeCloseTo(0.4, 9);
    expect(q.residuoRectaMaxMs!).toBeGreaterThan(100);
  });

  it('ida y vuelta: lslToVideo y videoToLsl son inversas', () => {
    const s = syncFromPoints(points((l) => 12 + (l - 1000) * 0.998 + (l >= 1120 ? 0.2 : 0)));
    for (const t of [0, 5, 12, 61.3, 150, 250, 301, 320]) {
      expect(lslToVideo(videoToLsl(t, s)!, s)).toBeCloseTo(t, 9);
    }
  });

  it('antes del primer destello y después del último extiende el primer y el último tramo', () => {
    const s = syncFromPoints(points((l) => 12 + (l - 1000) * 1.001));
    expect(videoToLsl(0, s)).toBeCloseTo(1000 - 12 / 1.001, 6);
    expect(videoToLsl(12 + 300 * 1.001, s)).toBeCloseTo(1300, 6);
  });

  it('los puntos pueden venir en cualquier orden', () => {
    const p = points((l) => 12 + (l - 1000));
    const s = syncFromPoints([...p].reverse());
    expect(s.videoS).toBe(12);
    expect(s.lslS).toBe(1000);
    expect(videoToLsl(100, s)).toBeCloseTo(1088, 9);
  });

  it('con puntos incoherentes (el video retrocede) cae al primer punto en vez de fallar', () => {
    const p = points((l) => 12 + (l - 1000));
    p[2] = { ...p[2]!, videoS: 10 };
    const s = syncFromPoints(p);
    expect(syncModel(s)).toBe('un_punto');
    expect(videoToLsl(20, s)).toBeCloseTo(1008, 9);
  });
});

describe('controles de calidad (SPEC §16.3)', () => {
  it('una grabación limpia: ritmo 1, sin diferencias, residuo 0', () => {
    const q = syncQuality(points((l) => l - 988));
    expect(q.ok).toBe(true);
    expect(q.ritmoPorTramo).toHaveLength(5);
    q.ritmoPorTramo.forEach((r) => expect(r).toBeCloseTo(1, 9));
    expect(q.difIntervaloMaxS).toBeCloseTo(0, 9);
    expect(q.residuoRectaMaxMs).toBeCloseTo(0, 6);
  });

  it('la deriva se ve en el ritmo pero no en el residuo de la recta', () => {
    const q = syncQuality(points((l) => 12 + (l - 1000) * 1.001));
    q.ritmoPorTramo.forEach((r) => expect(r).toBeCloseTo(1 / 1.001, 9));
    expect(q.residuoRectaMaxMs).toBeCloseTo(0, 6);
  });

  it('un destello faltante en el video se detecta por los intervalos', () => {
    // El video no muestra el destello de sync_3: los demás se emparejan corridos.
    const videos = LSL.filter((_, k) => k !== 2).map((l) => 12 + (l - 1000));
    const p: SyncPoint[] = videos.map((v, k) => ({ etiqueta: `sync_${k + 1}`, videoS: v, lslS: LSL[k]!, origen: 'auto' }));
    const q = syncQuality(p);
    expect(q.ok).toBe(false);
    expect(q.difIntervaloMaxS!).toBeGreaterThan(MAX_DIF_INTERVALO_S);
  });

  it('un orden incoherente no es válido', () => {
    const p = points((l) => 12 + (l - 1000));
    p[3] = { ...p[3]!, videoS: p[2]!.videoS };
    const q = syncQuality(p);
    expect(q.ordenValido).toBe(false);
    expect(q.ok).toBe(false);
  });

  it('dos sync con el mismo tiempo LSL (marcador repetido) no son válidos', () => {
    const p = points((l) => 12 + (l - 1000));
    p[3] = { ...p[3]!, lslS: p[2]!.lslS, videoS: p[2]!.videoS + 0.2 };
    const q = syncQuality(p);
    expect(q.ordenValido).toBe(false);
    expect(q.ok).toBe(false);
    // Coincide con el modelo: sin tramos, se cae al primer punto.
    expect(syncModel(syncFromPoints(p))).toBe('un_punto');
  });

  it('con menos de 2 puntos no hay nada que controlar', () => {
    expect(syncQuality([])).toMatchObject({ ok: true, difIntervaloMaxS: null, residuoRectaMaxMs: null });
  });
});

describe('JSON (SPEC §16.6)', () => {
  it('bloque por tramos', () => {
    const s = syncFromPoints(points((l) => 12.4 + (l - 1000) * 1.0005, [1000, 1060, 1120]));
    const j = syncJson(s);
    expect(j.video_s).toBe(12.4);
    expect(j.lsl_s).toBe(1000);
    expect(j.modelo).toBe('tramos');
    expect(j.puntos).toEqual([
      { etiqueta: 'sync_1', video_s: 12.4, lsl_s: 1000, origen: 'auto' },
      { etiqueta: 'sync_2', video_s: 72.43, lsl_s: 1060, origen: 'auto' },
      { etiqueta: 'sync_3', video_s: 132.46, lsl_s: 1120, origen: 'auto' },
    ]);
    expect(j.ritmo_por_tramo).toEqual([0.9995, 0.9995]);
    expect(j.dif_intervalo_max_s).toBe(0.03);
    expect(j.residuo_recta_max_ms).toBe(0);
  });

  it('sin sincronización', () => {
    expect(syncJson({ videoS: 0, lslS: null })).toEqual({
      video_s: 0,
      lsl_s: null,
      modelo: 'sin_sync',
      puntos: [],
      ritmo_por_tramo: [],
      dif_intervalo_max_s: null,
      residuo_recta_max_ms: null,
    });
  });
});

describe('CSV de eventos con varios destellos', () => {
  const csv = [
    'tiempo,evento',
    '1000.000,sync_1',
    '1000.000,inicio partida',
    '1031.250,acierto',
    '1060.000,sync_2',
    '1095.500,error',
    '1120.000,sync_3',
  ].join('\n');

  it('devuelve todas las filas sync en orden y no las muestra como eventos', () => {
    const r = parseEvents(csv);
    if (!r.ok) throw new Error(r.error);
    expect(r.syncs.map((x) => x.label)).toEqual(['sync_1', 'sync_2', 'sync_3']);
    expect(r.sync?.label).toBe('sync_1');
    expect(r.events.map((x) => x.label)).toEqual(['inicio partida', 'acierto', 'error']);
  });

  it('lee el CSV que escribe scripts/xdf_a_eventos.py (etiqueta con coma entre comillas)', () => {
    // Salida real del script con un XDF de prueba leído por pyxdf.
    const r = parseEvents(
      'tiempo,evento\r\n1000.000,sync_1\r\n1000.000,inicio partida\r\n1031.250,"acierto, objetivo 3"\r\n1060.000,sync_2\r\n',
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.delimiter).toBe(',');
    expect(r.syncs.map((x) => x.t)).toEqual([1000, 1060]);
    expect(r.events.map((x) => x.label)).toEqual(['inicio partida', 'acierto, objetivo 3']);
    expect(r.skipped).toBe(0);
  });

  it('ubica los eventos en el video usando los tramos', () => {
    const r = parseEvents(csv);
    if (!r.ok) throw new Error(r.error);
    // Video con 0,2 s de salto entre sync_2 y sync_3.
    const p: SyncPoint[] = [
      { etiqueta: 'sync_1', videoS: 5, lslS: 1000, origen: 'auto' },
      { etiqueta: 'sync_2', videoS: 65, lslS: 1060, origen: 'auto' },
      { etiqueta: 'sync_3', videoS: 125.2, lslS: 1120, origen: 'auto' },
    ];
    const ev = toVideoEvents(r.events, syncFromPoints(p), 200);
    expect(ev.map((e) => e.t)).toEqual([5, 36.25, expect.closeTo(65 + 35.5 * (60.2 / 60), 9)]);
  });
});
