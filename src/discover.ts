/**
 * Universo: Top N protocolos por revenue de DefiLlama (agrupados por padre, como defillama.com/revenue),
 * sus protocolos hijo y el método con el que se medirá cada uno.
 *
 *   npm run discover            → actualiza universo y plan (no borra calibraciones previas)
 */
import { CALIBRATION, DUNE_ENABLED, TOP_N } from './config.js';
import { db, logRun, now, setPlan, type UniverseRow } from './db.js';
import { adapterFileType, adapterSource } from './methods/adapters.js';
import { ACCRUAL_CATEGORIES, ACCRUAL_MARKERS, MODULE_OVERRIDES, PARENT_OVERRIDES } from './methods/specs.js';

const OVERVIEW = 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue';

export type Child = Omit<UniverseRow, 'parent_rank'> & { parent_rank?: number };

/** Agrupa la respuesta de /overview/fees en padres y devuelve los hijos de los Top N padres */
export function buildUniverse(protocols: any[], topN: number): UniverseRow[] {
  const groups = new Map<string, { name: string; total: number; children: Child[] }>();
  for (const p of protocols) {
    const isChild = typeof p.parentProtocol === 'string' && p.parentProtocol.length > 0;
    const parent = isChild ? p.parentProtocol : `id#${p.defillamaId ?? p.id ?? p.slug ?? p.name}`;
    const parentName = isChild ? String(p.linkedProtocols?.[0] ?? p.parentProtocol.replace(/^parent#/, '')) : String(p.displayName ?? p.name);
    const rev = Number(p.total24h ?? 0) || 0;
    const g = groups.get(parent) ?? { name: parentName, total: 0, children: [] };
    g.total += rev;
    g.children.push({
      child: String(p.defillamaId ?? p.id ?? p.slug ?? p.name),
      parent, parent_name: parentName,
      child_name: String(p.displayName ?? p.name),
      module: p.module ? String(p.module) : null,
      slug: p.slug ? String(p.slug) : null,
      category: p.category ? String(p.category) : null,
      llama_rev24h: rev,
    });
    groups.set(parent, g);
  }
  const top = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, topN);
  return top.flatMap((g, i) => g.children.map(c => ({ ...c, parent_rank: i + 1 })));
}

/** Decide el método inicial de cada hijo. No pisa una calibración si el método no cambia. */
export function classify(rows: UniverseRow[]) {
  const byParent = new Map<string, UniverseRow[]>();
  for (const r of rows) byParent.set(r.parent, [...(byParent.get(r.parent) ?? []), r]);
  const existing = new Map((db.prepare('SELECT child, method, status FROM plan').all() as any[]).map(p => [p.child, p]));
  const counts: Record<string, number> = {};

  const put = (child: string, method: string, status: string, note: string, adapter_type: string | null = null) => {
    const prev = existing.get(child);
    // conserva el estado calibrado si el método sigue siendo el mismo
    if (prev && prev.method === method && prev.status !== 'pending' && !['needs_key', 'daily_only', 'skip', 'estimate'].includes(status)) return;
    setPlan({ child, method, adapter_type, status, note });
    counts[status] = (counts[status] ?? 0) + 1;
  };

  for (const [, children] of byParent) {
    const sorted = [...children].sort((a, b) => (b.llama_rev24h ?? 0) - (a.llama_rev24h ?? 0));
    const parentOv = PARENT_OVERRIDES[sorted[0].parent_name.toLowerCase()];
    sorted.forEach((c, i) => {
      if (parentOv) {
        if (i === 0) put(c.child, parentOv.method, 'pending', parentOv.note);
        else put(c.child, 'skip', 'skip', `Incluido en la medición de ${c.parent_name}`);
        return;
      }
      const modOv = c.module ? MODULE_OVERRIDES[c.module] : undefined;
      if (modOv) return put(c.child, modOv.method, modOv.method === 'accrual' ? 'estimate' : 'pending', modOv.note);
      if (!c.module) return put(c.child, 'daily', 'daily_only', 'Sin adapter conocido');

      const type = adapterFileType(c.module) ?? 'fees';
      const src = adapterSource(c.module, type) ?? '';
      if ((c.category && ACCRUAL_CATEGORIES.has(c.category)) || ACCRUAL_MARKERS.some(m => src.includes(m))) {
        return put(c.child, 'accrual', 'estimate', 'Revenue devengado (modelo de DefiLlama): se reparte el dato diario por horas');
      }
      if ((c.llama_rev24h ?? 0) < CALIBRATION.minDailyUsd) {
        return put(c.child, 'daily', 'daily_only', `Revenue diario < $${CALIBRATION.minDailyUsd}: no se mide por horas`);
      }
      const usesDune = /queryDune|queryDuneSql|queryDuneResult/.test(src) && !DUNE_ENABLED;
      // aunque use Dune en alguna chain, la calibración prueba chain a chain y se queda con las que funcionan
      put(c.child, 'adapter', 'pending', usesDune ? 'Usa Dune en alguna chain: se calibra chain a chain' : 'Adapter de DefiLlama por horas, pendiente de calibrar', type);
    });
  }
  return counts;
}

export async function discover(topN = TOP_N) {
  const res = await fetch(OVERVIEW, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`DefiLlama overview ${res.status}`);
  const data: any = await res.json();
  const rows = buildUniverse(data.protocols ?? [], topN);

  const ts = now();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM universe').run();
    const ins = db.prepare(`INSERT INTO universe (child, parent, parent_name, child_name, module, slug, category, parent_rank, llama_rev24h, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) ins.run(r.child, r.parent, r.parent_name, r.child_name, r.module, r.slug, r.category, r.parent_rank, r.llama_rev24h, ts);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const counts = classify(rows);
  logRun(null, null, 'discover', true);
  return { parents: new Set(rows.map(r => r.parent)).size, children: rows.length, counts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  discover().then(r => {
    console.log(`Universo: ${r.parents} protocolos, ${r.children} adapters hijo`);
    console.log('Plan (cambios):', r.counts);
    process.exit(0);
  }).catch(e => { logRun(null, null, 'discover', false, String(e.message)); console.error(e); process.exit(1); });
}
