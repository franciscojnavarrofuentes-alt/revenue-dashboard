/**
 * Tests sin red: agrupación del universo, veredicto de calibración, vista de hoy y alertas.
 *   npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-test-')), 'test.db');
const { db, saveHour, setPlan } = await import('./db.js');
const { buildUniverse } = await import('./discover.js');
const { verdict } = await import('./calibrate.js');
const { computeToday } = await import('./today.js');
const { evaluate } = await import('./alerts.js');

const DAYS = 86400, H = 3600;

test('buildUniverse agrupa hijos por padre y ordena por revenue', () => {
  const rows = buildUniverse([
    { defillamaId: '1', name: 'pump.fun', parentProtocol: 'parent#pump', linkedProtocols: ['Pump', 'pump.fun'], module: 'pumpdotfun', total24h: 2_000_000 },
    { defillamaId: '2', name: 'PumpSwap', parentProtocol: 'parent#pump', linkedProtocols: ['Pump', 'PumpSwap'], module: 'pump-swap', total24h: 500_000 },
    { defillamaId: '3', name: 'Tether', module: 'tether', category: 'Stablecoin Issuer', total24h: 17_000_000 },
    { defillamaId: '4', name: 'Tiny', module: 'tiny', total24h: 10 },
  ], 2);
  assert.deepEqual([...new Set(rows.map(r => r.parent_name))], ['Tether', 'Pump']);
  assert.equal(rows.filter(r => r.parent_name === 'Pump').length, 2);
  assert.equal(rows.find(r => r.child === '1')!.parent_rank, 2);
});

test('verdict: en vivo, solo diario, no cuadra, falta clave', () => {
  const ok = (revenue: number) => ({ ok: true, revenue });
  assert.equal(verdict(ok(100_000), 105_000, ok(4000), ok(4500)).status, 'live');
  assert.equal(verdict(ok(100_000), 105_000, ok(100_000), ok(100_000)).status, 'daily_only');
  assert.equal(verdict(ok(50_000), 105_000, ok(2000), ok(2000)).status, 'mismatch');
  assert.equal(verdict({ ok: false, error: 'FRED_API_KEY is not set' }, 100, ok(1), ok(1)).status, 'needs_key');
  assert.equal(verdict({ ok: false, error: 'Request failed with status code 500' }, 100, ok(1), ok(1)).status, 'error');
  assert.equal(verdict(ok(100_000), 100_000, { ok: false, error: 'x' }, ok(1)).status, 'daily_only');
});

test('computeToday suma horas en vivo, estima devengos y compara con ayer', () => {
  const nowTs = 1_791_900_000 - (1_791_900_000 % DAYS) + 10 * H + 15 * 60; // 10:15 UTC
  const day0 = nowTs - (nowTs % DAYS);
  const ins = db.prepare(`INSERT INTO universe (child, parent, parent_name, child_name, module, slug, category, parent_rank, llama_rev24h, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('a1', 'pA', 'Alpha', 'Alpha v1', 'alpha', 'alpha', 'Dexs', 1, 240_000, nowTs);
  ins.run('t1', 'pT', 'Tether', 'Tether', 'tether', 'tether', 'Stablecoin Issuer', 2, 2_400_000, nowTs);
  ins.run('d1', 'pD', 'Dune Co', 'Dune Co', 'duneco', 'duneco', 'Dexs', 3, 100_000, nowTs);
  setPlan({ child: 'a1', method: 'adapter', adapter_type: 'dexs', status: 'live', ratio: 1 });
  setPlan({ child: 't1', method: 'accrual', status: 'estimate' });
  setPlan({ child: 'd1', method: 'adapter', status: 'needs_key' });
  // Alpha: 10 horas hoy a $20K (el doble que ayer, $10K/h)
  for (let h = 1; h <= 10; h++) { saveHour('a1', day0 + h * H, 20_000, 'adapter'); saveHour('a1', day0 - DAYS + h * H, 10_000, 'adapter'); }

  const v = computeToday(nowTs);
  const a = v.parents.find(p => p.name === 'Alpha')!;
  const t = v.parents.find(p => p.name === 'Tether')!;
  const d = v.parents.find(p => p.name === 'Dune Co')!;
  assert.equal(a.status, 'live');
  assert.equal(a.today, 200_000);
  assert.equal(a.hoursMissing, 0);
  assert.equal(Math.round(a.vsYesterday! * 100), 100);
  assert.equal(t.status, 'estimate');
  assert.ok(Math.abs(t.today - 2_400_000 * (10.25 / 24)) < 1);
  assert.equal(d.status, 'daily');
  assert.equal(d.today, 0);

  const alerts = evaluate(v.parents, nowTs, v.summary.hoursElapsed);
  assert.ok(alerts.some(x => x.rule === 'hoy_vs_ayer' && x.parent === 'pA'), 'alerta de acumulado');
  assert.ok(!alerts.some(x => x.parent === 'pT'), 'los estimados no alertan');
});

test('día incompleto: no proyecta ni alerta', () => {
  const nowTs = 1_791_900_000 - (1_791_900_000 % DAYS) + 10 * H + 15 * 60;
  db.prepare("DELETE FROM hours WHERE child = 'a1' AND hour_end <= ?").run(nowTs - (nowTs % DAYS) + 5 * H); // faltan las 5 primeras horas
  db.prepare("DELETE FROM hours WHERE child = 'a1' AND hour_end <= ? AND hour_end > ?").run(nowTs - (nowTs % DAYS), nowTs - (nowTs % DAYS) - DAYS);
  const v = computeToday(nowTs);
  const a = v.parents.find(p => p.name === 'Alpha')!;
  assert.equal(a.hoursMissing, 5);
  assert.equal(a.pace24h, null);
  assert.equal(a.vsYesterday, null);
  assert.ok(!evaluate(v.parents, nowTs, v.summary.hoursElapsed).some(x => x.rule === 'hoy_vs_ayer'));
});
