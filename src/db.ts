import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH ?? path.join(DATA_DIR, 'revenue.db'));

db.exec(`
PRAGMA journal_mode = WAL;

-- Universo: protocolos padre del Top N de DefiLlama y sus protocolos hijo (cada hijo = un adapter)
CREATE TABLE IF NOT EXISTS universe (
  child        TEXT PRIMARY KEY,     -- id de DefiLlama del hijo (defillamaId)
  parent       TEXT NOT NULL,        -- clave del padre (parentProtocol o el propio id)
  parent_name  TEXT NOT NULL,
  child_name   TEXT NOT NULL,
  module       TEXT,                 -- nombre del adapter en dimension-adapters
  slug         TEXT,
  category     TEXT,
  parent_rank  INTEGER NOT NULL,
  llama_rev24h REAL,                 -- último día completo según DefiLlama
  updated_at   INTEGER NOT NULL
);

-- Cómo se mide cada hijo y si la calibración lo dio por bueno
CREATE TABLE IF NOT EXISTS plan (
  child         TEXT PRIMARY KEY,
  method        TEXT NOT NULL,       -- adapter | hypurrscan | solana | accrual | daily
  adapter_type  TEXT,                -- fees | dexs (para method=adapter)
  status        TEXT NOT NULL,       -- pending | live | daily_only | mismatch | error | needs_key | estimate | skip
  ratio         REAL,                -- nuestro ayer / DefiLlama ayer
  note          TEXT,
  skip_chains   TEXT,                -- JSON: chains que fallan en la calibración y se omiten
  calibrated_at INTEGER
);

-- Revenue medido por hora (hour_end = fin de la hora, UTC)
CREATE TABLE IF NOT EXISTS hours (
  child      TEXT NOT NULL,
  hour_end   INTEGER NOT NULL,
  revenue    REAL NOT NULL,
  method     TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (child, hour_end)
);

-- Dato diario de DefiLlama por hijo (para comparar y para el método de devengo)
CREATE TABLE IF NOT EXISTS llama_daily (
  child   TEXT NOT NULL,
  day     INTEGER NOT NULL,
  revenue REAL NOT NULL,
  PRIMARY KEY (child, day)
);

CREATE TABLE IF NOT EXISTS runs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  child    TEXT,
  hour_end INTEGER,
  kind     TEXT NOT NULL,            -- hour | calibrate | discover | snapshot
  ok       INTEGER NOT NULL,
  error    TEXT,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_child ON runs (child, hour_end, ok);

CREATE TABLE IF NOT EXISTS helius_usage (
  child        TEXT NOT NULL,
  window_end   INTEGER NOT NULL,
  transactions INTEGER NOT NULL,
  credits      INTEGER NOT NULL,
  at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  parent     TEXT NOT NULL,
  rule       TEXT NOT NULL,
  value      REAL NOT NULL,
  baseline   REAL,
  score      REAL,
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified   INTEGER NOT NULL DEFAULT 0
);
`);

try { db.exec('ALTER TABLE plan ADD COLUMN skip_chains TEXT'); } catch { /* ya existe */ }

export const now = () => Math.floor(Date.now() / 1000);

export type UniverseRow = {
  child: string; parent: string; parent_name: string; child_name: string; module: string | null;
  slug: string | null; category: string | null; parent_rank: number; llama_rev24h: number | null;
};
export type PlanRow = {
  child: string; method: string; adapter_type: string | null; status: string; ratio: number | null; note: string | null;
  skip_chains: string | null;
};

export function logRun(child: string | null, hourEnd: number | null, kind: string, ok: boolean, error?: string) {
  db.prepare('INSERT INTO runs (child, hour_end, kind, ok, error, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(child, hourEnd, kind, ok ? 1 : 0, error ?? null, now());
}

export function failCount(child: string, hourEnd: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM runs WHERE child = ? AND hour_end = ? AND kind = 'hour' AND ok = 0")
    .get(child, hourEnd) as { n: number }).n;
}

export function saveHour(child: string, hourEnd: number, revenue: number, method: string) {
  db.prepare(`INSERT INTO hours (child, hour_end, revenue, method, fetched_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (child, hour_end) DO UPDATE SET revenue = excluded.revenue, method = excluded.method, fetched_at = excluded.fetched_at`)
    .run(child, hourEnd, revenue, method, now());
}

export function hasHour(child: string, hourEnd: number): boolean {
  return !!db.prepare('SELECT 1 FROM hours WHERE child = ? AND hour_end = ?').get(child, hourEnd);
}

export function setPlan(p: { child: string; method: string; adapter_type?: string | null; status: string; ratio?: number | null; note?: string | null; skipChains?: string[] | null; calibrated?: boolean }) {
  db.prepare(`INSERT INTO plan (child, method, adapter_type, status, ratio, note, skip_chains, calibrated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (child) DO UPDATE SET method = excluded.method, adapter_type = excluded.adapter_type, status = excluded.status,
                ratio = excluded.ratio, note = excluded.note, skip_chains = excluded.skip_chains,
                calibrated_at = COALESCE(excluded.calibrated_at, plan.calibrated_at)`)
    .run(p.child, p.method, p.adapter_type ?? null, p.status, p.ratio ?? null, p.note ?? null,
         p.skipChains?.length ? JSON.stringify(p.skipChains) : null, p.calibrated ? now() : null);
}

export function universe(): (UniverseRow & Partial<PlanRow>)[] {
  return db.prepare(`SELECT u.*, p.method, p.adapter_type, p.status, p.ratio, p.note, p.skip_chains
                     FROM universe u LEFT JOIN plan p ON p.child = u.child
                     ORDER BY u.parent_rank, u.llama_rev24h DESC`).all() as any;
}
