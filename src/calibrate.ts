/**
 * Calibración: para cada hijo pendiente, mide el día de AYER (UTC) y dos horas sueltas, y lo compara
 * con el dato diario de DefiLlama. Decide si se puede seguir en vivo.
 *
 *   npm run calibrate                     → hijos en estado pending
 *   npm run calibrate -- --all            → recalibra todos los medibles
 *   npm run calibrate -- --only hyperliquid
 *
 * Estados: live (cuadra y varía por horas) · daily_only (el adapter solo da días) · mismatch (no cuadra)
 *          needs_key (falta clave o servicio de pago) · error
 */
import { CALIBRATION, DAY, HOUR, startOfDayUTC } from './config.js';
import { db, logRun, now, setPlan, universe } from './db.js';
import { looksLikeMissingKey } from './methods/adapters.js';
import { snapshotHypurrscan } from './methods/hypurrscan.js';
import { measure, mkey, type Target } from './measure.js';

const LLAMA = 'https://api.llama.fi/summary/fees';

async function llamaDay(slug: string | null, day: number): Promise<number | null> {
  if (!slug) return null;
  try {
    const res = await fetch(`${LLAMA}/${slug}?dataType=dailyRevenue&excludeTotalDataChartBreakdown=true`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const d: any = await res.json();
    const row = (d.totalDataChart ?? []).find((r: [number, number]) => Number(r[0]) === day);
    return row ? Number(row[1]) : null;
  } catch { return null; }
}

export type Verdict = { status: string; ratio: number | null; note: string };

/** Decide el estado a partir de las mediciones (función pura, testeable) */
export function verdict(dayOurs: { ok: boolean; revenue?: number; error?: string }, llama: number | null,
                        h1: { ok: boolean; revenue?: number; error?: string }, h2: { ok: boolean; revenue?: number; error?: string }): Verdict {
  if (!dayOurs.ok) {
    const err = dayOurs.error ?? 'error';
    return { status: looksLikeMissingKey(err) ? 'needs_key' : 'error', ratio: null, note: err.slice(0, 300) };
  }
  const ours = dayOurs.revenue ?? 0;
  if (llama === null) return { status: 'mismatch', ratio: null, note: `Sin dato de DefiLlama para comparar (nuestro: $${Math.round(ours)})` };
  if (llama <= 0 && ours <= 0) return { status: 'daily_only', ratio: null, note: 'Revenue 0 ayer: no hay nada que medir' };
  const ratio = llama > 0 ? ours / llama : Infinity;
  if (!(ratio >= CALIBRATION.okMin && ratio <= CALIBRATION.okMax)) {
    return { status: 'mismatch', ratio: Number.isFinite(ratio) ? ratio : null, note: `Ayer: nuestro $${Math.round(ours)} vs DefiLlama $${Math.round(llama)}` };
  }
  if (!h1.ok || !h2.ok) return { status: 'daily_only', ratio, note: `Cuadra por días pero falla por horas: ${(h1.error ?? h2.error ?? '').slice(0, 200)}` };
  const a = h1.revenue ?? 0, b = h2.revenue ?? 0;
  // si una hora devuelve lo mismo que el día entero, el adapter ignora la ventana y solo da días
  if (ours > 0 && (Math.abs(a - ours) / ours < 0.05 || Math.abs(b - ours) / ours < 0.05)) {
    return { status: 'daily_only', ratio, note: 'El adapter devuelve el día completo aunque se le pida una hora' };
  }
  // dos horas plausibles: su ritmo no puede estar a más de 10x del día
  const hourly = (a + b) * 12;
  if (ours > 0 && (hourly > ours * 10)) return { status: 'mismatch', ratio, note: `Las horas no cuadran con el día (${Math.round(hourly)} vs ${Math.round(ours)})` };
  return { status: 'live', ratio, note: `Ayer: nuestro $${Math.round(ours)} vs DefiLlama $${Math.round(llama)}` };
}

export async function calibrate({ all = false, only = '' } = {}) {
  const today = startOfDayUTC(now());
  const yesterday = today - DAY;
  const statuses = all ? ['pending', 'live', 'mismatch', 'error', 'daily_only'] : ['pending'];

  const rows = universe().filter(r =>
    r.method && ['adapter', 'solana', 'hypurrscan'].includes(r.method) && statuses.includes(r.status ?? 'pending') &&
    (!only || r.parent_name.toLowerCase().includes(only.toLowerCase()) || (r.module ?? '').includes(only)));
  if (!rows.length) return { calibrated: 0, summary: {} };

  if (rows.some(r => r.method === 'hypurrscan')) await snapshotHypurrscan().catch(() => undefined);

  const targets: Target[] = rows.map(r => ({ child: r.child, method: r.method!, adapter_type: r.adapter_type ?? null, module: r.module, llama_rev24h: r.llama_rev24h }));
  const dayW: [number, number] = [yesterday, today];
  const h1W: [number, number] = [today - 2 * HOUR, today - HOUR];
  const h2W: [number, number] = [today - HOUR, today];

  console.log(`Calibrando ${rows.length} adapters (día ${new Date(yesterday * 1000).toISOString().slice(0, 10)})…`);
  // Hypurrscan solo tiene puntos diarios hacia atrás: para ayer se admite el punto diario más cercano
  const m = await measure(targets, [dayW, h1W, h2W], { hypurrscanTolerance: 9 * HOUR, perChain: true });

  const summary: Record<string, number> = {};
  for (const r of rows) {
    const llama = (await llamaDay(r.slug, yesterday)) ?? null;
    if (llama !== null) db.prepare('INSERT OR REPLACE INTO llama_daily (child, day, revenue) VALUES (?, ?, ?)').run(r.child, yesterday, llama);
    const v = r.method === 'hypurrscan'
      // Hypurrscan no tiene puntos horarios de ayer: en Hyperliquid solo se compara el día
      ? verdict(m.get(mkey(r.child, ...dayW))!, llama, { ok: true, revenue: 1 }, { ok: true, revenue: 1 })
      : verdict(m.get(mkey(r.child, ...dayW))!, llama, m.get(mkey(r.child, ...h1W))!, m.get(mkey(r.child, ...h2W))!);
    const failed = m.get(mkey(r.child, ...dayW))?.failedChains ?? [];
    if (failed.length && v.status !== 'needs_key' && v.status !== 'error') {
      v.note += ` · sin ${failed.map(f => f.chain).join(', ')} (${failed[0].error.slice(0, 80)})`;
    }
    setPlan({ child: r.child, method: r.method!, adapter_type: r.adapter_type, status: v.status, ratio: v.ratio, note: v.note,
              skipChains: failed.map(f => f.chain), calibrated: true });
    logRun(r.child, null, 'calibrate', v.status === 'live', v.status === 'live' ? undefined : v.note);
    summary[v.status] = (summary[v.status] ?? 0) + 1;
    console.log(`  ${v.status.padEnd(10)} ${r.parent_name} · ${r.child_name}${v.ratio ? ` · ratio ${v.ratio.toFixed(2)}` : ''} · ${v.note.slice(0, 120)}`);
  }
  return { calibrated: rows.length, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = process.argv.includes('--all');
  const i = process.argv.indexOf('--only');
  calibrate({ all, only: i > 0 ? process.argv[i + 1] : '' })
    .then(r => { console.log('Resumen:', r.summary); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
