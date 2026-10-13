/**
 * Revenue on-chain en Solana sin Dune: leemos las transacciones de las wallets de fees
 * con getTransactionsForAddress de Helius (10 créditos por cada 100 transacciones)
 * y replicamos la lógica de los adapters de DefiLlama.
 */

export const SOL = 'native';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const USD1 = 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';
const STABLES = new Set([USDC, USDT, USD1]);

export type SolanaSpec = {
  /** Wallets que cobran los fees: se suman sus entradas positivas */
  feeWallets: string[];
  /** Tokens que cuentan como fee además de SOL (p. ej. USDC) */
  feeMints?: string[];
  /** Si se indica, solo cuentan las transacciones que incluyen esta cuenta (p. ej. el router del protocolo) */
  requireAccount?: string;
  /** Pagos que salen del revenue (cashback, referidos): transferencias desde estas wallets */
  payouts?: {
    wallets: string[];
    /** destinos internos que no cuentan como pago */
    exclude: string[];
    /** SOL y/o mints de stablecoins */
    mints: string[];
    /** transferencias individuales por encima de este valor en USD se ignoran (movimientos de tesorería) */
    maxUsd?: number;
  };
};

export type SolanaWindowResult = {
  revenueUsd: number;
  feesUsd: number;
  payoutsUsd: number;
  transactions: number;
  credits: number;
  solPrice: number;
  /** transacciones leídas por dirección (sirve para detectar wallets que ya no se usan) */
  byAddress: Record<string, number>;
};

// ---------------------------------------------------------------- Helius

const RPC = () => {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error('Falta HELIUS_API_KEY en el .env');
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rpc(method: string, params: unknown[], attempt = 0): Promise<any> {
  const res = await fetch(RPC(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await sleep(1000 * 2 ** attempt);
    return rpc(method, params, attempt + 1);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(`Helius ${method}: ${res.status} ${body.error?.message ?? res.statusText}`);
  }
  return body.result;
}

/** Todas las transacciones correctas de una dirección en [from, to), paginando de 100 en 100 */
async function* transactionsForAddress(address: string, from: number, to: number, counter: { calls: number; txs: number }) {
  let paginationToken: string | undefined;
  do {
    const result = await rpc('getTransactionsForAddress', [address, {
      transactionDetails: 'full',
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
      sortOrder: 'asc',
      limit: 100,
      ...(paginationToken ? { paginationToken } : {}),
      filters: { blockTime: { gte: from, lt: to }, status: 'succeeded', tokenAccounts: 'balanceChanged' },
    }]);
    counter.calls++;
    const data: any[] = result?.data ?? [];
    counter.txs += data.length;
    for (const tx of data) yield tx;
    paginationToken = result?.paginationToken ?? undefined;
    await sleep(120); // margen frente al límite del plan gratuito
  } while (paginationToken);
}

export async function solPriceAt(ts: number): Promise<number> {
  const res = await fetch(`https://coins.llama.fi/prices/historical/${ts}/coingecko:solana?searchWidth=2h`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`precio SOL: ${res.status}`);
  const body: any = await res.json();
  const price = body?.coins?.['coingecko:solana']?.price;
  if (!price) throw new Error('precio SOL no disponible');
  return Number(price);
}

// ---------------------------------------------------------------- cálculo por transacción

export type TxFlows = {
  /** lamports y unidades crudas de token recibidas por las wallets de fees */
  feeLamports: number;
  feeTokens: Record<string, number>;
  /** pagos individuales (lamports o unidades crudas) por mint */
  payouts: { mint: string; raw: number }[];
};

const keyOf = (k: any): string => (typeof k === 'string' ? k : k?.pubkey);

/** Extrae de una transacción (formato jsonParsed) los fees cobrados y los pagos realizados */
export function flowsFromTransaction(tx: any, spec: SolanaSpec): TxFlows {
  const out: TxFlows = { feeLamports: 0, feeTokens: {}, payouts: [] };
  const meta = tx?.meta;
  if (!meta || meta.err) return out;

  const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map(keyOf);
  const fee = new Set(spec.feeWallets);

  // 1. Fees: variación positiva del saldo de las wallets de fees
  const countsAsFee = !spec.requireAccount || keys.includes(spec.requireAccount);
  if (countsAsFee) {
    keys.forEach((k, i) => {
      if (!fee.has(k)) return;
      const delta = Number(meta.postBalances?.[i] ?? 0) - Number(meta.preBalances?.[i] ?? 0);
      if (delta > 0) out.feeLamports += delta;
    });
    if (spec.feeMints?.length) {
      const mints = new Set(spec.feeMints);
      const bal = new Map<string, { owner: string; mint: string; pre: number; post: number }>();
      for (const [field, list] of [['pre', meta.preTokenBalances], ['post', meta.postTokenBalances]] as const) {
        for (const b of list ?? []) {
          if (!fee.has(b.owner) || !mints.has(b.mint)) continue;
          const k = `${b.accountIndex}`;
          const e = bal.get(k) ?? { owner: b.owner, mint: b.mint, pre: 0, post: 0 };
          e[field] = Number(b.uiTokenAmount?.amount ?? 0);
          bal.set(k, e);
        }
      }
      for (const e of bal.values()) {
        const d = e.post - e.pre;
        if (d > 0) out.feeTokens[e.mint] = (out.feeTokens[e.mint] ?? 0) + d;
      }
    }
  }

  // 2. Pagos (cashback / referidos): transferencias desde las wallets de pago
  const p = spec.payouts;
  if (p) {
    const from = new Set(p.wallets);
    const exclude = new Set([...p.exclude, ...p.wallets, ...spec.feeWallets]);
    const wantSol = p.mints.includes(SOL);
    const wantMints = new Set(p.mints.filter(m => m !== SOL));

    // token account → { owner, mint } para resolver transferencias SPL
    const tokenAccounts = new Map<string, { owner: string; mint: string }>();
    for (const b of [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])]) {
      const acct = keys[b.accountIndex];
      if (acct) tokenAccounts.set(acct, { owner: b.owner, mint: b.mint });
    }

    const instructions = [
      ...(tx.transaction?.message?.instructions ?? []),
      ...(meta.innerInstructions ?? []).flatMap((ii: any) => ii.instructions ?? []),
    ];
    for (const ix of instructions) {
      const parsed = ix?.parsed;
      if (!parsed || typeof parsed !== 'object') continue;
      const info = parsed.info ?? {};

      if (wantSol && ix.program === 'system' && parsed.type === 'transfer') {
        if (from.has(info.source) && !exclude.has(info.destination)) {
          out.payouts.push({ mint: SOL, raw: Number(info.lamports ?? 0) });
        }
      }

      if (wantMints.size && (ix.program === 'spl-token' || ix.program === 'spl-token-2022')
          && (parsed.type === 'transfer' || parsed.type === 'transferChecked')) {
        const src = tokenAccounts.get(info.source);
        const owner = info.authority ?? info.multisigAuthority ?? src?.owner;
        const mint = info.mint ?? src?.mint;
        const destOwner = tokenAccounts.get(info.destination)?.owner;
        if (!owner || !from.has(owner) || !mint || !wantMints.has(mint)) continue;
        if (destOwner && exclude.has(destOwner)) continue;
        const raw = Number(info.tokenAmount?.amount ?? info.amount ?? 0);
        out.payouts.push({ mint, raw });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- ventana completa

const tokenDecimals = (mint: string) => (STABLES.has(mint) ? 6 : 9);
const tokenUsd = (mint: string, raw: number, solPrice: number) =>
  mint === SOL ? (raw / 1e9) * solPrice : STABLES.has(mint) ? raw / 10 ** tokenDecimals(mint) : 0;

export function aggregateFlows(all: TxFlows[], spec: SolanaSpec, solPrice: number) {
  let feesUsd = 0;
  let payoutsUsd = 0;
  for (const f of all) {
    feesUsd += (f.feeLamports / 1e9) * solPrice;
    for (const [mint, raw] of Object.entries(f.feeTokens)) feesUsd += tokenUsd(mint, raw, solPrice);
    for (const p of f.payouts) {
      const usd = tokenUsd(p.mint, p.raw, solPrice);
      if (spec.payouts?.maxUsd && usd >= spec.payouts.maxUsd) continue;
      payoutsUsd += usd;
    }
  }
  return { feesUsd, payoutsUsd, revenueUsd: feesUsd - payoutsUsd };
}

export async function solanaWindowRevenue(spec: SolanaSpec, windowEnd: number, windowSeconds: number): Promise<SolanaWindowResult> {
  const from = windowEnd - windowSeconds;
  const counter = { calls: 0, txs: 0 };
  const seen = new Set<string>();
  const flows: TxFlows[] = [];

  const addresses = [...spec.feeWallets, ...(spec.payouts?.wallets ?? [])];
  const byAddress: Record<string, number> = {};
  for (const address of addresses) {
    const before = counter.txs;
    for await (const tx of transactionsForAddress(address, from, windowEnd, counter)) {
      const sig = tx.transaction?.signatures?.[0];
      if (!sig || seen.has(sig)) continue; // una misma transacción puede tocar varias wallets
      seen.add(sig);
      flows.push(flowsFromTransaction(tx, spec));
    }
    byAddress[address] = counter.txs - before;
  }

  const solPrice = await solPriceAt(windowEnd - Math.floor(windowSeconds / 2));
  const agg = aggregateFlows(flows, spec, solPrice);
  return { ...agg, transactions: seen.size, credits: counter.calls * 10, solPrice, byAddress };
}
