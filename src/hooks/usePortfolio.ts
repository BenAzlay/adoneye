'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import type { PortfolioData } from '@/types/portfolio';

export function usePortfolio() {
  const { address, isConnected } = useAccount();

  return useQuery<PortfolioData, Error>({
    queryKey: ['portfolio', address],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio?address=${address}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? 'Failed to fetch portfolio');
      }
      return res.json() as Promise<PortfolioData>;
    },
    enabled: isConnected && !!address,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
