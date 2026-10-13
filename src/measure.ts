/**
 * Medición unificada: dado un conjunto de hijos y ventanas [from, to), devuelve el revenue de cada uno
 * con el método que le toca (adapter de DefiLlama, Solana/Helius, Hypurrscan o devengo).
 */
import { db, now } from './db.js';
import { runAdapterJobs, type AdapterJob } from './methods/adapters.js';
import { hypurrscanRevenue } from './methods/hypurrscan.js';
import { solanaWindowRevenue } from './methods/solana.js';
import { MODULE_OVERRIDES, SOLANA_SPECS } from './methods/specs.js';

export type Target = {
  child: string; method: string; adapter_type: string | null; module: string | null; llama_rev24h: number | null;
  /** chains que no se pueden medir (detectadas en la calibración) */
  skip_chains?: string[] | null;
};
export type Measurement = { ok: boolean; revenue?: number; error?: string; failedChains?: { chain: string; error: string }[] };
export type MeasureOpts = { hypurrscanTolerance?: number; perChain?: boolean };
export const mkey = (child: string, from: number, to: number) => `${child}|${from}|${to}`;

/** Todas las combinaciones hijo × ventana */
export function measure(targets: Target[], windows: [number, number][], opts: MeasureOpts = {}) {
  return measurePairs(targets.flatMap(t => windows.map(([from, to]) => ({ target: t, from, to }))), opts);
}

/** Pares concretos (hijo, ventana). Todos los adapters van en un único proceso por lotes. */
export async function measurePairs(pairs: { target: Target; from: number; to: number }[], opts: MeasureOpts = {}) {
  const out = new Map<string, Measurement>();
  const jobs: AdapterJob[] = [];

  for (const { target: t, from, to } of pairs) {
    {
      const k = mkey(t.child, from, to);
      try {
        switch (t.method) {
          case 'adapter':
            if (!t.module) throw new Error('sin módulo');
            jobs.push({ key: k, type: t.adapter_type ?? 'fees', module: t.module, from, to, skipChains: t.skip_chains ?? undefined, perChain: opts.perChain });
            break;
          case 'accrual':
            // reparte el último dato diario de DefiLlama de forma uniforme
            out.set(k, { ok: true, revenue: (t.llama_rev24h ?? 0) * (to - from) / 86400 });
            break;
          case 'hypurrscan':
            out.set(k, { ok: true, revenue: hypurrscanRevenue(from, to, opts.hypurrscanTolerance) });
            break;
          case 'solana': {
            const ov = t.module ? MODULE_OVERRIDES[t.module] : undefined;
            const spec = ov && ov.method === 'solana' ? SOLANA_SPECS[ov.spec] : undefined;
            if (!spec) throw new Error(`sin especificación Solana para ${t.module}`);
            const r = await solanaWindowRevenue(spec, to, to - from);
            db.prepare('INSERT INTO helius_usage (child, window_end, transactions, credits, at) VALUES (?, ?, ?, ?, ?)')
              .run(t.child, to, r.transactions, r.credits, now());
            out.set(k, { ok: true, revenue: r.revenueUsd });
            break;
          }
          default:
            out.set(k, { ok: false, error: `método ${t.method} no mide por ventanas` });
        }
      } catch (e) {
        out.set(k, { ok: false, error: String((e as Error).message ?? e) });
      }
    }
  }

  if (jobs.length) {
    const res = await runAdapterJobs(jobs);
    for (const [k, r] of res) {
      if (!r.ok) out.set(k, { ok: false, error: r.error });
      else if (r.revenue === null || r.revenue === undefined) out.set(k, { ok: false, error: 'el adapter no devuelve dailyRevenue' });
      else out.set(k, { ok: true, revenue: r.revenue, failedChains: r.failedChains });
    }
  }
  return out;
}
