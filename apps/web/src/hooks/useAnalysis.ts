'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { loadAnalysis, saveAnalysis } from '@/lib/analysisStorage';
import type { PersistedAnalysis } from '@/types/analysis';

// Thrown when the server returns HTTP 429 (cooldown active).
// Distinct from generic Error so the UI can render a cooldown state
// rather than a generic error banner.
export class AnalysisCooldownError extends Error {
  constructor(public readonly remainingSeconds: number) {
    super(`Analysis on cooldown. Retry in ${remainingSeconds}s.`);
    this.name = 'AnalysisCooldownError';
  }
}

export function analysisQueryKey(address: string | undefined, period: 7 | 30 | 90) {
  return ['analysis', address?.toLowerCase(), period] as const;
}

export function useAnalysis(period: 7 | 30 | 90 = 30) {
  const { address, isConnected } = useAccount();

  const query = useQuery<PersistedAnalysis, Error>({
    queryKey: analysisQueryKey(address, period),
    queryFn: async () => {
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, period }),
      });

      if (res.status === 429) {
        const body = await res.json().catch(() => ({ remainingSeconds: 600 }));
        throw new AnalysisCooldownError(body.remainingSeconds ?? 600);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? 'Analysis failed');
      }

      const apiData = await res.json();
      const persisted: PersistedAnalysis = {
        ...apiData,
        createdAt: new Date().toISOString(),
      };

      // Persist immediately so data survives page refresh.
      // Overwrites any previous analysis for this address.
      if (address) saveAnalysis(address, persisted);

      return persisted;
    },

    // Seed the query from localStorage on mount.
    // When data is present, React Query skips the initial fetch entirely
    // (staleTime: Infinity means cached data is never considered stale).
    // The analysis is only re-fetched when the user explicitly calls rerunAnalysis().
    initialData: () => (address ? loadAnalysis(address) : undefined),

    enabled: isConnected && !!address,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { ...query, rerunAnalysis: query.refetch };
}
