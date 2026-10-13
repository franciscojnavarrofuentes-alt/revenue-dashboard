/**
 * Métodos a medida para protocolos que no se pueden medir con su adapter de DefiLlama
 * (usa Dune, un indexer privado o solo tiene dato diario).
 *
 * Las direcciones se copian de los adapters de DefiLlama (vendor/dimension-adapters/fees/*.ts).
 */
import { SOL, USD1, USDC, USDT, type SolanaSpec } from './solana.js';

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
  // Axiom en Solana: entradas de SOL a sus wallets de fees en transacciones del router, menos cashback
  axiom: {
    feeWallets: AXIOM_FEE_WALLETS,
    requireAccount: AXIOM_ROUTER,
    payouts: { wallets: AXIOM_CASHBACK, exclude: [AXIOM_REFERRAL_VAULT, 'ComputeBudget111111111111111111111111111111'], mints: [SOL] },
  },
  // GMGN en Solana: entradas de SOL y USDC a sus 9 wallets de fees, menos comisiones de referidos
  gmgnai: {
    feeWallets: GMGN_FEE_WALLETS,
    feeMints: [USDC],
    payouts: { wallets: GMGN_REFERRAL_WALLETS, exclude: ['BCNsHAH2887uUF4gdZsph28oNYbgpjgrtVk7Fi7yN67t'], mints: [SOL, USDC, USDT, USD1], maxUsd: 150_000 },
  },
};

export type Override =
  | { method: 'solana'; spec: string; note: string }
  | { method: 'hypurrscan'; note: string }
  | { method: 'accrual'; note: string }
  | { method: 'skip'; note: string };

/** Overrides por módulo del adapter (hijo). Tienen prioridad sobre todo lo demás. */
export const MODULE_OVERRIDES: Record<string, Override> = {
  axiom: { method: 'solana', spec: 'axiom', note: 'Solana vía Helius (fees − cashback). Sin BSC ni Robinhood.' },
  gmgnai: { method: 'solana', spec: 'gmgnai', note: 'Solana vía Helius (fees SOL+USDC − referidos). Sin chains EVM.' },
};

/**
 * Overrides por nombre del protocolo padre (en minúsculas). Hyperliquid: Hypurrscan publica los fees
 * acumulados de perps+spot; el adapter de DefiLlama usa un indexer privado.
 * El primer hijo (el de más revenue) recibe la medición; los demás se marcan como incluidos.
 */
export const PARENT_OVERRIDES: Record<string, Override> = {
  hyperliquid: { method: 'hypurrscan', note: 'Fees acumulados de Hypurrscan (perps + spot) × 99%.' },
};

/** Categorías cuyo revenue es un devengo modelado (reservas × tipo, AUM × comisión), no un flujo medible */
export const ACCRUAL_CATEGORIES = new Set(['Stablecoin Issuer', 'RWA', 'Basis Trading', 'Treasury Manager']);
/** Marcas en el código del adapter que indican devengo modelado */
export const ACCRUAL_MARKERS = ['buildStablecoinAdapter', 'attestations-stablecoins', 'runAtCurrTime: true', 'expense_ratio', 'tbillRate'];
