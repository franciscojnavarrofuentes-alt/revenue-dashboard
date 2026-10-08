import { TOP_N, TRACKED } from '../config.js';
import { db, now } from '../db.js';

const API = 'https://api.llama.fi';

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

type Row = { key: string; name: string; category?: string; rev24h: number; rev7d: number; rev30d: number; prev24h: number };

/**
 * Ranking por revenue igual que defillama.com/revenue: los protocolos hijos
 * (p. ej. pump.fun, PumpSwap) se agrupan en su padre (Pump).
 */
export async function collectLlamaRanking(): Promise<Row[]> {
  const data = await getJson(`${API}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue`);
  const groups = new Map<string, Row>();

  for (const p of data.protocols ?? []) {
    const isChild = typeof p.parentProtocol === 'string' && p.parentProtocol.length > 0;
    const key = isChild ? p.parentProtocol : String(p.defillamaId ?? p.slug ?? p.name);
    const name = isChild ? (p.linkedProtocols?.[0] ?? p.parentProtocol.replace(/^parent#/, '')) : (p.displayName ?? p.name);
    const g = groups.get(key) ?? { key, name, category: p.category, rev24h: 0, rev7d: 0, rev30d: 0, prev24h: 0 };
    g.rev24h += Number(p.total24h ?? 0);
    g.rev7d += Number(p.total7d ?? 0);
    g.rev30d += Number(p.total30d ?? 0);
    g.prev24h += Number(p.total48hto24h ?? 0);
    groups.set(key, g);
  }

  const top = [...groups.values()].sort((a, b) => b.rev24h - a.rev24h).slice(0, TOP_N);
  const ts = now();
  const insert = db.prepare(`INSERT INTO llama_snapshot (fetched_at, rank, key, name, category, rev24h, rev7d, rev30d, change1d)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  top.forEach((r, i) => {
    const change = r.prev24h > 0 ? (r.rev24h / r.prev24h - 1) * 100 : null;
    insert.run(ts, i + 1, r.key, r.name, r.category ?? null, r.rev24h, r.rev7d, r.rev30d, change);
  });
  return top;
}

/** Revenue diario (días completos, UTC) de cada protocolo seguido, para comparar con nuestras ventanas */
export async function collectLlamaDaily(): Promise<void> {
  const upsert = db.prepare(`INSERT INTO llama_daily (protocol, day, revenue) VALUES (?, ?, ?)
                             ON CONFLICT (protocol, day) DO UPDATE SET revenue = excluded.revenue`);
  for (const p of TRACKED) {
    try {
      const data = await getJson(`${API}/summary/fees/${p.llamaSlug}?dataType=dailyRevenue&excludeTotalDataChartBreakdown=true`);
      const chart: [number, number][] = data.totalDataChart ?? [];
      for (const [day, value] of chart.slice(-60)) upsert.run(p.id, Number(day), Number(value));
    } catch (e) {
      console.warn(`[defillama] sin dato diario para ${p.name}: ${(e as Error).message}`);
    }
  }
}
