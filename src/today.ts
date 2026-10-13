/**
 * Vista "hoy hasta ahora" (día UTC) por protocolo padre, a partir de las horas medidas y del plan.
 */
import { DAY, HOUR, HOUR_LAG_MIN, hourEnd, startOfDayUTC } from './config.js';
import { db, universe } from './db.js';

const LIVE_METHODS = new Set(['adapter', 'solana', 'hypurrscan']);

export type ParentToday = {
  parent: string; name: string; rank: number; category: string | null;
  status: 'live' | 'partial' | 'estimate' | 'daily';
  today: number;              // en vivo + estimado
  todayLive: number;
  todayEstimate: number;
  liveHoursDone: number;      // horas del día ya medidas (las de los hijos en vivo)
  hoursMissing: number;       // horas del día aún sin medir en algún hijo en vivo (0 = completo)
  yesterday: number;          // último día completo según DefiLlama (suma de hijos)
  yesterdaySameTime: number | null;  // acumulado de ayer hasta la misma hora (si hay horas medidas de ayer)
  pace24h: number | null;     // proyección del día al ritmo actual
  vsYesterday: number | null; // hoy vs ayer a la misma hora (o vs ayer × fracción del día)
  coverage: number;           // parte del revenue de ayer que medimos en vivo o estimamos
  children: { name: string; method: string; status: string; note: string | null; ratio: number | null; today: number | null; yesterday: number }[];
};

export function computeToday(nowTs: number) {
  const day0 = startOfDayUTC(nowTs);
  const lastHour = hourEnd(nowTs - HOUR_LAG_MIN * 60);
  const hoursElapsed = Math.max(0, (lastHour - day0) / HOUR);
  const fraction = Math.min(1, Math.max(0, (nowTs - day0) / DAY));

  const rows = universe();
  const sums = new Map((db.prepare(`SELECT child, SUM(revenue) AS s, COUNT(*) AS n FROM hours WHERE hour_end > ? AND hour_end <= ? GROUP BY child`)
    .all(day0, lastHour) as any[]).map(r => [r.child, r]));
  const ySums = new Map((db.prepare(`SELECT child, SUM(revenue) AS s, COUNT(*) AS n FROM hours WHERE hour_end > ? AND hour_end <= ? GROUP BY child`)
    .all(day0 - DAY, lastHour - DAY) as any[]).map(r => [r.child, r]));

  type Acc = ParentToday & { covered: number; ySameMissing: boolean };
  const parents = new Map<string, Acc>();
  for (const r of rows) {
    const p: Acc = parents.get(r.parent) ?? {
      parent: r.parent, name: r.parent_name, rank: r.parent_rank, category: r.category,
      status: 'daily', today: 0, todayLive: 0, todayEstimate: 0, liveHoursDone: 0, hoursMissing: 0, yesterday: 0,
      yesterdaySameTime: 0, pace24h: null, vsYesterday: null, coverage: 0, children: [],
      covered: 0, ySameMissing: false,
    };
    const y = r.llama_rev24h ?? 0;
    p.yesterday += y;
    let today: number | null = null;
    if (r.status === 'live' && LIVE_METHODS.has(r.method ?? '')) {
      const s = sums.get(r.child);
      today = s ? Number(s.s) : 0;
      p.todayLive += today;
      p.liveHoursDone = Math.max(p.liveHoursDone, s ? Number(s.n) : 0);
      p.hoursMissing = Math.max(p.hoursMissing, hoursElapsed - (s ? Number(s.n) : 0));
      p.covered += y;
      const ys = ySums.get(r.child);
      if (ys && hoursElapsed > 0 && Number(ys.n) >= hoursElapsed) p.yesterdaySameTime = (p.yesterdaySameTime ?? 0) + Number(ys.s);
      else p.ySameMissing = true;
    } else if (r.method === 'accrual') {
      today = y * fraction;
      p.todayEstimate += today;
      p.covered += y;
      p.yesterdaySameTime = (p.yesterdaySameTime ?? 0) + y * fraction;
    }
    p.children.push({ name: r.child_name, method: r.method ?? '—', status: r.status ?? 'pending', note: r.note ?? null, ratio: r.ratio ?? null, today, yesterday: y });
    parents.set(r.parent, p);
  }

  const list: ParentToday[] = [...parents.values()].map(({ covered, ySameMissing, ...p }) => {
    p.coverage = p.yesterday > 0 ? covered / p.yesterday : (covered > 0 ? 1 : 0);
    p.today = p.todayLive + p.todayEstimate;
    const hasLive = p.children.some(c => c.status === 'live' && LIVE_METHODS.has(c.method));
    p.status = hasLive ? (p.coverage >= 0.9 ? 'live' : 'partial') : p.todayEstimate > 0 ? 'estimate' : 'daily';
    // sin horas de ayer: se compara con el día de ayer de DefiLlama × fracción del día (de la parte cubierta)
    if (ySameMissing) p.yesterdaySameTime = covered * fraction;
    if (p.status === 'daily') { p.today = 0; p.yesterdaySameTime = null; }
    // con horas sin medir, el acumulado está incompleto: no se proyecta ni se compara
    const measured = p.status !== 'daily' && p.hoursMissing === 0;
    p.pace24h = measured && fraction > 0.02 ? p.today / fraction : null;
    // un devengo crece igual que ayer por construcción: compararlo no aporta
    p.vsYesterday = measured && p.status !== 'estimate' && p.yesterdaySameTime ? p.today / p.yesterdaySameTime - 1 : null;
    return p;
  }).sort((a, b) => a.rank - b.rank);

  const summary = {
    day: new Date(day0 * 1000).toISOString().slice(0, 10),
    asOf: lastHour, now: nowTs, hoursElapsed, fraction,
    counts: { live: 0, partial: 0, estimate: 0, daily: 0 } as Record<string, number>,
    totalToday: 0, totalYesterday: 0,
  };
  for (const p of list) { summary.counts[p.status]++; summary.totalToday += p.today; summary.totalYesterday += p.yesterday; }
  return { summary, parents: list };
}

/** Revenue por hora de un padre (hijos en vivo), para el gráfico: hoy y ayer */
export function parentHours(parent: string, nowTs: number) {
  const day0 = startOfDayUTC(nowTs);
  return db.prepare(`SELECT h.hour_end AS hour_end, SUM(h.revenue) AS revenue
                     FROM hours h JOIN universe u ON u.child = h.child
                     WHERE u.parent = ? AND h.hour_end > ? GROUP BY h.hour_end ORDER BY h.hour_end`)
    .all(parent, day0 - DAY) as { hour_end: number; revenue: number }[];
}
