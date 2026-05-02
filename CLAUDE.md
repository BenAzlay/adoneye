# CLAUDE.md

## Project: Adoneye

Adoneye is an AI-powered crypto portfolio decision analyst.

The app connects to EVM wallets such as MetaMask or Rabby, fetches portfolio holdings across chains, compares token performance against benchmarks like BTC and ETH, and explains missed opportunities in a clear, user-facing way.

The product should feel serious, secure, minimal, premium, and privacy-conscious.

Adoneye is not a trading bot, not a financial advisor, and not a generic crypto dashboard.

---

## Core Product Philosophy

Adoneye should answer questions like:

- What did this wallet hold?
- Which assets underperformed BTC or ETH?
- What was the estimated opportunity cost?
- Which allocation decisions mattered most?
- How can the user understand their historical portfolio behavior?

The app should focus on **decision intelligence**, not speculation.

Do not build features that turn the product into:

- a trading app
- a price prediction tool
- a generic token screener
- a social trading platform
- a DeFi casino UI
- a wallet-draining or transaction-signing app

---

## Technical Principles

### 1. Keep the system simple

Do not generate unnecessary abstractions, services, factories, wrappers, or helper layers.

Prefer:

- small functions
- clear types
- explicit data flow
- readable business logic
- deterministic calculations

Avoid:

- over-engineered architectures
- premature microservices
- unnecessary generic utilities
- excessive dependency injection
- large “god” services
- code that exists only because it looks scalable

Build the simplest version that correctly supports the current feature.

---

### 2. Do not rely too much on third parties

Third-party APIs are useful, but Adoneye should not become completely dependent on any single provider.

When integrating APIs such as Zerion, Moralis, CoinGecko, Alchemy, or CoinMarketCap:

- Isolate provider-specific code behind a small adapter.
- Normalize all external data into Adoneye-owned internal types.
- Never let third-party response shapes leak throughout the app.
- Add clear error handling for failed or partial provider responses.
- Design fallback paths where reasonable.
- Cache expensive or frequently reused data.
- Avoid calling paid APIs unnecessarily.
- Prefer deterministic backend calculations over provider-generated summaries.

Bad:

```ts
const token = zerionResponse.data.attributes.whatever.deeply.nested;
```

Good:

```ts
const asset: PortfolioAsset = normalizeZerionAsset(rawAsset);
```

Adoneye owns its domain model.

Providers are replaceable.

---

### 3. Treat wallet privacy as a first-class concern

A wallet address can reveal a user’s financial history.

Do not treat wallet addresses as harmless public strings.

Rules:

- Do not log wallet addresses unless absolutely necessary.
- Do not log full API responses containing wallet data.
- Do not expose wallet addresses in client-side analytics.
- Do not send wallet addresses to unnecessary third parties.
- Do not persist wallet data unless the feature explicitly requires it.
- Prefer short-lived cache over permanent storage when possible.
- If storing wallet data, document why it is stored and for how long.
- Avoid linking wallet addresses to email, IP, user accounts, or other identifiers unless strictly required.
- Never add tracking scripts that can associate wallet identity with browsing behavior without explicit review.

Use redaction in logs:

```ts
function redactAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
```

Never display sensitive internal logs in the UI.

---

### 4. Never request transaction permissions unnecessarily

Adoneye is an analytics product.

The app should not request signing or transaction permissions unless a future feature explicitly requires it and the user clearly understands why.

Default wallet behavior:

- Connect wallet for address reading only.
- Do not request token approvals.
- Do not request signatures casually.
- Do not ask users to sign messages for basic portfolio analysis.
- Do not initiate transactions.
- Do not add swap, bridge, or staking flows unless explicitly planned and reviewed.

Connecting a wallet should feel safe.

The user should never wonder whether Adoneye can move funds.

---

### 5. Separate deterministic calculations from LLM output

The LLM must not be the source of truth for financial calculations.

The backend should calculate:

- current portfolio value
- token allocation
- historical return
- benchmark return
- underperformance
- opportunity cost
- ranking
- severity
- confidence level

The LLM should only explain already-computed results.

Bad:

```txt
Ask the LLM to estimate how much SOL underperformed BTC.
```

Good:

```txt
Calculate SOL vs BTC underperformance in code.
Ask the LLM to explain the result in plain English.
```

LLM output must be treated as presentation, not computation.

---

### 6. Avoid financial advice

Adoneye may explain historical performance and missed opportunity cost.

Adoneye must not tell users what to buy, sell, hold, short, leverage, or stake.

Avoid language like:

- “You should buy BTC”
- “Sell this token”
- “This is a bad investment”
- “Move your portfolio into ETH”
- “This token will outperform”

Prefer:

- “Historically, BTC outperformed this asset over the selected period.”
- “This position had the largest estimated opportunity cost.”
- “This suggests concentration risk.”
- “This may be worth reviewing.”
- “This is not financial advice.”

The product should help users understand decisions, not make decisions for them.

---

## Data Model Rules

### 1. Normalize external data

All wallet/token/provider data must be normalized into internal types before being used by the app.

Use internal domain types such as:

```ts
type ChainId = number;

type PortfolioAsset = {
  chainId: ChainId;
  chainName: string;
  tokenAddress: string | null;
  symbol: string;
  name: string;
  balanceRaw: string;
  balanceFormatted: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number;
  logoUrl?: string;
  source: DataProvider;
};

type DataProvider =
  | "zerion"
  | "moralis"
  | "coingecko"
  | "coinmarketcap"
  | "alchemy"
  | "manual";
```

Do not spread third-party provider fields across the application.

---

### 2. Use explicit uncertainty

Crypto data is messy.

Some tokens may be spam, illiquid, unpriced, duplicated, bridged, or incorrectly indexed.

The app should represent uncertainty explicitly.

Use fields such as:

```ts
type DataConfidence = "high" | "medium" | "low";

type PricePoint = {
  timestamp: string;
  priceUsd: number;
  source: DataProvider;
  confidence: DataConfidence;
};
```

Do not pretend all data is equally reliable.

---

### 3. Handle spam and suspicious tokens carefully

Wallets often receive spam tokens.

Rules:

- Do not include all tokens blindly in portfolio value.
- Hide likely spam tokens by default.
- Allow users to reveal hidden assets.
- Mark suspicious assets clearly.
- Do not let spam tokens dominate missed-opportunity calculations.
- Treat unknown, unpriced, or illiquid tokens cautiously.

Possible spam indicators:

- no reliable price
- no trusted metadata
- suspicious symbol/name
- extremely low liquidity
- unsolicited airdrop behavior
- fake token names imitating popular assets

---

## API Integration Rules

### 1. Provider adapters

Each third-party provider should live in its own adapter module.

Example:

```txt
src/server/providers/zerion/
src/server/providers/moralis/
src/server/providers/coingecko/
```

Each adapter should expose clear methods such as:

```ts
getWalletAssets(address: string): Promise<PortfolioAsset[]>
getTokenPriceHistory(input: PriceHistoryInput): Promise<PricePoint[]>
getTransactions(address: string): Promise<WalletTransaction[]>
```

Provider-specific authentication, pagination, retries, rate limits, and response parsing should stay inside the adapter.

---

### 2. Rate limits and caching

Avoid unnecessary external API calls.

Use caching for:

- token metadata
- token logos
- benchmark price history
- historical token prices
- chain metadata
- repeated wallet fetches during the same session

Cache keys should avoid leaking sensitive wallet data where possible.

Do not cache wallet-level data longer than needed unless explicitly justified.

---

### 3. Fail gracefully

Provider failures should not break the entire app.

If one provider fails:

- show partial results where possible
- clearly mark missing data
- avoid crashing the dashboard
- avoid hallucinated fallback values
- give users a simple explanation

Example:

```txt
Some assets could not be priced right now. They were excluded from opportunity-cost calculations.
```

---

## LLM Rules

### 1. The LLM explains, it does not calculate

Always pass the LLM structured, precomputed data.

Do not ask the LLM to fetch wallet data, calculate returns, estimate token prices, or infer balances.

---

### 2. Use structured outputs

When possible, require JSON outputs matching strict schemas.

Example:

```ts
type InsightCard = {
  title: string;
  severity: "low" | "medium" | "high";
  summary: string;
  supportingMetrics: {
    label: string;
    value: string;
  }[];
  disclaimer?: string;
};
```

Validate LLM output before rendering it.

Never render unvalidated LLM JSON directly.

---

### 3. Avoid hallucinated claims

The LLM must not invent:

- market events
- token fundamentals
- protocol risks
- news
- causes of price movement
- future predictions

If the explanation requires external context that was not provided, the LLM should say so.

Preferred wording:

```txt
Based only on the available portfolio and price data...
```

---

### 4. Do not send unnecessary private data to LLM providers

Only send the minimum data required to generate the explanation.

Avoid sending:

- full transaction histories unless needed
- wallet addresses unless needed
- user identifiers
- emails
- IP addresses
- raw provider responses
- hidden tokens
- unrelated assets

Prefer sending aggregated metrics:

```ts
{
  token: "SOL",
  benchmark: "BTC",
  period: "90d",
  actualReturnPct: -12.4,
  benchmarkReturnPct: 18.7,
  opportunityCostUsd: 4230
}
```

---

## Security Rules

### 1. No secrets in client code

Never expose API keys, provider secrets, database credentials, or signing keys to the frontend.

Use server-side routes for third-party API calls requiring secrets.

---

### 2. Validate all user input

Validate:

- wallet addresses
- chain IDs
- token addresses
- time ranges
- benchmark symbols
- pagination parameters
- query parameters

Do not trust client input.

---

### 3. Sanitize rendered content

LLM output and token metadata may contain unsafe strings.

Do not render arbitrary HTML from:

- LLM responses
- token names
- token symbols
- provider metadata
- user-generated content

Use safe text rendering by default.

---

### 4. Protect against wallet scams

The app must not display provider-provided links or token URLs without caution.

Do not add “claim,” “airdrop,” “approve,” or “swap” interactions based on token metadata.

Do not encourage users to interact with unknown contracts.

---

## Opportunity Cost Engine Rules

The core value of Adoneye is deterministic missed-opportunity analysis.

Prioritize correctness and clarity.

### Required calculations

For each asset and selected period:

```txt
actualReturnPct
benchmarkReturnPct
relativePerformancePct
estimatedOpportunityCostUsd
```

Opportunity cost should be ranked primarily by dollar impact, not only by percentage.

Bad:

```txt
A $10 token underperformed by 95%, so it is ranked first.
```

Good:

```txt
A $20,000 position underperformed BTC by 12%, creating a larger actual opportunity cost.
```

---

### Be explicit about assumptions

Always document assumptions such as:

- period start date
- period end date
- price source
- whether current holdings are used as proxy for historical holdings
- whether cash flows were considered
- whether DeFi positions were included
- whether spam/unpriced tokens were excluded

If a calculation is approximate, say so.

---

### Avoid false precision

Do not show excessive decimal places.

Prefer:

```txt
BTC outperformed SOL by 18.4%
Estimated opportunity cost: $4,230
```

Avoid:

```txt
BTC outperformed SOL by 18.392847291%
Estimated opportunity cost: $4,230.238491
```

---

## UI / UX Rules

### 1. Tone

The UI should feel:

- premium
- calm
- analytical
- precise
- secure
- oracle-like
- slightly sacred-tech

Avoid:

- hype
- panic
- gambling language
- meme language
- overly aggressive trading language

---

### 2. Color theme

Use the Adoneye dark theme:

```css
:root {
  --background: #050505;
  --surface: #111111;
  --surface-elevated: #1A1A1A;

  --primary: #F7931A;
  --primary-soft: #FFB347;

  --text-primary: #F5F1E8;
  --text-muted: #9A9A9A;

  --gain: #39D98A;
  --loss: #FF4D4D;
}
```

Use orange as a signal color, not as a base color.

Orange should highlight:

- primary CTA
- active state
- AI insight accent
- benchmark comparison
- missed opportunity emphasis

Do not overuse orange.

---

### 3. Explain before alarming

Missed opportunity data can make users feel regret.

The product should be honest but not emotionally manipulative.

Avoid:

```txt
You lost $4,230 by holding SOL.
```

Prefer:

```txt
Compared with holding BTC over the same period, this SOL position had an estimated opportunity cost of $4,230.
```

---

## Code Style Rules

### 1. Prefer explicit names

Good:

```ts
calculateBenchmarkOpportunityCost()
normalizeZerionWalletAsset()
isLikelySpamToken()
```

Bad:

```ts
processData()
handleStuff()
format()
```

---

### 2. Keep files focused

Avoid files that mix:

- API calls
- normalization
- database writes
- calculations
- UI rendering
- LLM prompting

Separate concerns clearly.

---

### 3. Write comments where reasoning matters

Use comments to explain:

- financial assumptions
- privacy decisions
- provider quirks
- security-sensitive logic
- non-obvious calculations
- fallback behavior

Do not write comments that merely repeat the code.

Bad:

```ts
// Add one to count
count += 1;
```

Good:

```ts
// We rank by dollar impact instead of percentage because small dust positions
// can show extreme percentage moves but are irrelevant to the user's portfolio.
```

---

### 4. Avoid unnecessary dependencies

Before adding a dependency, ask:

- Is this actually needed?
- Can the platform/framework already do this?
- Is the package maintained?
- Does it increase bundle size?
- Does it touch wallet data?
- Does it introduce security risk?

Prefer native APIs and small focused packages.

---

### 5. Do not generate huge code changes unnecessarily

Make minimal, targeted changes.

Before editing many files, understand the current structure.

Do not rewrite large parts of the app unless specifically requested.

When making changes, summarize:

- what changed
- why it changed
- any tradeoffs
- any follow-up work

---

## Testing Rules

Prioritize tests for deterministic financial logic.

Add tests for:

- opportunity cost calculations
- benchmark comparisons
- spam filtering
- normalization adapters
- price history alignment
- date range handling
- missing price data
- partial provider failures

Mock third-party APIs in tests.

Do not make tests depend on live API responses.

---

## Logging Rules

Logs should help debugging without leaking user data.

Do not log:

- full wallet addresses
- full portfolio contents
- raw provider responses
- LLM prompts containing wallet data
- API keys
- user identifiers

Use redacted addresses and high-level event names.

Good:

```txt
Fetched portfolio for wallet 0x1234...abcd from zerion: 42 assets
```

Bad:

```txt
Fetched full portfolio for 0x123456789...: {...raw response...}
```

---

## Error Handling Rules

Errors should be useful but not scary.

Good:

```txt
Some token prices are unavailable, so they were excluded from missed-opportunity calculations.
```

Bad:

```txt
Provider error: Cannot read properties of undefined
```

Never expose stack traces or provider internals to users.

---

## Performance Rules

Avoid slow dashboards.

Use:

- server-side caching
- request deduplication
- pagination where appropriate
- lazy loading for historical analysis
- background refresh for expensive calculations
- skeleton states for loading UI

Do not fetch historical prices for every token immediately if the user has a large wallet.

Start with top-value assets first.

---

## MVP Scope

The first version should focus on:

1. Connect EVM wallet.
2. Fetch current portfolio assets.
3. Filter spam/unpriced assets.
4. Show portfolio allocation.
5. Compare top assets against BTC and ETH.
6. Calculate missed opportunity.
7. Generate AI explanations from precomputed results.
8. Display concise insight cards.

Do not build yet:

- swaps
- bridging
- staking
- social features
- copy trading
- price predictions
- portfolio auto-rebalancing
- tax reporting
- complex account system
- mobile app
- custom indexer

---

## Final Instruction

When working on Adoneye, always optimize for:

1. User trust
2. Wallet privacy
3. Calculation correctness
4. Clear explanations
5. Minimal dependencies
6. Replaceable providers
7. Clean product experience
8. Small, maintainable code changes

Adoneye should feel like a secure AI portfolio oracle — not a noisy crypto dashboard.
