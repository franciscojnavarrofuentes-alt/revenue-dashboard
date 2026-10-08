import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VENDOR_DIR, WINDOW_SECONDS } from '../config.js';

const RUNNER = path.join(ROOT, 'scripts', 'run-adapter.ts');
const TIMEOUT_MS = 10 * 60_000;

export type AdapterResult = { revenue: number; fees: number; byChain: Record<string, number> };

export async function adapterWindowRevenue(adapterPath: string, windowEnd: number): Promise<AdapterResult> {
  const tsNode = path.join(VENDOR_DIR, 'node_modules', '.bin', 'ts-node');
  if (!fs.existsSync(tsNode)) {
    throw new Error('Faltan los adapters de DefiLlama: ejecuta `npm run setup:adapters`');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(tsNode, ['--transpile-only', '--project', 'tsconfig.json', RUNNER, adapterPath, String(windowEnd), String(WINDOW_SECONDS)], {
      cwd: VENDOR_DIR,
      env: process.env,
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout ejecutando ${adapterPath}`)); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', () => {
      clearTimeout(timer);
      const ok = out.match(/__RESULT__(.+)/);
      if (ok) return resolve(JSON.parse(ok[1]));
      const fail = out.match(/__ERROR__(.+)/);
      const msg = fail ? JSON.parse(fail[1]).message : (err.trim().split('\n').slice(-5).join(' | ') || 'sin salida');
      reject(new Error(`${adapterPath}: ${msg}`));
    });
  });
}
