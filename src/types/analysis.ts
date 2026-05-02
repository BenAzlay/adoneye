// DataConfidence reflects the reliability of the pricing data for a position.
// high   — priced token on a well-known chain (Ethereum, Polygon, Arbitrum, etc.)
// medium — priced token but on a less common or unrecognised chain
// low    — not used in the main positions array; reserved for excluded/unpriced assets
export type DataConfidence = 'high' | 'medium' | 'low';

export interface AnalysedPosition {
  symbol: string;
  name: string;
  chain: string;
  valueUsd: number;
  allocationPct: number; // percentage of total portfolio value, 2 dp
  priceUsd: number;
  balance: string;       // human-readable balance string from provider
  confidence: DataConfidence;
  warnings: string[];    // e.g. ['unknown_chain']
}

export interface LLMPortfolioAnalysisDataset {
  walletSummary: {
    totalValueUsd: number;
    pricedPositionCount: number; // positions with a known USD value
    chainCount: number;          // unique chains with priced holdings
    chainAllocation: Array<{
      chain: string;
      valueUsd: number;
      allocationPct: number;
    }>;
  };

  // Top positions sorted by valueUsd descending; at most TOP_POSITIONS_LIMIT entries.
  // All entries here are priced and above the dust threshold.
  positions: AnalysedPosition[];

  // Summary of what was excluded so the LLM understands the dataset is not exhaustive.
  excluded: {
    dustCount: number;         // positions below DUST_THRESHOLD_USD
    unpricedCount: number;     // positions with no USD price from the provider
    totalCount: number;
    dustValueUsd: number;      // combined value of dust positions (unpriced have no value)
  };

  // Non-stablecoin positions eligible for BTC/ETH opportunity-cost comparison.
  // BTC and ETH prices must be fetched separately — the LLM must NOT invent them.
  benchmarkContext: {
    note: string;
    eligiblePositions: Array<{
      symbol: string;
      chain: string;
      valueUsd: number;
      allocationPct: number;
    }>;
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
