import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOL, USD1, USDC, USDT, type SolanaSpec } from './collectors/solana.js';

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
  | { kind: 'hypurrscan'; id: string; revenueRatio: number }
  /** Transacciones de las wallets de fees en Solana vía Helius (sin Dune) */
  | { kind: 'solana'; id: string; spec: SolanaSpec };

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
  /** false = no se recoge (p. ej. depende de Dune y no hay créditos) */
  enabled: boolean;
};

const DUNE_ENABLED = process.env.ENABLE_DUNE === 'true';

// Direcciones copiadas de los adapters de DefiLlama (fees/axiom.ts y fees/gmgnai.ts)
const AXIOM_ROUTER = 'FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9';
const AXIOM_REFERRAL_VAULT = 'VAULTkV5rgY9WqZtvaMHvctrKMwQw8bCfSJF4nga2D4';
const AXIOM_CASHBACK = ['AxiomRXZAq1Jgjj9pHmNqVP7Lhu67wLXZJZbaK87TTSk', 'AxiomRYAid8ZDhS1bJUAzEaNSr69aTWB9ATfdDLfUbnc'];
const AXIOM_FEE_WALLETS = [
  '7LCZckF6XXGQ1hDY6HFXBKWAtiUgL9QY5vj1C4Bn1Qjj', '4V65jvcDG9DSQioUVqVPiUcUY9v6sb6HKtMnsxSKEz5S',
  'CeA3sPZfWWToFEBmw5n1Y93tnV66Vmp8LacLzsVprgxZ', 'AaG6of1gbj1pbDumvbSiTuJhRCRkkUNaWVxijSbWvTJW',
  '7oi1L8U9MRu5zDz5syFahsiLUric47LzvJBQX6r827ws', '9kPrgLggBJ69tx1czYAbp7fezuUmL337BsqQTKETUEhP',
  'DKyUs1xXMDy8Z11zNsLnUg3dy9HZf6hYZidB6WodcaGy', '4FobGn5ZWYquoJkxMzh2VUAWvV36xMgxQ3M7uG1pGGhd',
  '76sxKrPtgoJHDJvxwFHqb3cAXWfRHFLe3VpKcLCAHSEf', 'H2cDR3EkJjtTKDQKk8SJS48du9mhsdzQhy8xJx5UMqQK',
  '8m5GkL7nVy95G4YVUbs79z873oVKqg2afgKRmqxsiiRm', '4kuG6NsAFJNwqEkac8GFDMMheCGKUPEbaRVHHyFHSwWz',
  '8vFGAKdwpn4hk7kc1cBgfWZzpyW3MEMDATDzVZhddeQb', '86Vh4XGLW2b6nvWbRyDs4ScgMXbuvRCHT7WbUT3RFxKG',
  'DZfEurFKFtSbdWZsKSDTqpqsQgvXxmESpvRtXkAdgLwM', '5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB',
  'DYVeNgXGLAhZdeLMMYnCw1nPnMxkBN7fJnNpHmizTrrF', 'Hbj6XdxX6eV4nfbYTseysibp4zZJtVRRPn2J3BhGRuK9',
  '846ah7iBSu9ApuCyEhA5xpnjHHX7d4QJKetWLbwzmJZ8', '5BqYhuD4q1YD3DMAYkc1FeTu9vqQVYYdfBAmkZjamyZg',
];
const GMGN_FEE_WALLETS = [
  'BB5dnY55FXS1e1NXqZDwCzgdYJdMCj3B92PU6Q5Fb6DT', '7sHXjs1j7sDJGVSMSPjD1b4v3FD6uRSvRWfhRdfv5BiA',
  'HeZVpHj9jLwTVtMMbzQRf6mLtFPkWNSg11o68qrbUBa3', 'ByRRgnZenY6W2sddo1VJzX9o4sMU4gPDUkcmgrpGBxRy',
  'DXfkEGoo6WFsdL7x6gLZ7r6Hw2S6HrtrAQVPWYx2A1s9', '3t9EKmRiAUcQUYzTZpNojzeGP1KBAVEEbDNmy6wECQpK',
  'DymeoWc5WLNiQBaoLuxrxDnDRvLgGZ1QGsEoCAM7Jsrx', 'dBhdrmwBkRa66XxBuAK4WZeZnsZ6bHeHCCLXa3a8bTJ',
  '6TxjC5wJzuuZgTtnTMipwwULEbMPx5JPW3QwWkdTGnrn',
];
const GMGN_REFERRAL_WALLETS = [
  'EzcD6Kc7GYBqBdRo6Lnv3YiwpAUtxYtb5xKWw8r7Q7H8', 'Tw5uhE2uyApRCt9LqN6qMSiEeLYvzvC3P5ToEvTeGEi',
  '69SNcRC8NqjHBSXEcugCN5oFKRQoKmddmWzZYc3tqtxk',
];

export const SOLANA_SPECS: Record<string, SolanaSpec> = {
  axiom: {
    // Fees: entradas de SOL a las wallets de fees en transacciones del router de Axiom
    feeWallets: AXIOM_FEE_WALLETS,
    requireAccount: AXIOM_ROUTER,
    // Revenue = fees − cashback (SOL que las wallets de cashback envían a usuarios)
    payouts: {
      wallets: AXIOM_CASHBACK,
      exclude: [AXIOM_REFERRAL_VAULT, 'ComputeBudget111111111111111111111111111111'],
      mints: [SOL],
    },
  },
  gmgn: {
    // Fees: entradas de SOL y USDC a las 9 wallets de fees
    feeWallets: GMGN_FEE_WALLETS,
    feeMints: [USDC],
    // Revenue = fees − comisiones de referidos (salidas de las wallets de referidos)
    payouts: {
      wallets: GMGN_REFERRAL_WALLETS,
      exclude: ['BCNsHAH2887uUF4gdZsph28oNYbgpjgrtVk7Fi7yN67t'],
      mints: [SOL, USDC, USDT, USD1],
      maxUsd: 150_000,
    },
  },
};

export const TRACKED: TrackedProtocol[] = [
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    llamaSlug: 'hyperliquid',
    lagHours: 1,
    sources: [{ kind: 'hypurrscan', id: 'hypurrscan', revenueRatio: 0.99 }],
    coverageNote: 'Perps + spot vía fees acumulados de Hypurrscan (99% al Assistance Fund). Aproximación: calibrar con el dato diario.',
    enabled: true,
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
    coverageNote: 'pump.fun (bonding curve) + PumpSwap vía Dune. No incluye Terminal ni la app móvil. Desactivado sin créditos de Dune (ENABLE_DUNE=true para activarlo).',
    enabled: DUNE_ENABLED,
  },
  {
    id: 'axiom',
    name: 'Axiom Pro',
    llamaSlug: 'axiom-pro',
    lagHours: 1,
    sources: [{ kind: 'solana', id: 'axiom-solana', spec: SOLANA_SPECS.axiom }],
    coverageNote: 'Axiom en Solana vía Helius (fees − cashback). No incluye BSC/Robinhood ni Axiom Perps.',
    enabled: true,
  },
  {
    id: 'gmgn',
    name: 'GMGN',
    llamaSlug: 'gmgn',
    lagHours: 1,
    sources: [{ kind: 'solana', id: 'gmgn-solana', spec: SOLANA_SPECS.gmgn }],
    coverageNote: 'GMGN en Solana vía Helius (fees SOL+USDC − referidos). No incluye las chains EVM.',
    enabled: true,
  },
];

export const ALERTS = {
  zscore: Number(process.env.ALERT_ZSCORE ?? 2),
  pctVsYesterday: Number(process.env.ALERT_PCT_VS_YESTERDAY ?? 50),
  minHistory: Number(process.env.ALERT_MIN_HISTORY ?? 9),
  /** ventanas usadas como referencia para la media (14 días) */
  baselineWindows: 14 * WINDOWS_PER_DAY,
};
