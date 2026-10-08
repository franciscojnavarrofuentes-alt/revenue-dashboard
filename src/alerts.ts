import { ALERTS, TrackedProtocol, WINDOWS_PER_DAY, WINDOW_HOURS } from './config.js';
import { db, now, protocolWindows } from './db.js';
import { notify } from './notify.js';

export const usd = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;

// Franja en hora de Madrid, p. ej. "jue 08/10 02:00–10:00"
const madrid = (ts: number, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', ...opts }).format(new Date(ts * 1000));
const hhmm = (ts: number) =>
  `la franja ${madrid(ts - WINDOW_HOURS * 3600, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}–${madrid(ts, { hour: '2-digit', minute: '2-digit' })}`;

type Alert = { rule: string; value: number; baseline: number; score: number; message: string };

/** Evalúa las reglas para una ventana concreta del protocolo */
export function evaluate(p: TrackedProtocol, windowEnd: number): Alert[] {
  const series = protocolWindows(p.id, p.sources.length);
  const idx = series.findIndex(w => w.window_end === windowEnd);
  if (idx < 0) return [];
  const value = series[idx].revenue;
  const alerts: Alert[] = [];

  // 1. z-score frente a las últimas 14 días de ventanas de 8h
  const hist = series.slice(Math.max(0, idx - ALERTS.baselineWindows), idx).map(w => w.revenue);
  if (hist.length >= ALERTS.minHistory) {
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const std = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
    if (std > 0) {
      const z = (value - mean) / std;
      if (Math.abs(z) >= ALERTS.zscore) {
        const dir = z > 0 ? '🚀 por encima' : '📉 por debajo';
        alerts.push({
          rule: 'zscore', value, baseline: mean, score: z,
          message: `<b>${p.name}</b>: revenue ${usd(value)} en ${hhmm(windowEnd)} — ${dir} de su media de ${hist.length} ventanas (${usd(mean)}), z = ${z.toFixed(1)}`,
        });
      }
    }
  }

  // 2. Variación frente a la misma franja de ayer
  const prev = series.find(w => w.window_end === windowEnd - WINDOWS_PER_DAY * WINDOW_HOURS * 3600);
  if (prev && prev.revenue > 0) {
    const pct = (value / prev.revenue - 1) * 100;
    if (Math.abs(pct) >= ALERTS.pctVsYesterday) {
      alerts.push({
        rule: 'vs_yesterday', value, baseline: prev.revenue, score: pct,
        message: `<b>${p.name}</b>: revenue ${usd(value)} en ${hhmm(windowEnd)} — ${pct > 0 ? '+' : ''}${pct.toFixed(0)}% frente a la misma franja de ayer (${usd(prev.revenue)})`,
      });
    }
  }
  return alerts;
}

/** Guarda las alertas nuevas y envía las que aún no se han notificado */
export async function processAlerts(p: TrackedProtocol, windowEnd: number): Promise<number> {
  const insert = db.prepare(`INSERT OR IGNORE INTO alerts (protocol, window_end, rule, value, baseline, score, message, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const a of evaluate(p, windowEnd)) {
    insert.run(p.id, windowEnd, a.rule, a.value, a.baseline, a.score, a.message, now());
  }
  // Solo se notifican alertas recientes, para no inundar Telegram al activarlo o tras un backfill
  const pending = db.prepare('SELECT rule, message FROM alerts WHERE protocol = ? AND window_end = ? AND notified = 0 AND window_end > ?')
    .all(p.id, windowEnd, now() - 86400) as { rule: string; message: string }[];
  for (const a of pending) {
    try {
      const sent = await notify(a.message);
      if (sent) db.prepare('UPDATE alerts SET notified = 1 WHERE protocol = ? AND window_end = ? AND rule = ?').run(p.id, windowEnd, a.rule);
    } catch (e) {
      console.error(`[alerta] no se pudo enviar: ${(e as Error).message}`);
    }
  }
  return pending.length;
}
