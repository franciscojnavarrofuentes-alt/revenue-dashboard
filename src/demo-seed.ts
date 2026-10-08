// Datos simulados para ver el dashboard sin conexión: DB_PATH=data/demo.db npm run demo:seed && DB_PATH=data/demo.db npm run serve
import { TRACKED, WINDOW_SECONDS } from './config.js';
import { db, now, saveWindow } from './db.js';
import { evaluate, processAlerts } from './alerts.js';
import { lastClosedWindowEnd } from './windows.js';
const base: Record<string, number> = { hyperliquid: 640000, pump: 850000, axiom: 220000, gmgn: 190000 };
const last = lastClosedWindowEnd(now(), 2);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const p of TRACKED) {
  for (let i = 41; i >= 0; i--) {
    const end = last - i * WINDOW_SECONDS;
    const hour = new Date(end * 1000).getUTCHours();
    const season = hour === 16 ? 1.25 : hour === 0 ? 0.85 : 0.9;
    let v = base[p.id] * season * (0.85 + rnd() * 0.3);
    if (i === 0 && p.id === 'pump') v *= 2.4; // pico para probar alertas
    if (i === 0 && p.id === 'gmgn') v *= 0.4;
    const share = 1 / p.sources.length;
    for (const s of p.sources) saveWindow(p.id, s.id, end, 8, v * share);
  }
  for (let d = 13; d >= 1; d--) {
    const day = Math.floor(now() / 86400) * 86400 - d * 86400;
    const ours = (db.prepare('SELECT SUM(revenue) s FROM windows WHERE protocol=? AND window_end>? AND window_end<=?').get(p.id, day, day + 86400) as any).s;
    if (ours) db.prepare('INSERT OR REPLACE INTO llama_daily VALUES (?,?,?)').run(p.id, day, ours / (p.id === 'pump' ? 0.93 : 0.99));
  }
  console.log(p.id, evaluate(p, last).map(a => `${a.rule} ${a.score.toFixed(1)}`));
  await processAlerts(p, last);
}
const top = [['Tether','Stablecoin Issuer',17.46e6,121.31e6,512.04e6,-1.2],['Circle','Stablecoin Issuer',7.09e6,49.28e6,209.58e6,0.4],['Pump','Launchpad',2.74e6,18.64e6,60.7e6,6.9],['Hyperliquid','Derivatives',1.92e6,14.12e6,72.55e6,-3.1],['Tron','Chain',890063,5.81e6,23.98e6,1.1],['fomo','Trading App',726462,5.41e6,28.55e6,-8.4],['Axiom Pro','Trading App',686760,4.54e6,18.84e6,2.2],['Grayscale','RWA',621607,4.31e6,17.94e6,0],['GMGN','Trading App',583565,4.71e6,30.74e6,-12.5],['Sky','CDP',455409,3.12e6,13.48e6,0.8]];
top.forEach((r, i) => db.prepare('INSERT INTO llama_snapshot VALUES (?,?,?,?,?,?,?,?,?)').run(now(), i + 1, String(r[0]), String(r[0]), String(r[1]), r[2], r[3], r[4], r[5]));
db.prepare('INSERT INTO runs (protocol, source, window_end, ok, error, at) VALUES (?,?,?,?,?,?)').run(null, 'test', null, 1, null, now());
