import type { AdoneyePortfolioAnalysis } from './llm';

// The shape returned by POST /api/analyse.
// analysis is null when the LLM call fails — the dataset is still returned
// so the UI can render allocation-based cards without AI summaries.
export interface AnalyseResponse {
  dataset: LLMPortfolioAnalysisDataset;
  analysis: AdoneyePortfolioAnalysis | null;
}

// What is stored in localStorage. createdAt is set client-side at the moment
// the server response is received, so it reflects when the user ran the analysis.
// This timestamp is displayed in the UI and persists until a new analysis is run.
export interface PersistedAnalysis extends AnalyseResponse {
  createdAt: string; // ISO 8601
}

// DataConfidence reflects the reliability of the pricing data for a position.
// high   — priced token on a well-known chain (Ethereum, Polygon, Arbitrum, etc.)
// medium — priced token but on a less common or unrecognised chain
// low    — not used in the main positions array; reserved for excluded/unpriced assets
export type DataConfidence = 'high' | 'medium' | 'low';

export interface AnalysedPosition {
  symbol: string;
  name: string;
  chain: string;
  chainId: number;       // numeric EVM chain ID, 0 = unknown
  valueUsd: number;
  allocationPct: number; // percentage of total portfolio value, 2 dp
  priceUsd: number;
  balance: string;       // human-readable balance string from provider
  confidence: DataConfidence;
  warnings: string[];    // e.g. ['unknown_chain']
}

export interface LLMPortfolioAnalysisDataset {
  // Analysis period requested by the user. Opportunity-cost and driver
  // calculations are scoped to this window once historical price data
  // is integrated; for now it is passed through to the LLM for framing.
  period: 7 | 30 | 90;

  walletSummary: {
    totalValueUsd: number;
    pricedPositionCount: number; // positions with a known USD value
    chainCount: number;          // unique chains with priced holdings
    chainAllocation: Array<{
      chain: string;
      chainId: number;           // numeric EVM chain ID for benchmark pairing
      valueUsd: number;
      allocationPct: number;
    }>;
  };

  // Top N positions sorted by valueUsd descending.
  // N is capped to MAX_LLM_PORTFOLIO_ASSETS (env) to control token cost.
  // Only the highest-value holdings in USD are included — dust and
  // unpriced assets are excluded before selecting the top N.
  positions: AnalysedPosition[];

  // Concentration risk computed deterministically from the top positions.
  // These values inform the concentration_risk card without any LLM calculation.
  concentrationRisk: {
    topAssetSymbol: string;
    topAssetPct: number;   // % of total portfolio value
    top3Pct: number;       // combined % of top 3 positions
    top5Pct: number;       // combined % of top 5 positions
    positionCount: number; // total priced positions (not capped)
  };

  // Portfolio driver data for the portfolio_drivers card.
  // allocationPct is deterministic; return and contribution fields are null
  // because historical price data is not yet integrated into this pipeline.
  // The LLM must not invent return percentages — it must surface the limitation.
  portfolioDrivers: {
    returnDataAvailable: boolean; // false until price history integration is complete
    positions: Array<{
      symbol: string;
      chain: string;
      allocationPct: number;
      returnPct: number | null;      // null: requires historical price data
      contributionPct: number | null; // null: derived from returnPct, unavailable
    }>;
  };

  // Non-stablecoin positions eligible for same-chain EVM benchmark comparison.
  // Native BTC is never used as a benchmark — only same-chain wrapped/canonical
  // tokens (WBTC, WETH, cbBTC, etc.) are valid benchmark references.
  // Return data for benchmarks is not yet available; the limitation is declared
  // here so the LLM acknowledges it instead of inventing values.
  benchmarkContext: {
    note: string;
    eligiblePositions: Array<{
      symbol: string;
      chain: string;
      chainId: number;
      valueUsd: number;
      allocationPct: number;
    }>;
  };

  // Summary of what was excluded so the LLM understands the dataset is not exhaustive.
  excluded: {
    dustCount: number;         // positions below DUST_THRESHOLD_USD
    unpricedCount: number;     // positions with no USD price from the provider
    totalCount: number;
    dustValueUsd: number;      // combined value of dust positions (unpriced have no value)
  };

  metadata: {
    generatedAt: string;    // ISO 8601
    dataSource: 'zerion';
    // Explicit assumptions let the LLM qualify its explanations accurately.
    assumptions: string[];
    // Explicit limitations tell the LLM what data is missing or approximated.
    limitations: string[];
  };
}
