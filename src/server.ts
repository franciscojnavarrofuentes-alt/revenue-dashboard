import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, TRACKED, WINDOW_HOURS, WINDOW_SECONDS } from './config.js';
import { db, now, protocolWindows } from './db.js';

const PORT = Number(process.env.PORT ?? 3000);
const USER = process.env.DASHBOARD_USER;
const PASS = process.env.DASHBOARD_PASS;

function apiData() {
  const lastSnap = db.prepare('SELECT MAX(fetched_at) AS ts FROM llama_snapshot').get() as { ts: number | null };
  const ranking = lastSnap.ts
    ? db.prepare('SELECT rank, key, name, category, rev24h, rev7d, rev30d, change1d FROM llama_snapshot WHERE fetched_at = ? ORDER BY rank').all(lastSnap.ts)
    : [];

  const since = now() - 14 * 86400;
  const tracked = TRACKED.map(p => {
    const windows = protocolWindows(p.id, p.sources.length, since);
    const llamaDaily = db.prepare('SELECT day, revenue FROM llama_daily WHERE protocol = ? AND day >= ? ORDER BY day').all(p.id, since) as { day: number; revenue: number }[];

    // Calibración: suma de las 3 ventanas de cada día completo vs. el dato diario de DefiLlama
    const calibration = llamaDaily.map(d => {
      const ours = windows.filter(w => w.window_end > d.day && w.window_end <= d.day + 86400);
      return ours.length === 24 / WINDOW_HOURS
        ? { day: d.day, ours: ours.reduce((a, w) => a + w.revenue, 0), llama: d.revenue }
        : null;
    }).filter(Boolean);

    const lastError = db.prepare('SELECT source, error, at FROM runs WHERE protocol = ? AND ok = 0 AND at > ? ORDER BY at DESC LIMIT 1').get(p.id, now() - 86400);
    return { id: p.id, name: p.name, enabled: p.enabled, coverageNote: p.coverageNote, windows, llamaDaily, calibration, lastError: lastError ?? null };
  });

  const alerts = db.prepare('SELECT protocol, window_end, rule, value, baseline, score, message, created_at FROM alerts ORDER BY window_end DESC, created_at DESC LIMIT 50').all();
  const lastRun = db.prepare('SELECT MAX(at) AS at FROM runs WHERE ok = 1').get() as { at: number | null };
  const helius = db.prepare('SELECT COALESCE(SUM(credits), 0) AS credits30d FROM helius_usage WHERE at > ?').get(now() - 30 * 86400) as { credits30d: number };

  return { generatedAt: now(), windowHours: WINDOW_HOURS, windowSeconds: WINDOW_SECONDS, lastRun: lastRun.at, heliusCredits30d: helius.credits30d, rankingAt: lastSnap.ts, ranking, tracked, alerts };
}

function authorized(req: http.IncomingMessage): boolean {
  if (!USER || !PASS) return true;
  const header = req.headers.authorization ?? '';
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Basic' || !value) return false;
  return Buffer.from(value, 'base64').toString() === `${USER}:${PASS}`;
}

const indexPath = path.join(ROOT, 'public', 'index.html');

http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="revenue-dashboard"' }).end('Autenticación requerida');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(apiData()));
    } else if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(indexPath));
    } else {
      res.writeHead(404).end('No encontrado');
    }
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Error interno');
  }
}).listen(PORT, () => console.log(`Dashboard en http://localhost:${PORT}`));
