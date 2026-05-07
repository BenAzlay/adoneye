// Output types for the Adoneye LLM portfolio analysis.
//
// The LLM is responsible for generating the presentation layer only:
// titles, subtitles, summaries, severity assessments, and metric wording.
//
// All numeric values inside InsightMetric.value must originate from
// deterministic app code — the LLM formats them, never calculates them.
// See CLAUDE.md §5: "LLM output must be treated as presentation, not computation."

export type Severity = 'low' | 'medium' | 'high';
export type VisualType = 'bar_chart' | 'pie_chart' | 'table' | 'metric_list';
export type CardType =
  | 'missed_opportunity'
  | 'portfolio_drivers'
  | 'concentration_risk'
  | 'chain_exposure';

export interface InsightMetric {
  label: string;
  value: string;
  highlight?: boolean;
}

export interface InsightCard {
  id: string;
  type: CardType;
  title: string;
  subtitle: string;
  summary: string;
  severity: Severity;
  priority: number; // 1 = most relevant to the user's portfolio decisions
  visualType: VisualType;
  metrics: InsightMetric[];
  assumptions: string[];
}

export interface AdoneyePortfolioAnalysis {
  generatedAt: string;    // ISO 8601 timestamp from the LLM
  periodDays: 7 | 30 | 90;
  summary: string;        // global 2-sentence portfolio overview
  cards: [InsightCard, InsightCard, InsightCard, InsightCard]; // fixed order
}
