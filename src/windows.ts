import { WINDOW_SECONDS } from './config.js';

/** Ventanas de 8h alineadas a 00:00, 08:00 y 16:00 UTC. Se identifican por su timestamp de cierre. */
export function lastClosedWindowEnd(nowTs: number, lagHours: number): number {
  return Math.floor((nowTs - lagHours * 3600) / WINDOW_SECONDS) * WINDOW_SECONDS;
}

/** Las últimas `count` ventanas cerradas, de la más antigua a la más reciente */
export function recentWindowEnds(nowTs: number, lagHours: number, count: number): number[] {
  const last = lastClosedWindowEnd(nowTs, lagHours);
  return Array.from({ length: count }, (_, i) => last - (count - 1 - i) * WINDOW_SECONDS);
}

export const iso = (ts: number) => new Date(ts * 1000).toISOString().replace('.000Z', 'Z');
