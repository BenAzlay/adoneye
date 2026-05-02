// POST /api/analyse
//
// Trusted server-side pipeline: fetches wallet positions from Zerion, transforms
// them into a compact LLM-ready dataset, and returns it.
//
// Abuse protection
// ─────────────────
// The cooldown is enforced here, on the server. Client-side checks are
// not sufficient — any request reaching this route is treated as untrusted input.
//
// Privacy
// ───────
// Wallet addresses are never logged in full. The Zerion key is server-only.
// No raw Zerion payloads are returned to the caller.
import { NextRequest } from 'next/server';
import { fetchZerionPositions, buildPortfolioData } from '@/lib/zerion';
import { buildLLMDataset } from '@/lib/portfolioAnalysis';
import { checkCooldown, recordAnalysis, redactAddress } from '@/lib/cooldown';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  // ── Input validation ───────────────────────────────────────────────────────
  const body: unknown = await request.json().catch(() => null);
  const address =
    body !== null && typeof body === 'object' && 'address' in body
      ? (body as { address: unknown }).address
      : undefined;

  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: 'Invalid or missing address' }, { status: 400 });
  }

  // ── Server-side cooldown check ────────────────────────────────────────────
  // This check cannot be bypassed from the client — it runs in the trusted
  // server layer regardless of what the client sends.
  const cooldown = checkCooldown(address);
  if (!cooldown.allowed) {
    return Response.json(
      {
        error: `Analysis requested too soon. Please wait ${cooldown.remainingSeconds} seconds before trying again.`,
        remainingSeconds: cooldown.remainingSeconds,
      },
      { status: 429 },
    );
  }

  const key = process.env.ZERION_API;
  if (!key) return Response.json({ error: 'ZERION_API not configured' }, { status: 500 });

  // ── Fetch from Zerion ──────────────────────────────────────────────────────
  let positions;
  try {
    positions = await fetchZerionPositions(address, key);
  } catch (err) {
    // Log with redacted address — never log the full wallet address.
    console.error(
      `[analyse] Zerion fetch failed for ${redactAddress(address)}:`,
      (err as Error).message,
    );
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }

  // Record the cooldown after a successful fetch so that transient provider
  // errors do not consume the user's 10-minute window.
  recordAnalysis(address);

  // ── Build dataset ──────────────────────────────────────────────────────────
  // All metrics are computed deterministically here.
  // The LLM receives only the finished dataset — no raw Zerion data.
  const portfolio = buildPortfolioData(address, positions);
  const dataset = buildLLMDataset(portfolio);

  return Response.json(dataset);
}
