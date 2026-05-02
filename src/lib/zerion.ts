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
  };
}

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

  return positions;
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
