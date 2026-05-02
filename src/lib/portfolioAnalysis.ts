// Deterministic transformation of normalised portfolio data into a compact
// dataset for LLM consumption.
//
// The LLM receives only precomputed metrics — it must never be the source of
// truth for financial calculations (see CLAUDE.md §5).
// Privacy: this module never logs wallet addresses or raw provider payloads.
import { DUST_THRESHOLD_USD, TOP_POSITIONS_LIMIT } from '@/constants/analysis';
import { ZERION_CHAINS } from '@/lib/zerion';
import type { PortfolioData, TokenHolding } from '@/types/portfolio';
import type {
  AnalysedPosition,
  DataConfidence,
  LLMPortfolioAnalysisDataset,
} from '@/types/analysis';

// Display names of chains we consider "well-known" for confidence scoring.
// Derived from the Zerion chain registry — update when new chains are added.
const KNOWN_CHAIN_NAMES = new Set(Object.values(ZERION_CHAINS).map(c => c.name));

// Stablecoins are excluded from benchmark comparison because comparing USDC
// to BTC/ETH opportunity cost is not meaningful for portfolio analysis.
const STABLECOINS = new Set([
  'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FRAX',
  'LUSD', 'USDE', 'PYUSD', 'FDUSD', 'CRVUSD', 'USDBC',
]);

function inferConfidence(holding: TokenHolding): DataConfidence {
  // Unpriced holdings are always low confidence but should not reach here
  // (they are filtered into excluded before this function is called).
  if (holding.usdValue === null) return 'low';
  return KNOWN_CHAIN_NAMES.has(holding.chain) ? 'high' : 'medium';
}

function allocationPct(value: number, total: number): number {
  if (total === 0) return 0;
  // Round to 2 dp to avoid spurious precision in LLM context
  return Math.round((value / total) * 10000) / 100;
}

export function buildLLMDataset(portfolio: PortfolioData): LLMPortfolioAnalysisDataset {
  const { holdings, totalUsdValue, fetchedAt } = portfolio;

  // ── Partition holdings ─────────────────────────────────────────────────────
  const priced: TokenHolding[] = [];
  let unpricedCount = 0;
  let dustCount = 0;
  let dustValueUsd = 0;

  for (const h of holdings) {
    if (h.usdValue === null) {
      unpricedCount++;
      continue;
    }
    if (h.usdValue < DUST_THRESHOLD_USD) {
      dustCount++;
      dustValueUsd += h.usdValue;
      continue;
    }
    priced.push(h);
  }
  // priced is already sorted by descending usdValue (PortfolioData invariant)

  // ── Top positions ──────────────────────────────────────────────────────────
  const topHoldings = priced.slice(0, TOP_POSITIONS_LIMIT);

  const positions: AnalysedPosition[] = topHoldings.map(h => {
    const confidence = inferConfidence(h);
    const warnings: string[] = confidence === 'medium' ? ['unknown_chain'] : [];
    return {
      symbol:        h.symbol,
      name:          h.name,
      chain:         h.chain,
      valueUsd:      h.usdValue!,
      allocationPct: allocationPct(h.usdValue!, totalUsdValue),
      priceUsd:      h.usdPrice!,
      balance:       h.balance,
      confidence,
      warnings,
    };
  });

  // ── Chain allocation (priced holdings only) ────────────────────────────────
  const chainMap = new Map<string, number>();
  for (const h of priced) {
    chainMap.set(h.chain, (chainMap.get(h.chain) ?? 0) + h.usdValue!);
  }
  const chainAllocation = [...chainMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([chain, valueUsd]) => ({
      chain,
      valueUsd: Math.round(valueUsd * 100) / 100,
      allocationPct: allocationPct(valueUsd, totalUsdValue),
    }));

  // ── Benchmark candidates ───────────────────────────────────────────────────
  // Non-stablecoin positions where opportunity-cost vs BTC/ETH is meaningful.
  // The LLM must fetch BTC/ETH prices separately — they are not included here.
  const eligiblePositions = positions
    .filter(p => !STABLECOINS.has(p.symbol.toUpperCase()))
    .map(({ symbol, chain, valueUsd, allocationPct }) => ({
      symbol, chain, valueUsd, allocationPct,
    }));

  // ── Metadata ───────────────────────────────────────────────────────────────
  const assumptions = [
    'Holdings represent a current snapshot; no historical balance data is available.',
    'Portfolio value uses USD prices provided by Zerion at the time of fetch.',
    `Dust positions (below $${DUST_THRESHOLD_USD}) are excluded to reduce noise.`,
    `Analysis covers at most the top ${TOP_POSITIONS_LIMIT} positions by USD value.`,
    'Stablecoins are excluded from benchmark comparison as their purpose is value preservation.',
  ];

  const limitations: string[] = [];
  if (unpricedCount > 0) {
    limitations.push(
      `${unpricedCount} position(s) had no USD price and were excluded from total value and analysis.`,
    );
  }
  if (dustCount > 0) {
    limitations.push(
      `${dustCount} dust position(s) with a combined value of ~$${dustValueUsd.toFixed(2)} were excluded.`,
    );
  }
  if (priced.length > TOP_POSITIONS_LIMIT) {
    limitations.push(
      `${priced.length - TOP_POSITIONS_LIMIT} additional priced position(s) were omitted due to the ${TOP_POSITIONS_LIMIT}-position limit.`,
    );
  }

  return {
    walletSummary: {
      totalValueUsd:       totalUsdValue,
      pricedPositionCount: priced.length,
      chainCount:          chainMap.size,
      chainAllocation,
    },
    positions,
    excluded: {
      dustCount,
      unpricedCount,
      totalCount:    dustCount + unpricedCount,
      dustValueUsd:  Math.round(dustValueUsd * 100) / 100,
    },
    benchmarkContext: {
      note: 'BTC and ETH benchmark prices must be fetched separately and are not included here. The positions below are structurally eligible for opportunity-cost comparison.',
      eligiblePositions,
    },
    metadata: {
      generatedAt: fetchedAt,
      dataSource:  'zerion',
      assumptions,
      limitations,
    },
  };
}
