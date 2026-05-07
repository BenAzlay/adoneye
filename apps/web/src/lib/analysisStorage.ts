// Client-side persistence for portfolio analysis results.
//
// Analysis is stored indefinitely — it survives page refresh and browser close.
// It is replaced only when the user explicitly runs a new analysis.
// Keyed by normalized wallet address so multiple wallets are handled independently.
//
// These functions must only be called from client-side code.
// All functions guard against SSR (typeof window) and corrupted JSON.
import type { PersistedAnalysis } from '@/types/analysis';

function key(address: string): string {
  return `adoneye:analysis:${address.toLowerCase()}`;
}

export function loadAnalysis(address: string): PersistedAnalysis | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(key(address));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    // Minimal shape check — guards against stale data from old schema versions
    if (
      typeof parsed !== 'object' || parsed === null ||
      !('dataset' in parsed) || !('createdAt' in parsed)
    ) return undefined;
    return parsed as PersistedAnalysis;
  } catch {
    return undefined;
  }
}

export function saveAnalysis(address: string, data: PersistedAnalysis): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key(address), JSON.stringify(data));
  } catch {
    // localStorage may be full or blocked (private browsing, storage quota).
    // Fail silently — analysis still works; it just won't persist across refreshes.
  }
}
