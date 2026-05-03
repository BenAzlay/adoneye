// Deterministic transformation of normalised portfolio data into a compact
// dataset for LLM consumption.
//
// The LLM receives only precomputed metrics — it must never be the source of
// truth for financial calculations (see CLAUDE.md §5).
//
// Only the highest-value holdings in USD are included in the dataset.
// Sending low-value dust or spam positions wastes LLM context, inflates token
// cost, and introduces noise into opportunity-cost analysis. Large allocations
// are what materially affect portfolio outcomes.
//
// Raw Zerion data is never forwarded to the LLM. Provider response shapes,
// internal IDs, and pagination metadata are stripped during normalisation.
// The LLM receives only Adoneye-owned types (see CLAUDE.md §2).
//
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
// to WBTC/WETH opportunity cost is not meaningful for portfolio analysis.
const STABLECOINS = new Set([
  'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FRAX',
  'LUSD', 'USDE', 'PYUSD', 'FDUSD', 'CRVUSD', 'USDBC',
]);

function inferConfidence(holding: TokenHolding): DataConfidence {
  if (holding.usdValue === null) return 'low';
  return KNOWN_CHAIN_NAMES.has(holding.chain) ? 'high' : 'medium';
}

function allocationPct(value: number, total: number): number {
  if (total === 0) return 0;
  // Round to 2 dp to avoid spurious precision in LLM context
  return Math.round((value / total) * 10000) / 100;
}

// Read the position cap from the environment so it can be tuned without a
// code change. Defaults to TOP_POSITIONS_LIMIT if the env var is absent or
// invalid. This cap is the primary cost-control lever for LLM token usage.
function resolvePositionLimit(): number {
  const raw = process.env.MAX_LLM_PORTFOLIO_ASSETS;
  if (!raw) return TOP_POSITIONS_LIMIT;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TOP_POSITIONS_LIMIT;
}

export function buildLLMDataset(
  portfolio: PortfolioData,
  period: 7 | 30 | 90 = 30,
): LLMPortfolioAnalysisDataset {
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
  // Cap to the highest-value holdings in USD. Sorted descending by valueUsd,
  // so slicing gives the most financially significant positions first.
  const positionLimit = resolvePositionLimit();
  const topHoldings = priced.slice(0, positionLimit);

  const positions: AnalysedPosition[] = topHoldings.map(h => {
    const confidence = inferConfidence(h);
    const warnings: string[] = confidence === 'medium' ? ['unknown_chain'] : [];
    return {
      symbol:        h.symbol,
      name:          h.name,
      chain:         h.chain,
      chainId:       h.chainId,
      valueUsd:      h.usdValue!,
      allocationPct: allocationPct(h.usdValue!, totalUsdValue),
      priceUsd:      h.usdPrice!,
      balance:       h.balance,
      confidence,
      warnings,
    };
  });

  // ── Chain allocation (priced holdings only) ────────────────────────────────
  // chainId is kept so the LLM can reference accurate wrapped benchmark names
  // (e.g. "WBTC on Ethereum chainId 1") without inventing chain identifiers.
  const chainMap = new Map<string, { valueUsd: number; chainId: number }>();
  for (const h of priced) {
    const entry = chainMap.get(h.chain);
    if (entry) {
      entry.valueUsd += h.usdValue!;
    } else {
      chainMap.set(h.chain, { valueUsd: h.usdValue!, chainId: h.chainId });
    }
  }
  const chainAllocation = [...chainMap.entries()]
    .sort(([, a], [, b]) => b.valueUsd - a.valueUsd)
    .map(([chain, { valueUsd, chainId }]) => ({
      chain,
      chainId,
      valueUsd:      Math.round(valueUsd * 100) / 100,
      allocationPct: allocationPct(valueUsd, totalUsdValue),
    }));

  // ── Concentration risk ─────────────────────────────────────────────────────
  // Computed from the full priced set (not the capped top-N) so that the LLM
  // receives an accurate picture of concentration across the whole portfolio.
  const top1Value = priced[0]?.usdValue ?? 0;
  const top3Value = priced.slice(0, 3).reduce((s, h) => s + h.usdValue!, 0);
  const top5Value = priced.slice(0, 5).reduce((s, h) => s + h.usdValue!, 0);

  const concentrationRisk = {
    topAssetSymbol: priced[0]?.symbol ?? '',
    topAssetPct:    allocationPct(top1Value, totalUsdValue),
    top3Pct:        allocationPct(top3Value, totalUsdValue),
    top5Pct:        allocationPct(top5Value, totalUsdValue),
    positionCount:  priced.length,
  };

  // ── Portfolio drivers ──────────────────────────────────────────────────────
  // allocationPct is deterministic from the current snapshot.
  // returnPct and contributionPct are null because historical price data is
  // not yet integrated — the LLM must surface this limitation, not invent values.
  const portfolioDrivers = {
    returnDataAvailable: false as const,
    positions: positions.map(p => ({
      symbol:         p.symbol,
      chain:          p.chain,
      allocationPct:  p.allocationPct,
      returnPct:      null as null,
      contributionPct: null as null,
    })),
  };

  // ── Benchmark candidates ───────────────────────────────────────────────────
  // Same-chain wrapped benchmarks only (WBTC, WETH, cbBTC, etc.).
  // Native BTC is not a valid EVM benchmark — it cannot be held directly on
  // EVM chains. The LLM must reference only same-chain canonical equivalents.
  // Return data for these benchmarks also requires historical price integration.
  const eligiblePositions = positions
    .filter(p => !STABLECOINS.has(p.symbol.toUpperCase()))
    .map(({ symbol, chain, chainId, valueUsd, allocationPct }) => ({
      symbol, chain, chainId, valueUsd, allocationPct,
    }));

  // ── Metadata ───────────────────────────────────────────────────────────────
  const assumptions = [
    'Holdings represent a current snapshot; no historical balance data is available.',
    'Portfolio value uses USD prices provided by Zerion at the time of fetch.',
    `Dust positions (below $${DUST_THRESHOLD_USD}) are excluded to reduce noise.`,
    `Analysis covers at most the top ${positionLimit} positions by USD value.`,
    'Stablecoins are excluded from benchmark comparison as their purpose is value preservation.',
    // Same-chain benchmark rule documented here so the LLM inherits the constraint.
    'Benchmark comparisons use same-chain wrapped tokens only (e.g. WBTC, WETH, cbBTC). Native BTC is not a valid EVM benchmark.',
  ];

  const limitations: string[] = [
    // Historical price data absence is the primary limitation for v1.
    // Missed-opportunity and portfolio-driver calculations require it.
    `Historical price data is not yet integrated. Token return percentages, benchmark comparisons, and portfolio contribution values are unavailable for the ${period}-day period.`,
  ];
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
  if (priced.length > positionLimit) {
    limitations.push(
      `${priced.length - positionLimit} additional priced position(s) were omitted; only the top ${positionLimit} by USD value were included.`,
    );
  }

  return {
    period,
    walletSummary: {
      totalValueUsd:       totalUsdValue,
      pricedPositionCount: priced.length,
      chainCount:          chainMap.size,
      chainAllocation,
    },
    positions,
    concentrationRisk,
    portfolioDrivers,
    excluded: {
      dustCount,
      unpricedCount,
      totalCount:   dustCount + unpricedCount,
      dustValueUsd: Math.round(dustValueUsd * 100) / 100,
    },
    benchmarkContext: {
      note: 'Same-chain EVM wrapped benchmark return data (WBTC, WETH, cbBTC, etc.) is not yet available. The positions below are structurally eligible for opportunity-cost comparison once price history is integrated.',
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
