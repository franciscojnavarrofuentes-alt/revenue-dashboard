// Datos de EJEMPLO para ver el dashboard sin red (no son cifras reales):
//   DB_PATH=data/demo.db npm run demo:seed && DB_PATH=data/demo.db npm run serve
import { DAY, HOUR, HOUR_LAG_MIN, hourEnd, startOfDayUTC } from './config.js';
import { db, now, saveHour, setPlan } from './db.js';

const t = now();
const day0 = startOfDayUTC(t);
const last = hourEnd(t - HOUR_LAG_MIN * 60);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const demo: [string, string, number, string, string][] = [
  // nombre, categoría, revenue diario, método, estado
  ['Ejemplo Stable A', 'Stablecoin Issuer', 17_400_000, 'accrual', 'estimate'],
  ['Ejemplo Stable B', 'Stablecoin Issuer', 7_000_000, 'accrual', 'estimate'],
  ['Ejemplo Perps', 'Derivatives', 1_800_000, 'hypurrscan', 'live'],
  ['Ejemplo Launchpad', 'Launchpad', 2_100_000, 'adapter', 'needs_key'],
  ['Ejemplo Chain', 'Chain', 600_000, 'adapter', 'live'],
  ['Ejemplo Bot A', 'Trading App', 430_000, 'solana', 'live'],
  ['Ejemplo Bot B', 'Trading App', 580_000, 'solana', 'live'],
  ['Ejemplo DEX', 'Dexs', 380_000, 'adapter', 'live'],
  ['Ejemplo Lending', 'Lending', 300_000, 'adapter', 'mismatch'],
  ['Ejemplo ETF', 'RWA', 590_000, 'accrual', 'estimate'],
  ['Ejemplo Wallet', 'Wallets', 220_000, 'adapter', 'live'],
  ['Ejemplo Prediction', 'Prediction Market', 440_000, 'adapter', 'daily_only'],
];

const ins = db.prepare(`INSERT OR REPLACE INTO universe (child, parent, parent_name, child_name, module, slug, category, parent_rank, llama_rev24h, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
demo.sort((a, b) => b[2] - a[2]).forEach(([name, cat, rev, method, status], i) => {
  const id = `demo-${i}`;
  ins.run(id, `p-${id}`, name, name, id, id, cat, i + 1, rev, t);
  setPlan({ child: id, method, status, ratio: status === 'live' ? 0.9 + rnd() * 0.2 : null, note: 'Dato de ejemplo' });
  if (status !== 'live') return;
  const boost = name === 'Ejemplo Bot B' ? 1.7 : name === 'Ejemplo DEX' ? 0.5 : 1;
  for (let he = day0 - DAY + HOUR; he <= last; he += HOUR) {
    const h = new Date(he * 1000).getUTCHours();
    const shape = 0.6 + 0.8 * Math.sin(((h + 6) / 24) * Math.PI) ** 2;
    const factor = he > day0 ? boost : 1;
    saveHour(id, he, (rev / 24) * shape * factor * (0.8 + rnd() * 0.4), method);
  }
});
db.prepare('INSERT INTO runs (child, hour_end, kind, ok, at) VALUES (NULL, ?, ?, 1, ?)').run(last, 'hour', t);
console.log('Datos de ejemplo cargados');
