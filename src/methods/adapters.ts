/**
 * Ejecuta adapters de DefiLlama por lotes (scripts/run-batch.ts) dentro de vendor/dimension-adapters.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, VENDOR_DIR } from '../config.js';

export type AdapterJob = { key: string; type: string; module: string; from: number; to: number; skipChains?: string[]; perChain?: boolean };
export type AdapterResult = { key: string; ok: boolean; revenue?: number | null; fees?: number | null; failedChains?: { chain: string; error: string }[]; error?: string; ms?: number };

const RUNNER = path.join(ROOT, 'scripts', 'run-batch.ts');

export function adapterFileType(module: string): 'fees' | 'dexs' | null {
  for (const type of ['fees', 'dexs'] as const) {
    for (const f of [`${module}.ts`, `${module}.js`, path.join(module, 'index.ts'), path.join(module, 'index.js')]) {
      if (fs.existsSync(path.join(VENDOR_DIR, type, f))) return type;
    }
  }
  return null;
}

export function adapterSource(module: string, type: string): string | null {
  for (const f of [`${module}.ts`, `${module}.js`, path.join(module, 'index.ts'), path.join(module, 'index.js')]) {
    const p = path.join(VENDOR_DIR, type, f);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return null;
}

/** Ejecuta los jobs en un proceso; devuelve un resultado por job (los que no terminen salen como error) */
export async function runAdapterJobs(jobs: AdapterJob[], { timeoutMs = 45 * 60_000 } = {}): Promise<Map<string, AdapterResult>> {
  const results = new Map<string, AdapterResult>();
  if (!jobs.length) return results;
  const tsNode = path.join(VENDOR_DIR, 'node_modules', '.bin', 'ts-node');
  if (!fs.existsSync(tsNode)) throw new Error('Faltan los adapters de DefiLlama: ejecuta `npm run setup:adapters`');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-batch-'));
  const jobsPath = path.join(dir, 'jobs.json');
  const outPath = path.join(dir, 'results.jsonl');
  fs.writeFileSync(jobsPath, JSON.stringify(jobs));

  await new Promise<void>((resolve) => {
    const child = spawn(tsNode, ['--transpile-only', '--project', 'tsconfig.json', RUNNER, jobsPath, outPath], { cwd: VENDOR_DIR, env: process.env });
    let err = '';
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.stdout.on('data', () => { /* los adapters imprimen mucho: lo ignoramos */ });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) console.error(`[adapters] el runner terminó con código ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`);
      resolve();
    });
  });

  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); results.set(r.key, r); } catch { /* línea cortada */ }
    }
  }
  for (const j of jobs) if (!results.has(j.key)) results.set(j.key, { key: j.key, ok: false, error: 'no terminó (timeout del lote)' });
  fs.rmSync(dir, { recursive: true, force: true });
  return results;
}

/** Errores que indican que falta una clave o un servicio de pago */
export function looksLikeMissingKey(error = ''): boolean {
  return /is not set|api[_ -]?key|missing .*env|unauthori[sz]ed|\b401\b|\b402\b|payment required/i.test(error);
}
