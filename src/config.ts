import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const VENDOR_DIR = path.join(ROOT, 'vendor', 'dimension-adapters');

export const HOUR = 3600;
export const DAY = 86400;

/** Nº de protocolos (padres, como en defillama.com/revenue) que seguimos */
export const TOP_N = Number(process.env.TOP_N ?? 100);
/** Minutos de margen tras cerrar una hora antes de medirla (indexado de RPC/APIs) */
export const HOUR_LAG_MIN = Number(process.env.HOUR_LAG_MIN ?? 10);
/** Máximo de mediciones (hijo × hora) de adapters por ejecución; las horas más recientes van primero.
 *  Al empezar el día o al añadir protocolos, el resto del día se completa en las siguientes ejecuciones. */
export const MAX_JOBS_PER_RUN = Number(process.env.MAX_JOBS_PER_RUN ?? 600);

export const DUNE_ENABLED = process.env.ENABLE_DUNE === 'true';

/** Criterios de calibración: nuestro dato de ayer ÷ dato de DefiLlama */
export const CALIBRATION = {
  okMin: Number(process.env.CALIB_OK_MIN ?? 0.8),
  okMax: Number(process.env.CALIB_OK_MAX ?? 1.25),
  /** por debajo de este revenue diario no merece la pena gastar recursos midiendo por horas */
  minDailyUsd: Number(process.env.CALIB_MIN_DAILY_USD ?? 1000),
};

export const ALERTS = {
  /** acumulado de hoy vs acumulado de ayer a la misma hora */
  todayVsYesterdayPct: Number(process.env.ALERT_TODAY_PCT ?? 40),
  /** no alertar del acumulado hasta que hayan pasado estas horas del día */
  minHoursElapsed: Number(process.env.ALERT_MIN_HOURS ?? 4),
  /** una hora vs la media de esa misma hora en los últimos 7 días */
  hourVsSameHourPct: Number(process.env.ALERT_HOUR_PCT ?? 100),
  hourMinSamples: 3,
  /** ignora protocolos con menos revenue diario que esto */
  minDailyUsd: Number(process.env.ALERT_MIN_DAILY_USD ?? 50_000),
};

export const startOfDayUTC = (ts: number) => Math.floor(ts / DAY) * DAY;
export const hourEnd = (ts: number) => Math.floor(ts / HOUR) * HOUR;
