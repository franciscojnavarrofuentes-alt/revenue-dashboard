import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const VENDOR_DIR = path.join(ROOT, 'vendor', 'dimension-adapters');

export const WINDOW_HOURS = 8;
export const WINDOW_SECONDS = WINDOW_HOURS * 3600;
export const WINDOWS_PER_DAY = 24 / WINDOW_HOURS;

export const TOP_N = Number(process.env.TOP_N ?? 10);

export type Source =
  /** Adapter de DefiLlama (github.com/DefiLlama/dimension-adapters) ejecutado con ventana de 8h */
  | { kind: 'adapter'; id: string; path: string }
  /** Fees acumulados de Hypurrscan; revenue = Δfees × ratio */
  | { kind: 'hypurrscan'; id: string; revenueRatio: number };

export type TrackedProtocol = {
  id: string;
  name: string;
  /** slug en DefiLlama para comparar con su dato diario */
  llamaSlug: string;
  /** horas a esperar tras cerrar la ventana, por el retraso de indexado (Dune, APIs) */
  lagHours: number;
  sources: Source[];
  /** qué parte del revenue que reporta DefiLlama cubren nuestras fuentes */
  coverageNote: string;
};

export const TRACKED: TrackedProtocol[] = [
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    llamaSlug: 'hyperliquid',
    lagHours: 1,
    sources: [{ kind: 'hypurrscan', id: 'hypurrscan', revenueRatio: 0.99 }],
    coverageNote: 'Perps + spot vía fees acumulados de Hypurrscan (99% al Assistance Fund). Aproximación: calibrar con el dato diario.',
  },
  {
    id: 'pump',
    name: 'Pump',
    llamaSlug: 'pump',
    lagHours: 2,
    sources: [
      { kind: 'adapter', id: 'pumpdotfun', path: 'fees/pumpdotfun.ts' },
      { kind: 'adapter', id: 'pump-swap', path: 'fees/pump-swap/index.ts' },
    ],
    coverageNote: 'pump.fun (bonding curve) + PumpSwap. No incluye Terminal ni la app móvil.',
  },
  {
    id: 'axiom',
    name: 'Axiom Pro',
    llamaSlug: 'axiom-pro',
    lagHours: 2,
    sources: [{ kind: 'adapter', id: 'axiom', path: 'fees/axiom.ts' }],
    coverageNote: 'Axiom (Solana + BSC). No incluye Axiom Perps (builder codes de Hyperliquid).',
  },
  {
    id: 'gmgn',
    name: 'GMGN',
    llamaSlug: 'gmgn',
    lagHours: 2,
    sources: [{ kind: 'adapter', id: 'gmgnai', path: 'fees/gmgnai.ts' }],
    coverageNote: 'Todas las chains del adapter de GMGN.',
  },
];

export const ALERTS = {
  zscore: Number(process.env.ALERT_ZSCORE ?? 2),
  pctVsYesterday: Number(process.env.ALERT_PCT_VS_YESTERDAY ?? 50),
  minHistory: Number(process.env.ALERT_MIN_HISTORY ?? 9),
  /** ventanas usadas como referencia para la media (14 días) */
  baselineWindows: 14 * WINDOWS_PER_DAY,
};
