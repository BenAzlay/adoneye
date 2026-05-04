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
import { fetchZerionPositions, buildPortfolioData, fetchFungibleReturn, findFungibleId, CHAIN_SLUG_BY_NAME } from '@/lib/zerion';
import { buildLLMDataset, getEligibleForReturns, getEligibleWithoutFungibleId } from '@/lib/portfolioAnalysis';
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
  const portfolio = buildPortfolioData(address, positions);

  // ── Resolve missing fungible IDs ───────────────────────────────────────────
  // Zerion's positions endpoint sometimes omits the fungible relationship (or
  // returns only a links entry with no data.id). For holdings that are otherwise
  // eligible but lack a fungible ID, search the Zerion fungibles catalogue and
  // patch the ID onto the holding in-place before the chart-fetch step.
  const missingIdHoldings = getEligibleWithoutFungibleId(portfolio);
  if (missingIdHoldings.length > 0) {
    console.log(`[analyse] searching for fungible IDs for ${missingIdHoldings.length} position(s)`);
    const searches = await Promise.allSettled(
      missingIdHoldings.map(h => {
        const chainSlug = CHAIN_SLUG_BY_NAME[h.chain] ?? h.chain.toLowerCase();
        return findFungibleId(h.symbol, chainSlug, key)
          .then(id => ({ holding: h, id }));
      }),
    );
    for (const r of searches) {
      if (r.status === 'fulfilled' && r.value.id) {
        r.value.holding.fungibleId = r.value.id;
        console.log(`[analyse] resolved fungible ID for ${r.value.holding.symbol}: ${r.value.id}`);
      }
    }
  }

  const eligibleHoldings = getEligibleForReturns(portfolio);

  // ── Diagnostic: log fungible ID extraction results ─────────────────────────
  const withId    = eligibleHoldings.filter(h => h.fungibleId !== null);
  const withoutId = eligibleHoldings.filter(h => h.fungibleId === null);
  console.log(
    `[analyse] eligible: ${eligibleHoldings.length} total, ` +
    `${withId.length} with fungibleId, ${withoutId.length} without. ` +
    `IDs: ${withId.map(h => `${h.symbol}=${h.fungibleId}`).join(', ') || 'none'}`,
  );

  // Prefer ETH on Ethereum; fall back to WETH, then ETH on any chain
  const ethInWallet =
    eligibleHoldings.find(h => h.symbol === 'ETH'  && h.chain === 'Ethereum') ??
    eligibleHoldings.find(h => h.symbol === 'WETH') ??
    eligibleHoldings.find(h => h.symbol === 'ETH');

  const wbtcInWallet =
    eligibleHoldings.find(h => h.symbol === 'WBTC') ??
    eligibleHoldings.find(h => h.symbol === 'CBBTC') ??
    eligibleHoldings.find(h => h.symbol === 'BTCB');

  // Resolve Zerion fungible IDs for benchmarks: wallet first, then search API
  const [ethFungibleId, wbtcFungibleId] = await Promise.all([
    ethInWallet?.fungibleId  != null ? Promise.resolve(ethInWallet.fungibleId)  : findFungibleId('ETH',  'ethereum', key, true),
    wbtcInWallet?.fungibleId != null ? Promise.resolve(wbtcInWallet.fungibleId) : findFungibleId('WBTC', 'ethereum', key, false),
  ]);

  console.log(`[analyse] benchmark fungible IDs — ETH: ${ethFungibleId ?? 'null'}, WBTC: ${wbtcFungibleId ?? 'null'}`);

  // Build the set of Zerion chart fetches (positions + benchmarks, deduplicated)
  const toFetch = new Map<string, true>();
  for (const h of eligibleHoldings) if (h.fungibleId) toFetch.set(h.fungibleId, true);
  if (ethFungibleId)  toFetch.set(ethFungibleId,  true);
  if (wbtcFungibleId) toFetch.set(wbtcFungibleId, true);

  console.log(`[analyse] Zerion chart fetches: ${toFetch.size} (${[...toFetch.keys()].join(', ')})`);

  const returnResults = await Promise.allSettled(
    [...toFetch.keys()].map(id =>
      fetchFungibleReturn(id, period, key).then(ret => ({ fungibleId: id, returnDecimal: ret })),
    ),
  );

  const priceReturns = new Map<string, number>();
  for (const r of returnResults) {
    if (r.status === 'fulfilled' && r.value.returnDecimal !== null) {
      priceReturns.set(r.value.fungibleId, r.value.returnDecimal);
    }
  }

  const ethReturnDecimal = ethFungibleId ? priceReturns.get(ethFungibleId) ?? null : null;
  const btcReturnDecimal = wbtcFungibleId ? priceReturns.get(wbtcFungibleId) ?? null : null;

  const benchmarkRef = ethReturnDecimal !== null
    ? { symbol: 'ETH', returnDecimal: ethReturnDecimal }
    : null;

  const dataset = buildLLMDataset(portfolio, period, priceReturns, benchmarkRef, btcReturnDecimal);

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
