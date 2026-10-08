import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH ?? path.join(DATA_DIR, 'revenue.db'));

db.exec(`
PRAGMA journal_mode = WAL;

-- Ranking de DefiLlama (dato diario) en cada ejecución
CREATE TABLE IF NOT EXISTS llama_snapshot (
  fetched_at INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT,
  rev24h     REAL,
  rev7d      REAL,
  rev30d     REAL,
  change1d   REAL,
  PRIMARY KEY (fetched_at, key)
);

-- Revenue diario de DefiLlama de los protocolos seguidos (para calibrar)
CREATE TABLE IF NOT EXISTS llama_daily (
  protocol TEXT NOT NULL,
  day      INTEGER NOT NULL,
  revenue  REAL NOT NULL,
  PRIMARY KEY (protocol, day)
);

-- Revenue propio por ventana de 8h y fuente
CREATE TABLE IF NOT EXISTS windows (
  protocol     TEXT NOT NULL,
  source       TEXT NOT NULL,
  window_end   INTEGER NOT NULL,
  window_hours INTEGER NOT NULL,
  revenue      REAL NOT NULL,
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (protocol, source, window_end)
);

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol   TEXT,
  source     TEXT,
  window_end INTEGER,
  ok         INTEGER NOT NULL,
  error      TEXT,
  at         INTEGER NOT NULL
);

-- Consumo de Helius por ventana (para vigilar el límite del plan)
CREATE TABLE IF NOT EXISTS helius_usage (
  protocol     TEXT NOT NULL,
  source       TEXT NOT NULL,
  window_end   INTEGER NOT NULL,
  transactions INTEGER NOT NULL,
  credits      INTEGER NOT NULL,
  at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  protocol   TEXT NOT NULL,
  window_end INTEGER NOT NULL,
  rule       TEXT NOT NULL,
  value      REAL NOT NULL,
  baseline   REAL,
  score      REAL,
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (protocol, window_end, rule)
);
`);

export const now = () => Math.floor(Date.now() / 1000);

export function logRun(protocol: string | null, source: string | null, windowEnd: number | null, ok: boolean, error?: string) {
  db.prepare('INSERT INTO runs (protocol, source, window_end, ok, error, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(protocol, source, windowEnd, ok ? 1 : 0, error ?? null, now());
}

export function hasWindow(protocol: string, source: string, windowEnd: number): boolean {
  return !!db.prepare('SELECT 1 FROM windows WHERE protocol = ? AND source = ? AND window_end = ?').get(protocol, source, windowEnd);
}

export function saveWindow(protocol: string, source: string, windowEnd: number, windowHours: number, revenue: number) {
  db.prepare(`INSERT INTO windows (protocol, source, window_end, window_hours, revenue, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (protocol, source, window_end) DO UPDATE SET revenue = excluded.revenue, fetched_at = excluded.fetched_at`)
    .run(protocol, source, windowEnd, windowHours, revenue, now());
}

export type WindowTotal = { window_end: number; revenue: number };

/** Revenue total por ventana, solo con ventanas en las que todas las fuentes tienen dato */
export function protocolWindows(protocol: string, sourceCount: number, sinceTs = 0): WindowTotal[] {
  return db.prepare(`SELECT window_end, SUM(revenue) AS revenue
                     FROM windows WHERE protocol = ? AND window_end >= ?
                     GROUP BY window_end HAVING COUNT(*) = ?
                     ORDER BY window_end`)
    .all(protocol, sinceTs, sourceCount) as WindowTotal[];
}

export function failCount(protocol: string, source: string, windowEnd: number): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM runs WHERE protocol = ? AND source = ? AND window_end = ? AND ok = 0')
    .get(protocol, source, windowEnd) as { n: number };
  return r.n;
}

export function logHeliusUsage(protocol: string, source: string, windowEnd: number, transactions: number, credits: number) {
  db.prepare('INSERT INTO helius_usage (protocol, source, window_end, transactions, credits, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(protocol, source, windowEnd, transactions, credits, now());
}
