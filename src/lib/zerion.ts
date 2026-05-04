// Zerion provider adapter.
// All Zerion-specific types, HTTP logic, and response normalisation live here.
// The rest of the app imports TokenHolding / PortfolioData, never raw Zerion shapes.
import type { TokenHolding, PortfolioData } from '@/types/portfolio';

export const ZERION_CHAINS: Record<string, { name: string; id: number }> = {
  ethereum:        { name: 'Ethereum',      id: 1        },
  polygon:         { name: 'Polygon',       id: 137      },
  arbitrum:        { name: 'Arbitrum',      id: 42161    },
  optimism:        { name: 'Optimism',      id: 10       },
  base:            { name: 'Base',          id: 8453     },
  avalanche:       { name: 'Avalanche',     id: 43114    },
  bsc:             { name: 'BNB Chain',     id: 56       },
  gnosis:          { name: 'Gnosis',        id: 100      },
  fantom:          { name: 'Fantom',        id: 250      },
  linea:           { name: 'Linea',         id: 59144    },
  scroll:          { name: 'Scroll',        id: 534352   },
  'zksync-era':    { name: 'zkSync Era',    id: 324      },
  'polygon-zkevm': { name: 'Polygon zkEVM', id: 1101     },
  blast:           { name: 'Blast',         id: 81457    },
  mantle:          { name: 'Mantle',        id: 5000     },
  celo:            { name: 'Celo',          id: 42220    },
};

// Reverse lookup: chain display name → Zerion slug (e.g. 'Arbitrum' → 'arbitrum').
// Used to resolve fungible IDs for holdings whose positions response lacked the relationship.
export const CHAIN_SLUG_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(ZERION_CHAINS).map(([slug, { name }]) => [name, slug]),
);

// ── Raw Zerion response shapes ─────────────────────────────────────────────────
// These types must not leak outside this module.

interface ZerionQuantity {
  int: string;
  decimals: number;
  float: number;
  numeric: string;
}

interface ZerionImplementation {
  chain_id: string;
  address: string | null;
  decimals: number;
}

export interface ZerionPosition {
  type: string;
  id: string;
  attributes: {
    position_type: string;
    quantity: ZerionQuantity;
    value: number | null;
    price: number | null;
    flags: { displayable: boolean; is_trash: boolean };
    fungible_info: {
      name: string;
      symbol: string;
      implementations: ZerionImplementation[];
    };
  };
  relationships: {
    chain: { data: { type: string; id: string } };
    // fungible.data may be absent when only links are returned by Zerion
    fungible?: {
      data?: { type: string; id: string };
      links?: { related: string };
    };
  };
}

// ── Fungibles search types ─────────────────────────────────────────────────────
// Used to look up fungible IDs for ETH and WBTC when they are not in the wallet.

interface ZerionFungibleItem {
  id: string;
  attributes: {
    name: string;
    symbol: string;
    implementations?: Array<{ chain_id: string; address: string | null }>;
  };
}

interface ZerionFungibleListResponse {
  data?: ZerionFungibleItem[];
}

// Module-level cache so repeated analyses in the same server process avoid
// unnecessary search API calls. Key: `${symbol.lower}-${chainSlug}`.
const fungibleIdCache = new Map<string, string>();

// Searches the Zerion fungibles catalogue for an asset by symbol and chain.
// nativeOnly = true restricts to native tokens (address === null) — use this
// to find native ETH rather than WETH when searching for "ETH".
// Returns the Zerion fungible ID, or null on failure / no match.
export async function findFungibleId(
  symbol: string,
  chainSlug: string,
  key: string,
  nativeOnly = false,
): Promise<string | null> {
  const cacheKey = `${symbol.toLowerCase()}-${chainSlug}${nativeOnly ? '-native' : ''}`;
  const cached = fungibleIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const auth = Buffer.from(`${key}:`).toString('base64');
  try {
    const url = `https://api.zerion.io/v1/fungibles/?filter[search_query]=${encodeURIComponent(symbol)}&currency=usd`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.warn(`[zerion] fungibles search failed ${res.status} for "${symbol}": ${text.slice(0, 120)}`);
      return null;
    }

    const body: ZerionFungibleListResponse = await res.json().catch(() => ({}));
    console.log(`[zerion] fungibles search "${symbol}": ${body.data?.length ?? 0} results, symbols=[${body.data?.slice(0,5).map(f => f.attributes.symbol).join(',')}]`);

    const match = body.data?.find(f => {
      if (f.attributes.symbol.toUpperCase() !== symbol.toUpperCase()) return false;
      return f.attributes.implementations?.some(
        i => i.chain_id === chainSlug && (!nativeOnly || i.address === null),
      );
    });

    const id = match?.id ?? null;
    console.log(`[zerion] fungibles search "${symbol}" resolved to: ${id ?? 'null'}`);
    if (id) fungibleIdCache.set(cacheKey, id);
    return id;
  } catch (err) {
    console.warn(`[zerion] fungibles search threw for "${symbol}":`, (err as Error).message);
    return null;
  }
}

// ── Chart types ────────────────────────────────────────────────────────────────
// Only the fields we use from /v1/fungibles/{id}/charts/

interface ZerionChartResponse {
  data?: {
    attributes?: {
      stats?: {
        first: number;
        last: number;
        min: number;
        max: number;
        change_abs: number;
        change: number | null;
      };
    };
  };
}

// Zerion chart period path segments.
// The period is part of the URL path: /v1/fungibles/{id}/charts/{period}
const ZERION_CHART_PERIOD: Record<7 | 30 | 90, string> = {
  7:  'week',
  30: 'month',
  90: '3months',
};

// ── Fetch ──────────────────────────────────────────────────────────────────────

export async function fetchZerionPositions(
  address: string,
  key: string,
): Promise<ZerionPosition[]> {
  const auth = Buffer.from(`${key}:`).toString('base64');
  const positions: ZerionPosition[] = [];

  let url: string | null =
    `https://api.zerion.io/v1/wallets/${address}/positions/` +
    `?filter[position_types]=wallet&filter[trash]=only_non_trash&currency=usd`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Zerion ${res.status}: ${text}`);
    }
    const body: { data?: ZerionPosition[]; links?: { next?: string | null } } = await res.json();
    positions.push(...(body.data ?? []));
    url = body.links?.next ?? null;
  }

  // Log the first position's relationships so we can verify fungibleId extraction.
  if (positions[0]) {
    console.log('[zerion] first position relationships:', JSON.stringify(positions[0].relationships));
  }

  return positions;
}

// ── Chart fetch ────────────────────────────────────────────────────────────────

// Returns the period return as a decimal (0.1 = 10% gain, -0.05 = -5% loss),
// or null if the chart is unavailable or the price data is missing.
export async function fetchFungibleReturn(
  fungibleId: string,
  period: 7 | 30 | 90,
  key: string,
): Promise<number | null> {
  const auth = Buffer.from(`${key}:`).toString('base64');
  const periodParam = ZERION_CHART_PERIOD[period];

  try {
    const url = `https://api.zerion.io/v1/fungibles/${fungibleId}/charts/${periodParam}?currency=usd`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.warn(`[zerion] chart fetch failed ${res.status} for ${fungibleId} period=${periodParam}: ${text.slice(0, 120)}`);
      return null;
    }

    const body: ZerionChartResponse = await res.json().catch(() => ({}));
    const stats = body.data?.attributes?.stats;
    if (!stats || stats.first <= 0) {
      console.warn(`[zerion] chart response missing stats for ${fungibleId}:`, JSON.stringify(body).slice(0, 200));
      return null;
    }

    return (stats.last - stats.first) / stats.first;
  } catch (err) {
    console.warn(`[zerion] chart fetch threw for ${fungibleId}:`, (err as Error).message);
    return null;
  }
}

// ── Normalisation ──────────────────────────────────────────────────────────────

export function toTokenHolding(pos: ZerionPosition): TokenHolding | null {
  const { attributes: a, relationships: r } = pos;
  if (!a.flags.displayable || a.flags.is_trash) return null;

  const chainSlug = r.chain.data.id;
  const chain = ZERION_CHAINS[chainSlug];
  const impl = a.fungible_info.implementations.find(i => i.chain_id === chainSlug);

  return {
    chain:           chain?.name ?? chainSlug,
    chainId:         chain?.id   ?? 0,
    symbol:          a.fungible_info.symbol,
    name:            a.fungible_info.name,
    contractAddress: impl?.address ?? null,
    // Extract fungible ID from either data.id (preferred) or the links.related URL.
    // Some Zerion API versions return only links without the data object.
    fungibleId:
      pos.relationships.fungible?.data?.id ??
      (pos.relationships.fungible?.links?.related?.match(/\/fungibles\/([^/?]+)/)?.[1] ?? null),
    balance:         a.quantity.numeric,
    balanceRaw:      a.quantity.int,
    decimals:        a.quantity.decimals,
    usdPrice:        a.price,
    usdValue:        a.value !== null ? Math.round(a.value * 100) / 100 : null,
  };
}

export function buildPortfolioData(address: string, positions: ZerionPosition[]): PortfolioData {
  const holdings = positions
    .map(toTokenHolding)
    .filter((h): h is TokenHolding => h !== null);

  holdings.sort((a, b) => {
    if (a.usdValue !== null && b.usdValue !== null) return b.usdValue - a.usdValue;
    if (a.usdValue !== null) return -1;
    if (b.usdValue !== null) return 1;
    return 0;
  });

  const totalUsdValue =
    Math.round(holdings.reduce((s, h) => s + (h.usdValue ?? 0), 0) * 100) / 100;

  return {
    address,
    fetchedAt: new Date().toISOString(),
    totalUsdValue,
    holdingCount: holdings.length,
    holdings,
  };
}
