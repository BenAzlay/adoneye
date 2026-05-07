export interface TokenHolding {
  chain: string;
  chainId: number;
  symbol: string;
  name: string;
  contractAddress: string | null; // null = native token
  fungibleId: string | null;      // Zerion fungible ID, used for historical chart lookups
  balance: string;     // human-readable, e.g. "1.234567"
  balanceRaw: string;  // decimal string, avoids BigInt serialization issues
  decimals: number;
  usdPrice: number | null;
  usdValue: number | null;
}

export interface PortfolioData {
  address: string;
  fetchedAt: string;       // ISO 8601
  totalUsdValue: number;   // sum of confirmed usdValue entries only
  holdingCount: number;
  holdings: TokenHolding[]; // sorted: highest usdValue first; null-price last
  warnings?: string[];     // chains that failed to fetch, if any
}
