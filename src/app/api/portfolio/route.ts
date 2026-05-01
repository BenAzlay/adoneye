import { NextRequest } from 'next/server';
import { SUPPORTED_CHAINS, alchemyRpcUrl, ChainConfig } from '@/config/chains';
import type { TokenHolding, PortfolioData } from '@/types/portfolio';

export const dynamic = 'force-dynamic';

interface AlchemyToken {
  contractAddress: string;
  rawBalance?: string;
  tokenBalance?: string; // legacy field name in some API versions
  decimals: number;
  name?: string;
  symbol?: string;
}

function formatBalance(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const fracRaw = raw % divisor;
  if (fracRaw === 0n) return whole.toString();
  const fracStr = fracRaw.toString().padStart(decimals, '0');
  const significant = fracStr.slice(0, 6).replace(/0+$/, '');
  return significant ? `${whole}.${significant}` : whole.toString();
}

async function fetchChainHoldings(address: string, chain: ChainConfig, key: string): Promise<TokenHolding[]> {
  const url = alchemyRpcUrl(chain.alchemyNetwork, key);
  const holdings: TokenHolding[] = [];

  // Native balance
  const nativeRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  });
  const nativeData = await nativeRes.json();
  if (nativeData.error) throw new Error(`eth_getBalance on ${chain.name}: ${nativeData.error.message}`);
  const nativeRaw = BigInt(nativeData.result ?? '0x0');
  if (nativeRaw > 0n) {
    holdings.push({
      chain: chain.name,
      chainId: chain.id,
      symbol: chain.nativeCurrency.symbol,
      name: chain.nativeCurrency.name,
      contractAddress: null,
      balance: formatBalance(nativeRaw, chain.nativeCurrency.decimals),
      balanceRaw: nativeRaw.toString(),
      decimals: chain.nativeCurrency.decimals,
      usdPrice: null,
      usdValue: null,
    });
  }

  // ERC-20 balances with pagination
  let pageKey: string | undefined;
  let page = 0;
  do {
    const tokenRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'alchemy_getTokensForOwner',
        params: [address, { withMetadata: true, ...(pageKey ? { pageKey } : {}) }],
      }),
    });
    const tokenData = await tokenRes.json();
    // Non-fatal: skip ERC-20s for this chain if the method is unsupported
    if (tokenData.error) break;

    for (const token of (tokenData.result?.tokens ?? []) as AlchemyToken[]) {
      const rawHex = token.rawBalance ?? token.tokenBalance ?? '0x0';
      const raw = BigInt(rawHex);
      if (raw === 0n) continue;
      holdings.push({
        chain: chain.name,
        chainId: chain.id,
        symbol: token.symbol ?? 'UNKNOWN',
        name: token.name ?? token.symbol ?? 'Unknown Token',
        contractAddress: token.contractAddress,
        balance: formatBalance(raw, token.decimals ?? 18),
        balanceRaw: raw.toString(),
        decimals: token.decimals ?? 18,
        usdPrice: null,
        usdValue: null,
      });
    }

    pageKey = tokenData.result?.pageKey;
    page++;
  } while (pageKey && page < 5);

  return holdings;
}

interface PriceEntry {
  currency: string;
  value: string;
}

interface PriceItem {
  symbol?: string;
  error?: string;
  prices?: PriceEntry[];
}

async function enrichWithPrices(holdings: TokenHolding[], key: string): Promise<void> {
  const BATCH = 100;

  // ERC-20 prices by contract address
  const erc20 = holdings.map((h, i) => ({ h, i })).filter(({ h }) => h.contractAddress !== null);
  for (let start = 0; start < erc20.length; start += BATCH) {
    const batch = erc20.slice(start, start + BATCH);
    const requestData = batch.map(({ h }) => ({
      network: SUPPORTED_CHAINS.find(c => c.id === h.chainId)!.alchemyNetwork,
      address: h.contractAddress!,
    }));
    try {
      const res = await fetch(`https://api.g.alchemy.com/prices/v1/${key}/tokens/by-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: requestData }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.data ?? []).forEach((item: PriceItem, j: number) => {
        if (item.error) return;
        const entry = item.prices?.find(p => p.currency === 'usd');
        if (!entry) return;
        const price = parseFloat(entry.value);
        if (isNaN(price)) return;
        const { h } = batch[j];
        h.usdPrice = price;
        h.usdValue = Math.round(price * parseFloat(h.balance) * 100) / 100;
      });
    } catch { /* leave prices as null */ }
  }

  // Native token prices by symbol
  const native = holdings.map((h, i) => ({ h, i })).filter(({ h }) => h.contractAddress === null);
  if (native.length === 0) return;
  const symbols = [...new Set(native.map(({ h }) => h.symbol))];
  try {
    const res = await fetch(`https://api.g.alchemy.com/prices/v1/${key}/tokens/by-symbol`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const priceMap = new Map<string, number>();
    (data.data ?? []).forEach((item: PriceItem) => {
      if (item.error || !item.symbol) return;
      const entry = item.prices?.find(p => p.currency === 'usd');
      if (entry) priceMap.set(item.symbol, parseFloat(entry.value));
    });
    native.forEach(({ h }) => {
      const price = priceMap.get(h.symbol);
      if (price !== undefined && !isNaN(price)) {
        h.usdPrice = price;
        h.usdValue = Math.round(price * parseFloat(h.balance) * 100) / 100;
      }
    });
  } catch { /* leave prices as null */ }
}

export async function GET(request: NextRequest): Promise<Response> {
  const address = request.nextUrl.searchParams.get('address');
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: 'Invalid or missing address' }, { status: 400 });
  }

  const key = process.env.ALCHEMY_KEY;
  if (!key) return Response.json({ error: 'ALCHEMY_KEY not configured' }, { status: 500 });

  const results = await Promise.allSettled(
    SUPPORTED_CHAINS.map(chain => fetchChainHoldings(address, chain, key))
  );

  const holdings: TokenHolding[] = [];
  const warnings: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') holdings.push(...r.value);
    else warnings.push(`${SUPPORTED_CHAINS[i].name}: ${(r.reason as Error)?.message ?? 'failed'}`);
  });

  await enrichWithPrices(holdings, key);

  holdings.sort((a, b) => {
    if (a.usdValue !== null && b.usdValue !== null) return b.usdValue - a.usdValue;
    if (a.usdValue !== null) return -1;
    if (b.usdValue !== null) return 1;
    return 0;
  });

  const totalUsdValue = holdings.reduce((sum, h) => sum + (h.usdValue ?? 0), 0);

  const portfolio: PortfolioData = {
    address,
    fetchedAt: new Date().toISOString(),
    totalUsdValue: Math.round(totalUsdValue * 100) / 100,
    holdingCount: holdings.length,
    holdings,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  return Response.json(portfolio);
}
