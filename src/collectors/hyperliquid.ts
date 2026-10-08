import { WINDOW_SECONDS } from '../config.js';
import { db } from '../db.js';

/**
 * Hypurrscan publica los fees acumulados de Hyperliquid: un punto diario histórico
 * y un último punto "en vivo" con el valor del momento de la petición.
 * Como el histórico es diario, guardamos nosotros un snapshot en cada ejecución
 * (cada hora) y calculamos el revenue de 8h como diferencia entre snapshots.
 */
const HYPURRSCAN_FEES = 'https://api.hypurrscan.io/fees';
const TOLERANCE_SECONDS = 20 * 60;

db.exec(`CREATE TABLE IF NOT EXISTS hl_snapshots (
  time            INTEGER PRIMARY KEY,
  total_fees      REAL NOT NULL,
  total_spot_fees REAL NOT NULL
)`);

export async function snapshotHyperliquid(): Promise<{ time: number; totalFeesUsd: number }> {
  const res = await fetch(HYPURRSCAN_FEES, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Hypurrscan ${res.status}`);
  const raw: any[] = await res.json();
  const insert = db.prepare('INSERT OR IGNORE INTO hl_snapshots (time, total_fees, total_spot_fees) VALUES (?, ?, ?)');
  for (const r of raw) insert.run(Number(r.time), Number(r.total_fees), Number(r.total_spot_fees ?? 0));
  const last = raw.reduce((a, b) => (Number(b.time) > Number(a.time) ? b : a));
  return { time: Number(last.time), totalFeesUsd: Number(last.total_fees) / 1e6 };
}

function closest(ts: number): { time: number; total_fees: number } {
  const row = db.prepare('SELECT time, total_fees FROM hl_snapshots ORDER BY ABS(time - ?) LIMIT 1').get(ts) as
    { time: number; total_fees: number } | undefined;
  if (!row || Math.abs(row.time - ts) > TOLERANCE_SECONDS) {
    throw new Error(`sin snapshot de Hypurrscan cerca de ${new Date(ts * 1000).toISOString()} (el colector debe ejecutarse cada hora)`);
  }
  return row;
}

/** Revenue de la ventana = Δ fees acumulados (USDC con 6 decimales) × ratio al Assistance Fund */
export function hyperliquidWindowRevenue(windowEnd: number, revenueRatio: number): number {
  const start = closest(windowEnd - WINDOW_SECONDS);
  const end = closest(windowEnd);
  const span = end.time - start.time;
  const fees = ((end.total_fees - start.total_fees) / 1e6) * (WINDOW_SECONDS / span); // normaliza a 8h exactas
  if (fees < 0) throw new Error('Δ fees negativo en Hypurrscan');
  return fees * revenueRatio;
}
