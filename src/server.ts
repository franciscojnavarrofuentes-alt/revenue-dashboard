import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT } from './config.js';
import { db, now } from './db.js';
import { computeToday, parentHours } from './today.js';

const PORT = Number(process.env.PORT ?? 3000);
const USER = process.env.DASHBOARD_USER;
const PASS = process.env.DASHBOARD_PASS;

function authorized(req: http.IncomingMessage): boolean {
  if (!USER || !PASS) return true;
  const [scheme, value] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Basic' && !!value && Buffer.from(value, 'base64').toString() === `${USER}:${PASS}`;
}

function apiToday() {
  const ts = now();
  const view = computeToday(ts);
  const alerts = db.prepare('SELECT id, parent, rule, value, baseline, score, message, created_at FROM alerts ORDER BY created_at DESC LIMIT 40').all();
  const lastRun = (db.prepare("SELECT MAX(at) AS t FROM runs WHERE kind = 'hour' AND ok = 1").get() as { t: number | null }).t;
  const helius = (db.prepare('SELECT COALESCE(SUM(credits), 0) AS c FROM helius_usage WHERE at > ?').get(ts - 30 * 86400) as { c: number }).c;
  const errors = db.prepare(`SELECT child, error, COUNT(*) AS n FROM runs WHERE kind = 'hour' AND ok = 0 AND at > ? GROUP BY child, error ORDER BY n DESC LIMIT 20`).all(ts - 6 * 3600);
  return { ...view, alerts, lastRun, heliusCredits30d: helius, recentErrors: errors };
}

const indexPath = path.join(ROOT, 'public', 'index.html');
const json = (res: http.ServerResponse, body: unknown) =>
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));

http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="revenue-dashboard"' }).end('Autenticación requerida');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/today') return json(res, apiToday());
    if (url.pathname === '/api/hours') return json(res, parentHours(url.searchParams.get('parent') ?? '', now()));
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(indexPath));
      return;
    }
    res.writeHead(404).end('No encontrado');
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Error interno');
  }
}).listen(PORT, () => console.log(`Dashboard en http://localhost:${PORT}`));
