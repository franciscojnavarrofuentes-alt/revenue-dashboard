/**
 * Prueba de coste de Helius antes de activar la recogida:
 *   npm run probe:solana -- axiom 1     → mide la última hora completa de Axiom
 *   npm run probe:solana -- gmgn 1
 * Muestra transacciones, créditos gastados, revenue y la proyección mensual de créditos.
 */
import { SOLANA_SPECS } from './config.js';
import { solanaWindowRevenue } from './collectors/solana.js';

const [id, hoursArg] = process.argv.slice(2);
const hours = Number(hoursArg ?? 1);
const spec = SOLANA_SPECS[id];
if (!spec) {
  console.error(`Uso: npm run probe:solana -- <${Object.keys(SOLANA_SPECS).join('|')}> [horas]`);
  process.exit(1);
}

const end = Math.floor(Date.now() / 1000 / 3600) * 3600; // última hora en punto
const t0 = Date.now();
const r = await solanaWindowRevenue(spec, end, hours * 3600);
const secs = (Date.now() - t0) / 1000;
const perMonth = r.credits * (24 / hours) * 30;

console.log(`
${id} · ${new Date((end - hours * 3600) * 1000).toISOString()} → ${new Date(end * 1000).toISOString()}
  transacciones:   ${r.transactions}
  fees:            $${r.feesUsd.toFixed(0)}
  pagos:           $${r.payoutsUsd.toFixed(0)}
  revenue:         $${r.revenueUsd.toFixed(0)}   (≈ $${(r.revenueUsd * 24 / hours).toFixed(0)} al día)
  precio SOL:      $${r.solPrice.toFixed(2)}
  créditos Helius: ${r.credits}  →  proyección ${Math.round(perMonth).toLocaleString('es-ES')} créditos/mes
  tiempo:          ${secs.toFixed(0)} s
`);
process.exit(0);
