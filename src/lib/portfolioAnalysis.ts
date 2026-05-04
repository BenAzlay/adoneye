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

// ── Canonical asset aggregation ────────────────────────────────────────────────
//
// Maps normalised symbol → canonical asset so cross-chain duplicates of the
// same economic asset are not double-counted in concentration, allocation, or
// driver analysis.
//
// Conservative inclusion rules:
//  ✓ ETH variants: ETH (native) + WETH (wrapped) — same price, fungible
//  ✓ Stablecoins bridged across chains: USDC/USDC.e, USDT, DAI
//  ✓ BTC wrappers: WBTC, cbBTC, BTCB — widely deployed, tightly pegged
//  ✗ Liquid staking / yield derivatives: stETH, wstETH, weETH, rETH, cbETH
//     → different risk profiles, depeg risk, not pure ETH equivalents
//  ✗ LP tokens, vault tokens, rebasing tokens — not fungible across chains
//  ✗ Any symbol not explicitly listed — unknown assets stay per-chain
const CANONICAL_MAP: Record<string, { id: string; name: string }> = {
  // ETH — native and wrapped only; staking derivatives are intentionally excluded
  ETH:    { id: 'ETH',  name: 'Ethereum' },
  WETH:   { id: 'ETH',  name: 'Ethereum' },
  // USDC — native and the common Polygon/Arbitrum bridged variant
  USDC:   { id: 'USDC', name: 'USD Coin' },
  'USDC.E': { id: 'USDC', name: 'USD Coin' },
  USDCE:  { id: 'USDC', name: 'USD Coin' },
  // Other major stablecoins that appear identically across chains
  USDT:   { id: 'USDT', name: 'Tether' },
  DAI:    { id: 'DAI',  name: 'Dai' },
  // BTC wrappers — conservative: only widely-deployed canonical bridges
  WBTC:   { id: 'BTC',  name: 'Bitcoin' },
  CBBTC:  { id: 'BTC',  name: 'Bitcoin' }, // Coinbase Wrapped BTC (Base/Ethereum)
  BTCB:   { id: 'BTC',  name: 'Bitcoin' }, // BNB Chain native BTC
};

// Merges holdings that represent the same economic asset across chains.
// Holdings absent from CANONICAL_MAP are kept per-chain (conservative default).
// The highest-value component's chain/price/fungibleId is used for the merged
// holding so that benchmark and return lookups remain chain-coherent.
function mergeByCanonical(holdings: TokenHolding[]): TokenHolding[] {
  const groups = new Map<string, TokenHolding[]>();

  for (const h of holdings) {
    const canonical = CANONICAL_MAP[h.symbol.toUpperCase()];
    // Whitelisted assets share a group key; others are keyed per symbol+chain
    const key = canonical ? canonical.id : `${h.symbol.toUpperCase()}#${h.chainId}`;
    const g = groups.get(key);
    if (g) g.push(h);
    else groups.set(key, [h]);
  }

  const result: TokenHolding[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    // Sort by descending value so the primary (largest) component is first.
    // Its chain, chainId, fungibleId, and priceUsd represent the merged position.
    const sorted = [...group].sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
    const primary  = sorted[0];
    const canonical = CANONICAL_MAP[primary.symbol.toUpperCase()]!;
    const totalUsd = Math.round(group.reduce((s, h) => s + (h.usdValue ?? 0), 0) * 100) / 100;
    // Balance is in the same unit for all components of the same canonical asset
    const totalBalance = group.reduce((s, h) => s + parseFloat(h.balance || '0'), 0);

    result.push({
      ...primary,
      symbol:   canonical.id,
      name:     canonical.name,
      usdValue: totalUsd,
      balance:  totalBalance.toFixed(6),
    });
  }

  return result.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
}

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

// Returns the holdings that are eligible for historical return fetching:
// priced, above the dust threshold, non-stablecoin, and have a Zerion fungible ID.
// Capped at the same position limit used by buildLLMDataset to avoid excess API calls.
export function getEligibleForReturns(portfolio: PortfolioData): typeof portfolio.holdings {
  const limit = resolvePositionLimit();
  return portfolio.holdings
    .filter(
      h =>
        h.usdValue !== null &&
        h.usdValue >= DUST_THRESHOLD_USD &&
        h.fungibleId !== null &&
        !STABLECOINS.has(h.symbol.toUpperCase()),
    )
    .slice(0, limit);
}

// Returns holdings that are otherwise eligible for return fetching but lack a
// fungible ID from the Zerion positions response. These are candidates for a
// secondary Zerion fungibles-search resolution step in the route.
export function getEligibleWithoutFungibleId(portfolio: PortfolioData): typeof portfolio.holdings {
  const limit = resolvePositionLimit();
  return portfolio.holdings
    .filter(
      h =>
        h.usdValue !== null &&
        h.usdValue >= DUST_THRESHOLD_USD &&
        h.fungibleId === null &&
        !STABLECOINS.has(h.symbol.toUpperCase()),
    )
    .slice(0, limit);
}

// ── Return math helpers ────────────────────────────────────────────────────────

function toReturnPct(decimal: number): number {
  // 0.12345 → 12.35 (2 dp)
  return Math.round(decimal * 10000) / 100;
}

function computeOpportunityCost(
  valueUsd: number,
  posReturnDecimal: number,
  benchmarkReturnDecimal: number,
): number {
  // Positive = underperformed the benchmark (money left on the table).
  // Negative = outperformed (no opportunity cost — a gain vs benchmark).
  return Math.round(valueUsd * (benchmarkReturnDecimal - posReturnDecimal) * 100) / 100;
}

export function buildLLMDataset(
  portfolio: PortfolioData,
  period: 7 | 30 | 90 = 30,
  priceReturns?: ReadonlyMap<string, number>,       // fungibleId → decimal return (0.1 = 10%)
  benchmark?: { symbol: string; returnDecimal: number } | null, // ETH — primary EVM benchmark
  btcReturnDecimal?: number | null,                 // WBTC proxy for BTC market reference
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

  // ── Canonical aggregation ──────────────────────────────────────────────────
  // Merge cross-chain duplicates (ETH+WETH, USDC, BTC wrappers) into one
  // position before concentration, allocation, and driver analysis.
  // Chain allocation uses the pre-merge set to preserve chain-level accuracy.
  const pricedMerged = mergeByCanonical(priced);

  // ── Top positions ──────────────────────────────────────────────────────────
  const positionLimit = resolvePositionLimit();
  const topHoldings = pricedMerged.slice(0, positionLimit);

  // Build positions and per-position return metrics in one pass so we don't
  // iterate topHoldings twice.
  const positions: AnalysedPosition[] = [];
  const driverPositions: Array<{
    symbol: string;
    chain: string;
    allocationPct: number;
    returnPct: number | null;
    contributionPct: number | null;
    opportunityCostUsd: number | null;
  }> = [];

  for (const h of topHoldings) {
    const confidence = inferConfidence(h);
    const warnings: string[] = confidence === 'medium' ? ['unknown_chain'] : [];
    const valueUsd = h.usdValue!;
    const alloc = allocationPct(valueUsd, totalUsdValue);

    const returnDecimal = h.fungibleId ? priceReturns?.get(h.fungibleId) ?? null : null;
    const returnPct = returnDecimal !== null ? toReturnPct(returnDecimal) : null;
    // Weighted contribution to portfolio return (e.g. 50% allocation × 20% return = 10pp contribution)
    const contributionPct =
      returnPct !== null ? Math.round(returnPct * alloc / 100 * 100) / 100 : null;
    const opportunityCostUsd =
      returnDecimal !== null && benchmark
        ? computeOpportunityCost(valueUsd, returnDecimal, benchmark.returnDecimal)
        : null;

    positions.push({
      symbol: h.symbol, name: h.name, chain: h.chain, chainId: h.chainId,
      valueUsd, allocationPct: alloc, priceUsd: h.usdPrice!,
      balance: h.balance, confidence, warnings,
    });
    driverPositions.push({ symbol: h.symbol, chain: h.chain, allocationPct: alloc, returnPct, contributionPct, opportunityCostUsd });
  }

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
  // Computed from the full merged set so cross-chain ETH/WETH is counted once.
  const top1Value = pricedMerged[0]?.usdValue ?? 0;
  const top3Value = pricedMerged.slice(0, 3).reduce((s, h) => s + h.usdValue!, 0);
  const top5Value = pricedMerged.slice(0, 5).reduce((s, h) => s + h.usdValue!, 0);

  const concentrationRisk = {
    topAssetSymbol: pricedMerged[0]?.symbol ?? '',
    topAssetPct:    allocationPct(top1Value, totalUsdValue),
    top3Pct:        allocationPct(top3Value, totalUsdValue),
    top5Pct:        allocationPct(top5Value, totalUsdValue),
    positionCount:  pricedMerged.length,
  };

  // ── Portfolio drivers ──────────────────────────────────────────────────────
  const returnDataAvailable = priceReturns !== undefined && priceReturns.size > 0;
  const portfolioDrivers = {
    returnDataAvailable,
    benchmarkSymbol: benchmark?.symbol ?? null,
    benchmarkReturnPct: benchmark != null ? toReturnPct(benchmark.returnDecimal) : null,
    btcBenchmarkReturnPct: btcReturnDecimal != null ? toReturnPct(btcReturnDecimal) : null,
    positions: driverPositions,
  };

  // ── Benchmark candidates ───────────────────────────────────────────────────
  // Same-chain wrapped benchmarks only (WBTC, WETH, cbBTC, etc.).
  // Native BTC is not a valid EVM benchmark — it cannot be held directly on
  // EVM chains. The LLM must reference only same-chain canonical equivalents.
  const eligiblePositions = topHoldings
    .filter(h => !STABLECOINS.has(h.symbol.toUpperCase()))
    .map(h => {
      const alloc = allocationPct(h.usdValue!, totalUsdValue);
      const returnDecimal = h.fungibleId ? priceReturns?.get(h.fungibleId) ?? null : null;
      const returnPct = returnDecimal !== null ? toReturnPct(returnDecimal) : null;
      const opportunityCostUsd =
        returnDecimal !== null && benchmark
          ? computeOpportunityCost(h.usdValue!, returnDecimal, benchmark.returnDecimal)
          : null;
      return {
        symbol: h.symbol, chain: h.chain, chainId: h.chainId,
        valueUsd: h.usdValue!, allocationPct: alloc, returnPct, opportunityCostUsd,
      };
    });

  // ── Metadata ───────────────────────────────────────────────────────────────
  const mergedAway = priced.length - pricedMerged.length;
  const assumptions = [
    'Holdings represent a current snapshot; no historical balance data is available.',
    'Portfolio value uses USD prices provided by Zerion at the time of fetch.',
    `Dust positions (below $${DUST_THRESHOLD_USD}) are excluded to reduce noise.`,
    `Analysis covers at most the top ${positionLimit} canonical positions by USD value.`,
    ...(mergedAway > 0
      ? [`${mergedAway} raw position(s) were merged into canonical assets (e.g. ETH+WETH on different chains count as one ETH position).`]
      : []),
    'Stablecoins are excluded from benchmark comparison as their purpose is value preservation.',
    'Benchmark comparisons use same-chain wrapped tokens only (e.g. WBTC, WETH, cbBTC). Native BTC is not a valid EVM benchmark.',
  ];

  const limitations: string[] = [];
  if (!returnDataAvailable) {
    if (benchmark != null || btcReturnDecimal != null) {
      // Benchmark reference data is available but individual position chart
      // data was unavailable, so per-position returns are null.
      limitations.push(
        `Individual token return data is unavailable for the ${period}-day period. ` +
        `Return percentages and contribution values are null per position. ` +
        `Benchmark reference data is available and used for context only.`,
      );
    } else {
      limitations.push(
        `Historical price data is unavailable. Token return percentages, benchmark comparisons, and contribution values are null for the ${period}-day period.`,
      );
    }
  } else if (!benchmark) {
    limitations.push(
      `No benchmark could be identified from current holdings (ETH/WETH not found). Benchmark comparison and opportunity-cost values are unavailable.`,
    );
  }
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
  if (pricedMerged.length > positionLimit) {
    limitations.push(
      `${pricedMerged.length - positionLimit} additional position(s) were omitted; only the top ${positionLimit} by USD value were included.`,
    );
  }

  return {
    period,
    walletSummary: {
      totalValueUsd:       totalUsdValue,
      pricedPositionCount: pricedMerged.length,
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
      note: (() => {
        const parts: string[] = [];
        if (benchmark) parts.push(`ETH benchmark: ${toReturnPct(benchmark.returnDecimal).toFixed(2)}% over ${period} days`);
        if (btcReturnDecimal != null) parts.push(`BTC (WBTC) benchmark: ${toReturnPct(btcReturnDecimal).toFixed(2)}% over ${period} days`);
        if (parts.length > 0) return parts.join('. ') + '. Opportunity cost is positive when a position underperformed ETH.';
        return 'Benchmark return data unavailable. Same-chain wrapped tokens (WBTC, WETH, cbBTC) are the valid EVM benchmarks; native BTC is not.';
      })(),
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
