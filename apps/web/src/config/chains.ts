export interface ChainConfig {
  id: number;
  name: string;
  alchemyNetwork: string;
  nativeCurrency: { symbol: string; name: string; decimals: number };
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  { id: 1,     name: 'Ethereum', alchemyNetwork: 'eth-mainnet',     nativeCurrency: { symbol: 'ETH', name: 'Ether',          decimals: 18 } },
  { id: 137,   name: 'Polygon',  alchemyNetwork: 'polygon-mainnet', nativeCurrency: { symbol: 'POL', name: 'POL (ex-MATIC)', decimals: 18 } },
  { id: 42161, name: 'Arbitrum', alchemyNetwork: 'arb-mainnet',     nativeCurrency: { symbol: 'ETH', name: 'Ether',          decimals: 18 } },
  { id: 10,    name: 'Optimism', alchemyNetwork: 'opt-mainnet',     nativeCurrency: { symbol: 'ETH', name: 'Ether',          decimals: 18 } },
  { id: 8453,  name: 'Base',     alchemyNetwork: 'base-mainnet',    nativeCurrency: { symbol: 'ETH', name: 'Ether',          decimals: 18 } },
];

export function alchemyRpcUrl(network: string, key: string): string {
  return `https://${network}.g.alchemy.com/v2/${key}`;
}
