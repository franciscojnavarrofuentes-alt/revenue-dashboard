/**
 * Ejecución programada (cada hora; las ventanas de 8h se recogen al cerrar + su retraso):
 *  1. Ranking Top N de DefiLlama (dato diario)
 *  2. Revenue diario de DefiLlama de los protocolos seguidos (calibración)
 *  3. Revenue propio de las ventanas de 8h que falten
 *  4. Alertas sobre las ventanas nuevas
 *
 * Uso: npm run collect               → rellena las últimas 3 ventanas (1 día) que falten
 *      npm run collect -- --backfill-days 14
 */
import { TRACKED, TrackedProtocol, WINDOWS_PER_DAY, WINDOW_HOURS, WINDOW_SECONDS, type Source } from './config.js';
import { failCount, hasWindow, logHeliusUsage, logRun, now, saveWindow } from './db.js';
import { processAlerts, usd } from './alerts.js';
import { adapterWindowRevenue } from './collectors/adapter.js';
import { collectLlamaDaily, collectLlamaRanking } from './collectors/defillama.js';
import { hyperliquidWindowRevenue, snapshotHyperliquid } from './collectors/hyperliquid.js';
import { solanaWindowRevenue } from './collectors/solana.js';
import { iso, recentWindowEnds } from './windows.js';

const argDays = process.argv.indexOf('--backfill-days');
const backfillDays = argDays > 0 ? Number(process.argv[argDays + 1]) : 1;
const MAX_RETRIES = 3;
const only = process.argv.indexOf('--only') > 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;

async function sourceRevenue(p: TrackedProtocol, s: Source, end: number): Promise<number> {
  switch (s.kind) {
    case 'hypurrscan':
      return hyperliquidWindowRevenue(end, s.revenueRatio);
    case 'adapter':
      return (await adapterWindowRevenue(s.path, end)).revenue;
    case 'solana': {
      const r = await solanaWindowRevenue(s.spec, end, WINDOW_SECONDS);
      logHeliusUsage(p.id, s.id, end, r.transactions, r.credits);
      console.log(`    ${r.transactions} transacciones · ${r.credits} créditos Helius · fees $${r.feesUsd.toFixed(0)} − pagos $${r.payoutsUsd.toFixed(0)}`);
      return r.revenueUsd;
    }
  }
}

async function collectProtocol(p: TrackedProtocol): Promise<number[]> {
  const ends = recentWindowEnds(now(), p.lagHours, backfillDays * WINDOWS_PER_DAY);
  const completed: number[] = [];

  for (const end of ends) {
    let allOk = true;
    for (const s of p.sources) {
      if (hasWindow(p.id, s.id, end)) continue;
      // Hypurrscan solo tiene histórico diario: no se pueden reconstruir ventanas antiguas
      if (s.kind === 'hypurrscan' && end < now() - 86400) { allOk = false; continue; }
      // Tras 3 fallos dejamos esa ventana (evita gastar créditos de Dune en bucle)
      if (failCount(p.id, s.id, end) >= MAX_RETRIES) { allOk = false; continue; }
      try {
        const revenue = await sourceRevenue(p, s, end);
        saveWindow(p.id, s.id, end, WINDOW_HOURS, revenue);
        logRun(p.id, s.id, end, true);
        console.log(`  ✓ ${p.name} · ${s.id} · ${iso(end)} → ${usd(revenue)}`);
      } catch (e) {
        allOk = false;
        const msg = (e as Error).message;
        logRun(p.id, s.id, end, false, msg);
        console.error(`  ✗ ${p.name} · ${s.id} · ${iso(end)} → ${msg}`);
      }
    }
    if (allOk) completed.push(end);
  }
  return completed;
}

async function main() {
  console.log(`[${new Date().toISOString()}] recogida (${backfillDays} día/s)`);

  try {
    const top = await collectLlamaRanking();
    logRun(null, 'defillama-ranking', null, true);
    console.log(`  ✓ ranking DefiLlama: ${top.map(t => t.name).join(', ')}`);
  } catch (e) {
    logRun(null, 'defillama-ranking', null, false, (e as Error).message);
    console.error(`  ✗ ranking DefiLlama: ${(e as Error).message}`);
  }
  await collectLlamaDaily();

  try {
    const hl = await snapshotHyperliquid();
    logRun('hyperliquid', 'hypurrscan-snapshot', null, true);
    console.log(`  ✓ snapshot Hyperliquid ${iso(hl.time)}: fees acumulados ${usd(hl.totalFeesUsd)}`);
  } catch (e) {
    logRun('hyperliquid', 'hypurrscan-snapshot', null, false, (e as Error).message);
    console.error(`  ✗ snapshot Hyperliquid: ${(e as Error).message}`);
  }

  let alerts = 0;
  for (const p of TRACKED.filter(t => t.enabled && (!only || t.id === only))) {
    const done = await collectProtocol(p);
    // Solo alertamos sobre ventanas del último día (no sobre el histórico de un backfill)
    for (const end of done.filter(e => e > now() - 86400)) alerts += await processAlerts(p, end);
  }
  console.log(`  alertas: ${alerts}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
