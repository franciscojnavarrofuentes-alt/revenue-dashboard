/**
 * Ejecuta muchos adapters de DefiLlama (dimension-adapters) en UN solo proceso, con ventanas arbitrarias.
 * Se lanza con cwd = vendor/dimension-adapters para que resuelva sus dependencias:
 *
 *   ts-node --transpile-only --project tsconfig.json ../../scripts/run-batch.ts jobs.json results.jsonl
 *
 * jobs.json:  [{ "key": "uniswap-v3|1791900000", "type": "fees", "module": "uniswap-v3", "from": 1791896400, "to": 1791900000 }]
 * results.jsonl: una línea por job { key, ok, revenue, fees, chains, failedChains, error, ms }
 *   revenue = suma de dailyRevenue de todas las chains (null si el adapter no reporta revenue)
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const CONCURRENCY = Number(process.env.BATCH_CONCURRENCY ?? 4);
const JOB_TIMEOUT_MS = Number(process.env.BATCH_JOB_TIMEOUT_MS ?? 180_000);

type Job = {
  key: string; type: string; module: string; from: number; to: number;
  /** chains a omitir (p. ej. las que dependen de Dune), detectadas en la calibración */
  skipChains?: string[];
  /** si el adapter falla entero, reintentar chain a chain y sumar las que funcionen */
  perChain?: boolean;
};

async function main() {
  const [jobsPath, outPath] = process.argv.slice(2);
  if (!jobsPath || !outPath) throw new Error('uso: run-batch <jobs.json> <results.jsonl>');
  const jobs: Job[] = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const cwd = process.cwd();

  // Allium solo lo usa pumpdotfun para la recompra de PUMP (no es revenue): sin clave devolvemos vacío
  if (!process.env.ALLIUM_API_KEY) {
    try { require(path.join(cwd, 'helpers/allium')).queryAllium = async () => [{}]; } catch { /* sin helper */ }
  }

  const runAdapter = require(path.join(cwd, 'adapters/utils/runAdapter')).default;
  const { importAdapter } = require(path.join(cwd, 'adapters/utils/importAdapter'));
  const out = fs.createWriteStream(outPath, { flags: 'w' });
  const cache = new Map<string, any>();

  async function load(type: string, module: string) {
    const k = `${type}/${module}`;
    if (!cache.has(k)) {
      cache.set(k, importAdapter(type, module, path.join(cwd, type, module)).then((r: any) => r.adapter));
    }
    return cache.get(k);
  }

  const withTimeout = <T,>(p: Promise<T>) => Promise.race([
    p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS)),
  ]);

  async function runOnce(adapter: any, job: Job, opts: { deadChains?: Set<string>; onlyChains?: Set<string> }) {
    const response: any[] = await withTimeout(runAdapter({
      module: adapter, endTimestamp: job.to, runWindowInSeconds: job.to - job.from, name: job.module, ...opts,
    }));
    let revenue: number | null = null, fees: number | null = null;
    const chains: Record<string, number> = {};
    for (const r of response ?? []) {
      if (r.dailyRevenue !== undefined && r.dailyRevenue !== null) {
        revenue = (revenue ?? 0) + Number(r.dailyRevenue);
        chains[r.chain] = Number(r.dailyRevenue);
      }
      if (r.dailyFees !== undefined && r.dailyFees !== null) fees = (fees ?? 0) + Number(r.dailyFees);
    }
    return { revenue, fees, chains };
  }

  async function runJob(job: Job) {
    const t0 = Date.now();
    const deadChains = new Set(job.skipChains ?? []);
    let adapter: any;
    try {
      adapter = await load(job.type, job.module);
      const r = await runOnce(adapter, job, { deadChains });
      out.write(JSON.stringify({ key: job.key, ok: true, ...r, failedChains: [], ms: Date.now() - t0 }) + '\n');
      return;
    } catch (e: any) {
      const msg = String(e?.message ?? e).split('\n')[0].slice(0, 400);
      if (!job.perChain || !adapter?.adapter) {
        out.write(JSON.stringify({ key: job.key, ok: false, error: msg, ms: Date.now() - t0 }) + '\n');
        return;
      }
      // Reintento chain a chain: un adapter multichain falla entero si una sola chain usa Dune o su RPC falla
      const all = Object.keys(adapter.adapter).filter(c => !deadChains.has(c));
      let revenue: number | null = null, fees: number | null = null;
      const chains: Record<string, number> = {};
      const failed: { chain: string; error: string }[] = [];
      for (const c of all) {
        try {
          const r = await runOnce(adapter, job, { onlyChains: new Set([c]) });
          if (r.revenue !== null) revenue = (revenue ?? 0) + r.revenue;
          if (r.fees !== null) fees = (fees ?? 0) + r.fees;
          Object.assign(chains, r.chains);
        } catch (ce: any) {
          failed.push({ chain: c, error: String(ce?.message ?? ce).split('\n')[0].slice(0, 160) });
        }
      }
      // éxito parcial solo si alguna chain dio revenue (las que no tienen datos en la ventana no cuentan)
      const ok = revenue !== null && failed.length < all.length;
      out.write(JSON.stringify({ key: job.key, ok, revenue, fees, chains, failedChains: failed, error: ok ? undefined : msg, ms: Date.now() - t0 }) + '\n');
    }
  }

  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      await runJob(job);
    }
  });
  await Promise.all(workers);
  await new Promise(r => out.end(r));
}

process.on('unhandledRejection', () => { /* los errores de cada job ya se registran */ });

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
