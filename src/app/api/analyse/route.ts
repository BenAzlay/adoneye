// POST /api/analyse
//
// Trusted server-side pipeline: fetches wallet positions from Zerion, transforms
// them into a compact LLM-ready dataset, calls OpenAI, and logs the structured
// analysis result. The LLM output is not yet returned to the client — it is
// logged on the server only until the UI rendering layer is ready.
//
// Abuse protection
// ─────────────────
// The cooldown is enforced here, on the server. Client-side checks are
// not sufficient — any request reaching this route is treated as untrusted input.
//
// Privacy
// ───────
// Wallet addresses are never logged in full. The Zerion and OpenAI keys are
// server-only. No raw Zerion payloads are forwarded to the client or the LLM.
import { NextRequest } from 'next/server';
import { fetchZerionPositions, buildPortfolioData } from '@/lib/zerion';
import { buildLLMDataset } from '@/lib/portfolioAnalysis';
import { generateAdoneyePortfolioAnalysis } from '@/lib/llm';
import { checkCooldown, recordAnalysis, redactAddress } from '@/lib/cooldown';
import type { AdoneyePortfolioAnalysis } from '@/types/llm';

export const dynamic = 'force-dynamic';

const VALID_PERIODS = new Set([7, 30, 90]);

export async function POST(request: NextRequest): Promise<Response> {
  // ── Input validation ───────────────────────────────────────────────────────
  const body: unknown = await request.json().catch(() => null);

  if (body === null || typeof body !== 'object') {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const address = b.address;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: 'Invalid or missing address' }, { status: 400 });
  }

  // Accept 7, 30, or 90 day analysis windows. Defaults to 30 if absent or invalid.
  const periodRaw = b.period;
  const period: 7 | 30 | 90 =
    typeof periodRaw === 'number' && VALID_PERIODS.has(periodRaw)
      ? (periodRaw as 7 | 30 | 90)
      : 30;

  // ── Server-side cooldown check ─────────────────────────────────────────────
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
  // The LLM receives only the finished dataset — no raw Zerion data, no wallet
  // addresses, no provider-internal fields.
  const portfolio = buildPortfolioData(address, positions);
  const dataset = buildLLMDataset(portfolio, period);

  // ── LLM analysis ──────────────────────────────────────────────────────────
  // LLM failure must not break portfolio data delivery — analysis is null-safe.
  // The result is logged server-side and returned to the client so the UI can
  // render AI-authored card text. Raw Zerion payloads are never forwarded.
  let analysis: AdoneyePortfolioAnalysis | null = null;
  try {
    analysis = await generateAdoneyePortfolioAnalysis(dataset);
    console.log('[analyse] LLM portfolio analysis result:');
    console.log(JSON.stringify(analysis, null, 2));
  } catch (err) {
    console.error(
      `[analyse] LLM call failed for ${redactAddress(address)}:`,
      (err as Error).message,
    );
  }

  return Response.json({ dataset, analysis });
}
