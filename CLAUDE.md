# CLAUDE.md — Adoneye

Adoneye is an AI-powered EVM portfolio decision analyst. It connects to wallets (MetaMask, Rabby), fetches holdings across chains, compares token performance against BTC/ETH benchmarks, and explains missed opportunities. It is not a trading bot, price predictor, or generic dashboard.

---

## Product Scope

Build only: wallet connect (read-only), portfolio fetch, spam filtering, allocation view, benchmark comparison, opportunity cost calculation, AI insight cards.

Do not build: swaps, bridging, staking, social features, copy trading, price predictions, tax reporting, mobile app.

---

## Privacy — Wallet Data is Sensitive

- Never log full wallet addresses. Use `address.slice(0,6)...address.slice(-4)` in logs.
- Never log raw provider responses containing wallet data.
- Never expose wallet addresses to client-side analytics or unnecessary third parties.
- Never persist wallet data beyond what the feature requires.
- Never link wallet addresses to email, IP, or user identifiers unless strictly needed.
- Connect wallet for address reading only — no signatures, no approvals, no transactions.

---

## Security

- No API keys, secrets, or credentials in client code. Use server-side routes for all provider calls.
- Validate all user input: wallet addresses, chain IDs, token addresses, time ranges, query params.
- Never render arbitrary HTML from LLM output, token names/symbols, or provider metadata.
- Never display provider-supplied links/URLs for unknown tokens. No "claim," "airdrop," "approve," or "swap" interactions from token metadata.

---

## LLM Rules

- **The LLM explains; it never calculates.** All financial values (returns, opportunity cost, rankings, severity) must be computed in code before being sent to the LLM.
- Send only aggregated metrics to the LLM — never raw wallet data, full transaction history, wallet addresses, or user identifiers.
- Require structured JSON output. Validate before rendering.
- The LLM must not invent market events, protocol risks, price causes, or future predictions. If context is missing, it should say so.
- No financial advice language. Prefer: "Historically, BTC outperformed this asset" over "You should sell."

---

## Providers & Data

- Each provider lives in its own adapter (`src/server/providers/zerion/`, etc.). Provider shapes never leak into the rest of the app.
- Normalize all external data into internal `PortfolioAsset` / `PricePoint` types with explicit `source` and `confidence` fields.
- Cache token metadata, logos, benchmark prices, and repeated wallet fetches. Avoid calling paid APIs unnecessarily.
- If a provider fails: show partial results, mark missing data, never crash, never hallucinate fallback values.

---

## Spam Tokens

- Hide likely spam tokens by default. Do not include in portfolio value or opportunity cost rankings.
- Spam indicators: no reliable price, suspicious name/symbol, no trusted metadata, unsolicited airdrop.
- Allow users to reveal hidden assets.

---

## Opportunity Cost Engine

- Calculate per asset: `actualReturnPct`, `benchmarkReturnPct`, `relativePerformancePct`, `estimatedOpportunityCostUsd`.
- **Rank by dollar impact**, not percentage. A $20k position –12% matters more than a $10 position –95%.
- Document assumptions: period dates, price source, whether current holdings proxy historical holdings, whether DeFi/spam are excluded.
- Avoid false precision: `18.4%` and `$4,230`, not `18.392847291%` and `$4,230.238491`.

---

## UI Tone & Theme

Tone: premium, calm, analytical, oracle-like, sacred-tech. No hype, panic, or gambling language.

```
--background: #050505   --surface: #111111   --surface-elevated: #1A1A1A
--primary: #F7931A      --primary-soft: #FFB347
--text-primary: #F5F1E8 --text-muted: #9A9A9A
--gain: #39D98A         --loss: #FF4D4D
```

Orange is a signal color only (CTA, active state, AI accent, missed opportunity). Do not overuse.

Framing: "Compared with holding BTC, this position had an estimated opportunity cost of $4,230." Not: "You lost $4,230 by holding SOL."

---

## Code Style

- Minimal, targeted changes. Understand structure before editing multiple files.
- Explicit names: `calculateBenchmarkOpportunityCost()`, not `processData()`.
- One concern per file: no mixing API calls, normalization, DB writes, calculations, and UI rendering.
- Comments only for non-obvious reasoning (financial assumptions, privacy decisions, provider quirks). Never repeat what the code says.
- No unnecessary dependencies. Check: is it needed? does the platform already do this? does it touch wallet data?
- Tests for financial logic must mock provider APIs — never depend on live responses.
