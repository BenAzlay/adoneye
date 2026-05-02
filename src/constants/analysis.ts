// How long (in seconds) a wallet must wait between portfolio analysis requests.
// Enforced server-side only — never rely on client-side checks.
export const PORTFOLIO_ANALYSIS_COOLDOWN_SECONDS = 600;

// Positions below this USD value are classified as dust and excluded from
// LLM analysis to reduce noise and token cost.
export const DUST_THRESHOLD_USD = 1;

// Maximum number of positions included in the LLM dataset.
// Keeping this small limits token cost while covering the meaningful holdings.
export const TOP_POSITIONS_LIMIT = 20;
