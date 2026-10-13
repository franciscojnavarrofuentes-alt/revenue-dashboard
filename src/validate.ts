/**
 * Prueba de validación con datos reales (sin base de datos):
 *   npm run validate -- out.json
 *
 * Para Axiom y GMGN calcula con Helius el revenue de AYER (día UTC completo) y lo compara con
 * el dato diario de DefiLlama, y el revenue de HOY hasta ahora. Para Hyperliquid compara el
 * último día de Hypurrscan con DefiLlama. Escribe un JSON con resultados y errores.
 */
import fs from 'node:fs';
import { SOLANA_SPECS } from './methods/specs.js';
import { solanaWindowRevenue } from './methods/solana.js';

const outPath = process.argv[2] ?? 'validate.json';
const now = Math.floor(Date.now() / 1000);
const today = Math.floor(now / 86400) * 86400;
const yesterday = today - 86400;
const result: any = { ranAt: new Date(now * 1000).toISOString(), day: new Date(yesterday * 1000).toISOString().slice(0, 10), checks: {} };

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url.replace(/api-key=[^&]+/, 'api-key=***')}`);
  return res.json();
}

async function llamaDay(slug: string, day: number): Promise<number | null> {
  const d: any = await json(`https://api.llama.fi/summary/fees/${slug}?dataType=dailyRevenue&excludeTotalDataChartBreakdown=true`);
  const row = (d.totalDataChart ?? []).find((r: [number, number]) => Number(r[0]) === day);
  return row ? Number(row[1]) : null;
}

async function step(name: string, fn: () => Promise<any>) {
  const t0 = Date.now();
  try {
    result.checks[name] = { ok: true, ...(await fn()), seconds: Math.round((Date.now() - t0) / 1000) };
  } catch (e) {
    result.checks[name] = { ok: false, error: String((e as Error).message ?? e), seconds: Math.round((Date.now() - t0) / 1000) };
  }
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(name, JSON.stringify(result.checks[name]).slice(0, 400));
}

await step('red', async () => {
  const key = process.env.HELIUS_API_KEY;
  const out: any = { heliusKey: key ? 'presente' : 'FALTA HELIUS_API_KEY' };
  for (const [n, u] of [['defillama', 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue'], ['hypurrscan', 'https://api.hypurrscan.io/fees'], ['precios', 'https://coins.llama.fi/prices/current/coingecko:solana']]) {
    try { await json(u); out[n] = 'ok'; } catch (e) { out[n] = String((e as Error).message); }
  }
  if (key) {
    try {
      const h: any = await json(`https://mainnet.helius-rpc.com/?api-key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }) });
      out.helius = h.result ?? JSON.stringify(h.error);
    } catch (e) { out.helius = String((e as Error).message); }
  }
  return out;
});

await step('hyperliquid', async () => {
  const pts: any[] = await json('https://api.hypurrscan.io/fees');
  pts.sort((a, b) => a.time - b.time);
  const near = (ts: number) => pts.reduce((b, p) => (Math.abs(p.time - ts) < Math.abs(b.time - ts) ? p : b));
  const a = near(yesterday), b = near(today);
  const ours = ((b.total_fees - a.total_fees) / 1e6) * 0.99 * (86400 / (b.time - a.time));
  const llama = await llamaDay('hyperliquid', yesterday);
  const last = pts.at(-1);
  return { ayerNuestro: Math.round(ours), ayerDefiLlama: llama, ratio: llama ? +(ours / llama).toFixed(3) : null, puntos: [a.time, b.time, last.time], ultimoPuntoHaceMin: Math.round((now - last.time) / 60) };
});

for (const [id, slug] of [['gmgnai', 'gmgn'], ['axiom', 'axiom-pro']] as const) {
  await step(`${id}_ayer`, async () => {
    const r = await solanaWindowRevenue(SOLANA_SPECS[id], today, 86400);
    const llama = await llamaDay(slug, yesterday);
    return { revenue: Math.round(r.revenueUsd), fees: Math.round(r.feesUsd), pagos: Math.round(r.payoutsUsd), defillama: llama, ratio: llama ? +(r.revenueUsd / llama).toFixed(3) : null, transacciones: r.transactions, creditos: r.credits, solPrice: r.solPrice, porWallet: r.byAddress };
  });
  await step(`${id}_hoy`, async () => {
    const r = await solanaWindowRevenue(SOLANA_SPECS[id], now, now - today);
    return { horasTranscurridas: +((now - today) / 3600).toFixed(1), revenue: Math.round(r.revenueUsd), fees: Math.round(r.feesUsd), pagos: Math.round(r.payoutsUsd), transacciones: r.transactions, creditos: r.credits };
  });
}

console.log('FIN', outPath);
process.exit(0);
