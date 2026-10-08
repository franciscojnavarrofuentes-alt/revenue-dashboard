/**
 * Ejecuta un adapter de DefiLlama (dimension-adapters) para una ventana arbitraria.
 * Se lanza con cwd = vendor/dimension-adapters para que resuelva sus dependencias.
 *
 *   ts-node --transpile-only scripts/run-adapter.ts <ruta-adapter> <window_end_unix> <window_seconds>
 *
 * Imprime una línea `__RESULT__{json}` con el revenue en USD sumado por chains.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

async function main() {
  const [adapterPath, endArg, windowArg] = process.argv.slice(2);
  if (!adapterPath || !endArg || !windowArg) throw new Error('uso: run-adapter <adapter> <window_end> <window_seconds>');

  const cwd = process.cwd();

  // pumpdotfun solo usa Allium para la recompra de PUMP (dailyHoldersRevenue), que no medimos:
  // sin ALLIUM_API_KEY devolvemos una fila vacía en vez de tumbar todo el adapter.
  const ALLIUM_OPTIONAL = ['fees/pumpdotfun.ts'];
  if (!process.env.ALLIUM_API_KEY && ALLIUM_OPTIONAL.includes(adapterPath)) {
    require(path.join(cwd, 'helpers/allium')).queryAllium = async () => [{}];
  }
  const runAdapter = require(path.join(cwd, 'adapters/utils/runAdapter')).default;
  const mod = require(path.join(cwd, adapterPath));
  const module = mod.default ?? mod;

  const response: any[] = await runAdapter({
    module,
    endTimestamp: Number(endArg),
    runWindowInSeconds: Number(windowArg),
    name: adapterPath,
  });

  const byChain: Record<string, number> = {};
  let revenue = 0;
  let fees = 0;
  for (const r of response) {
    const rev = Number(r.dailyRevenue ?? 0);
    byChain[r.chain] = rev;
    revenue += rev;
    fees += Number(r.dailyFees ?? 0);
  }
  process.stdout.write(`\n__RESULT__${JSON.stringify({ revenue, fees, byChain })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    process.stdout.write(`\n__ERROR__${JSON.stringify({ message: String(e?.message ?? e) })}\n`);
    process.exit(1);
  });
