// Server-side OpenAI integration for Adoneye portfolio analysis.
//
// The LLM receives only the compact, pre-computed LLMPortfolioAnalysisDataset.
// It never receives raw Zerion payloads, wallet addresses, API keys, or any
// field not explicitly included in the dataset type (see CLAUDE.md §2, §3, §4).
//
// The LLM's role is presentation only — it generates titles, summaries,
// severity assessments, and metric wording. All numeric values in the output
// cards must originate from deterministic app code (see CLAUDE.md §5).
//
// Same-chain EVM wrapped benchmarks (WBTC, WETH, cbBTC) are required for
// missed-opportunity framing. Native BTC is not a valid EVM benchmark and must
// not be referenced. This constraint is enforced via the system prompt so the
// LLM cannot invent off-chain benchmark comparisons.
//
// The result is console-logged on the server only. It is not yet returned to
// the client — UI rendering will be added in a later iteration once the output
// shape is validated against real wallet data.
import type { LLMPortfolioAnalysisDataset } from '@/types/analysis';
import type { AdoneyePortfolioAnalysis, InsightCard, Severity, VisualType } from '@/types/llm';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_TOKENS = 600;

// Concise system prompt to minimise input token cost while enforcing the rules
// that protect users from hallucinated financial data and bad advice.
const SYSTEM_PROMPT = `You are Adoneye, an AI portfolio decision analyst. Your role is to explain pre-computed portfolio metrics using calm, precise, analytical language.

STRICT RULES:
1. Use ONLY values from the provided dataset. Never calculate, invent, or estimate any financial figure.
2. No financial advice. Never recommend buying, selling, staking, swapping, bridging, or holding any asset.
3. No price predictions. No invented market events. No invented benchmark returns.
4. If returnPct, contributionPct, or benchmark return data is null or unavailable, acknowledge the limitation.
5. Reference EVM benchmarks as wrapped tokens with their chain (e.g. "WBTC on Ethereum", "WETH on Base"). Never reference native BTC as a benchmark.
6. No hype. No emotional phrasing. Prefer "this position had the largest allocation" over "you missed out on gains."
7. Return JSON only. No markdown fences. No prose outside the JSON object.

OUTPUT: Exactly this JSON structure with 4 cards in this fixed order:
missed_opportunity → portfolio_drivers → concentration_risk → chain_exposure

Be concise: titles 3-5 words, summaries 2 short sentences, max 5 metrics per card.

{
  "generatedAt": "<ISO 8601>",
  "periodDays": <7|30|90>,
  "summary": "<2 short sentences global overview>",
  "cards": [
    {
      "id": "missed_opportunity",
      "type": "missed_opportunity",
      "title": "<3-5 words>",
      "subtitle": "<one sentence>",
      "summary": "<2 short sentences using only provided values>",
      "severity": "low|medium|high",
      "priority": <1-4, 1=most important>,
      "visualType": "bar_chart|pie_chart|table|metric_list",
      "metrics": [{"label": "...", "value": "..."}],
      "assumptions": ["<one sentence per assumption>"]
    },
    { "id": "portfolio_drivers", ... },
    { "id": "concentration_risk", ... },
    { "id": "chain_exposure", ... }
  ]
}`;

export async function generateAdoneyePortfolioAnalysis(
  dataset: LLMPortfolioAnalysisDataset,
): Promise<AdoneyePortfolioAnalysis> {
  const apiKey = process.env.OPENAI_API;
  if (!apiKey) throw new Error('OPENAI_API not configured');

  const model = process.env.LLM_MODEL ?? DEFAULT_MODEL;
  const maxTokens =
    parseInt(process.env.LLM_MAX_OUTPUT_TOKENS ?? '', 10) || DEFAULT_MAX_TOKENS;

  // Send only the compact dataset — never raw provider payloads or wallet addresses.
  // Compact serialisation (no indentation) reduces input token cost.
  const userContent = JSON.stringify({ dataset });

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // Low temperature for consistent, deterministic analytical language.
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      // json_object mode guarantees a parseable response even if the model
      // would otherwise wrap the output in markdown or add prose.
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const body: {
    choices?: Array<{ message?: { content?: string | null } }>;
  } = await res.json();

  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('OpenAI response was not valid JSON');
  }

  if (!isAdoneyePortfolioAnalysis(parsed)) {
    throw new Error('OpenAI response did not match the expected AdoneyePortfolioAnalysis schema');
  }

  return parsed;
}

// ── Structural validation ──────────────────────────────────────────────────────
// We validate the minimum required shape before returning. This prevents
// downstream rendering code from receiving partial or hallucinated structures.

function isAdoneyePortfolioAnalysis(v: unknown): v is AdoneyePortfolioAnalysis {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.generatedAt === 'string' &&
    typeof obj.summary === 'string' &&
    Array.isArray(obj.cards) &&
    obj.cards.length === 4 &&
    obj.cards.every(isInsightCard)
  );
}

function isInsightCard(v: unknown): v is InsightCard {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.type === 'string' &&
    typeof c.title === 'string' &&
    typeof c.subtitle === 'string' &&
    typeof c.summary === 'string' &&
    isSeverity(c.severity) &&
    typeof c.priority === 'number' &&
    isVisualType(c.visualType) &&
    Array.isArray(c.metrics) &&
    Array.isArray(c.assumptions)
  );
}

function isSeverity(v: unknown): v is Severity {
  return v === 'low' || v === 'medium' || v === 'high';
}

function isVisualType(v: unknown): v is VisualType {
  return v === 'bar_chart' || v === 'pie_chart' || v === 'table' || v === 'metric_list';
}
