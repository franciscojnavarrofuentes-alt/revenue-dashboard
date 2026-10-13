/**
 * Hyperliquid: Hypurrscan publica los fees acumulados (histórico diario + un último punto casi en vivo).
 * Guardamos un snapshot en cada ejecución horaria y el revenue de una ventana es la diferencia.
 */
import { db } from '../db.js';

const URL = 'https://api.hypurrscan.io/fees';
const TOLERANCE = 20 * 60;
export const HL_REVENUE_RATIO = 0.99;

db.exec(`CREATE TABLE IF NOT EXISTS hl_snapshots (time INTEGER PRIMARY KEY, total_fees REAL NOT NULL)`);

export async function snapshotHypurrscan(): Promise<number> {
  const res = await fetch(URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Hypurrscan ${res.status}`);
  const raw: any[] = await res.json();
  const ins = db.prepare('INSERT OR IGNORE INTO hl_snapshots (time, total_fees) VALUES (?, ?)');
  for (const r of raw) ins.run(Number(r.time), Number(r.total_fees));
  return Math.max(...raw.map(r => Number(r.time)));
}

function near(ts: number, tolerance: number) {
  const row = db.prepare('SELECT time, total_fees FROM hl_snapshots ORDER BY ABS(time - ?) LIMIT 1').get(ts) as { time: number; total_fees: number } | undefined;
  if (!row || Math.abs(row.time - ts) > tolerance) {
    throw new Error(`sin snapshot de Hypurrscan cerca de ${new Date(ts * 1000).toISOString()}`);
  }
  return row;
}

/** Revenue en [from, to). `tolerance` amplía la búsqueda de snapshots (la calibración de ayer usa los diarios). */
export function hypurrscanRevenue(from: number, to: number, tolerance = TOLERANCE): number {
  const a = near(from, tolerance), b = near(to, tolerance);
  if (b.time <= a.time) throw new Error('snapshots de Hypurrscan insuficientes');
  const fees = ((b.total_fees - a.total_fees) / 1e6) * ((to - from) / (b.time - a.time));
  if (fees < 0) throw new Error('Δ fees negativo en Hypurrscan');
  return fees * HL_REVENUE_RATIO;
}
