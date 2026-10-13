import { ALERTS, DAY, HOUR, HOUR_LAG_MIN, hourEnd, startOfDayUTC } from './config.js';
import { db, now } from './db.js';
import { notify } from './notify.js';
import type { ParentToday } from './today.js';

export const usd = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

type NewAlert = { id: string; parent: string; rule: string; value: number; baseline: number; score: number; message: string };

/** Reglas sobre la vista de hoy (función pura salvo la consulta de horas previas) */
export function evaluate(parents: ParentToday[], nowTs: number, hoursElapsed: number): NewAlert[] {
  const out: NewAlert[] = [];
  const day0 = startOfDayUTC(nowTs);
  const lastHour = hourEnd(nowTs - HOUR_LAG_MIN * 60);
  const day = new Date(day0 * 1000).toISOString().slice(0, 10);
  const hh = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 16);

  for (const p of parents) {
    if (!(p.status === 'live' || p.status === 'partial') || p.yesterday < ALERTS.minDailyUsd) continue;
    const complete = p.hoursMissing === 0;

    // 1. Acumulado de hoy vs ayer a la misma hora
    if (complete && hoursElapsed >= ALERTS.minHoursElapsed && p.yesterdaySameTime && p.yesterdaySameTime > 0) {
      const live = p.todayLive, base = p.yesterdaySameTime - p.todayEstimate;
      if (base > 0) {
        const pct = (live / base - 1) * 100;
        if (Math.abs(pct) >= ALERTS.todayVsYesterdayPct) {
          out.push({
            id: `today-${p.parent}-${day}-${pct > 0 ? 'up' : 'down'}`, parent: p.parent, rule: 'hoy_vs_ayer', value: live, baseline: base, score: pct,
            message: `${pct > 0 ? '🚀' : '📉'} <b>${p.name}</b>: ${usd(live)} hoy hasta las ${hh(lastHour)} UTC, ${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs ayer a la misma hora (${usd(base)})`,
          });
        }
      }
    }

    // 2. Última hora vs la misma hora de los 7 días anteriores
    const rows = db.prepare(`SELECT h.hour_end AS he, SUM(h.revenue) AS r FROM hours h JOIN universe u ON u.child = h.child
                             WHERE u.parent = ? AND (h.hour_end = ? OR (h.hour_end < ? AND h.hour_end >= ? AND (? - h.hour_end) % ? = 0))
                             GROUP BY h.hour_end`)
      .all(p.parent, lastHour, lastHour, lastHour - 7 * DAY, lastHour, DAY) as { he: number; r: number }[];
    const cur = rows.find(r => r.he === lastHour);
    const prev = rows.filter(r => r.he !== lastHour).map(r => r.r);
    if (cur && prev.length >= ALERTS.hourMinSamples) {
      const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
      const pct = mean > 0 ? (cur.r / mean - 1) * 100 : 0;
      if (mean > 0 && Math.abs(pct) >= ALERTS.hourVsSameHourPct) {
        out.push({
          id: `hour-${p.parent}-${lastHour}`, parent: p.parent, rule: 'hora_vs_media', value: cur.r, baseline: mean, score: pct,
          message: `⏱️ <b>${p.name}</b>: ${usd(cur.r)} en la hora ${hh(lastHour - HOUR)}–${hh(lastHour)} UTC, ${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs la media de esa hora (${usd(mean)})`,
        });
      }
    }
  }
  return out;
}

export async function processAlerts(parents: ParentToday[], nowTs: number, hoursElapsed: number) {
  const ins = db.prepare('INSERT OR IGNORE INTO alerts (id, parent, rule, value, baseline, score, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let created = 0;
  for (const a of evaluate(parents, nowTs, hoursElapsed)) {
    const r = ins.run(a.id, a.parent, a.rule, a.value, a.baseline, a.score, a.message, now());
    if (Number(r.changes) > 0) created++;
  }
  const pending = db.prepare('SELECT id, message FROM alerts WHERE notified = 0 AND created_at > ?').all(now() - 6 * HOUR) as { id: string; message: string }[];
  for (const a of pending) {
    try {
      if (await notify(a.message)) db.prepare('UPDATE alerts SET notified = 1 WHERE id = ?').run(a.id);
    } catch (e) { console.error(`[alerta] no se pudo enviar: ${(e as Error).message}`); }
  }
  return created;
}
