/**
 * Recogida horaria (systemd timer, minuto 12 de cada hora):
 *  1. Una vez al día: actualiza el universo Top N y calibra los adapters nuevos
 *  2. Snapshot de Hypurrscan
 *  3. Mide las horas cerradas de hoy que falten de cada hijo en vivo (las más recientes primero)
 *  4. Alertas sobre la vista de hoy
 *
 *   npm run collect
 *   npm run collect -- --only axiom     (solo hijos cuyo padre o módulo contenga el texto)
 */
import { HOUR, HOUR_LAG_MIN, MAX_JOBS_PER_RUN, hourEnd, startOfDayUTC } from './config.js';
import { db, failCount, hasHour, logRun, now, saveHour, universe } from './db.js';
import { processAlerts, usd } from './alerts.js';
import { calibrate } from './calibrate.js';
import { discover } from './discover.js';
import { measurePairs, mkey, type Target } from './measure.js';
import { snapshotHypurrscan } from './methods/hypurrscan.js';
import { computeToday } from './today.js';

const MAX_RETRIES = 3;
const only = process.argv.indexOf('--only') > 0 ? process.argv[process.argv.indexOf('--only') + 1].toLowerCase() : '';

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] recogida`);

  // 1. universo diario
  const last = db.prepare('SELECT MAX(updated_at) AS t FROM universe').get() as { t: number | null };
  if (!last.t || now() - last.t > 20 * HOUR) {
    try {
      const d = await discover();
      console.log(`  ✓ universo: ${d.parents} protocolos, ${d.children} adapters`, d.counts);
      const c = await calibrate();
      if (c.calibrated) console.log('  ✓ calibración de nuevos:', c.summary);
    } catch (e) {
      logRun(null, null, 'discover', false, String((e as Error).message));
      console.error(`  ✗ universo: ${(e as Error).message}`);
    }
  }

  // 2. Hypurrscan
  try { await snapshotHypurrscan(); logRun(null, null, 'snapshot', true); }
  catch (e) { logRun(null, null, 'snapshot', false, String((e as Error).message)); console.error(`  ✗ Hypurrscan: ${(e as Error).message}`); }

  // 3. horas pendientes
  const lastHour = hourEnd(now() - HOUR_LAG_MIN * 60);
  const day0 = startOfDayUTC(lastHour - 1);
  const hoursToTry: number[] = [];
  for (let he = lastHour; he > day0; he -= HOUR) hoursToTry.push(he);
  const live = universe().filter(r => r.status === 'live' && ['adapter', 'solana', 'hypurrscan'].includes(r.method ?? '') &&
    (!only || r.parent_name.toLowerCase().includes(only) || (r.module ?? '').toLowerCase().includes(only)));

  // pares (hijo, hora) pendientes, de la hora más reciente hacia atrás, con un límite por ejecución
  const pairs: { target: Target; from: number; to: number }[] = [];
  for (const he of hoursToTry) {
    for (const r of live) {
      if (pairs.length >= MAX_JOBS_PER_RUN) break;
      if (hasHour(r.child, he) || failCount(r.child, he) >= MAX_RETRIES) continue;
      pairs.push({ target: { child: r.child, method: r.method!, adapter_type: r.adapter_type ?? null, module: r.module, llama_rev24h: r.llama_rev24h, skip_chains: r.skip_chains ? JSON.parse(r.skip_chains) : null }, from: he - HOUR, to: he });
    }
  }
  if (pairs.length >= MAX_JOBS_PER_RUN) console.log(`  límite de ${MAX_JOBS_PER_RUN} mediciones: el resto del día se completa en la próxima ejecución`);

  let saved = 0, failed = 0;
  const m = await measurePairs(pairs);
  for (const { target: t, from, to } of pairs) {
    const r = m.get(mkey(t.child, from, to));
    if (r?.ok && r.revenue !== undefined) { saveHour(t.child, to, r.revenue, t.method); logRun(t.child, to, 'hour', true); saved++; }
    else { logRun(t.child, to, 'hour', false, r?.error ?? 'sin resultado'); failed++; }
  }

  // 4. vista de hoy y alertas
  const view = computeToday(now());
  const created = await processAlerts(view.parents, now(), view.summary.hoursElapsed);
  console.log(`  ✓ ${saved} horas guardadas, ${failed} fallos · hoy ${usd(view.summary.totalToday)} · ${JSON.stringify(view.summary.counts)} · alertas nuevas: ${created} · ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
