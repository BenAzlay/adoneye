// Server-side rate-limit store for portfolio analysis requests.
//
// A module-level Map persists across requests within the same Node.js process,
// which is sufficient for local dev and single-instance deployments.
//
// PRODUCTION NOTE: Serverless runtimes (Vercel, AWS Lambda) spin up isolated
// instances that do not share memory. Replace cooldownStore with a persistent
// shared store — e.g. Redis or Vercel KV — using the same checkCooldown /
// recordAnalysis interface so the rest of the code needs no changes.
import { PORTFOLIO_ANALYSIS_COOLDOWN_SECONDS } from '@/constants/analysis';

const cooldownStore = new Map<string, number>(); // normalised address → timestamp (ms)

// Redact a wallet address for safe logging.
// Never log the full address — it can be linked to a user's financial history.
export function redactAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function checkCooldown(
  address: string,
): { allowed: boolean; remainingSeconds: number } {
  // Normalise to lowercase to prevent mixed-case bypass (EIP-55 checksummed vs raw).
  const key = address.toLowerCase();
  const last = cooldownStore.get(key);
  if (last === undefined) return { allowed: true, remainingSeconds: 0 };

  const elapsedSeconds = (Date.now() - last) / 1000;
  const remaining = Math.ceil(PORTFOLIO_ANALYSIS_COOLDOWN_SECONDS - elapsedSeconds);
  return remaining > 0
    ? { allowed: false, remainingSeconds: remaining }
    : { allowed: true, remainingSeconds: 0 };
}

// Record that an analysis was performed for this address.
// Call this after data is successfully fetched so that transient provider
// errors do not consume the user's cooldown window unnecessarily.
export function recordAnalysis(address: string): void {
  cooldownStore.set(address.toLowerCase(), Date.now());
}
