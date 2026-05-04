'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  PieChart,
  Pie,
} from 'recharts';
import { InsightCard } from './InsightCard';
import type { LLMPortfolioAnalysisDataset } from '@/types/analysis';
import type { AdoneyePortfolioAnalysis, InsightCard as InsightCardData } from '@/types/llm';

// ── Design tokens for charts (mirrors globals.css) ──────────────────────────
const C = {
  primary:    '#F7931A',
  primarySoft:'#FFB347',
  muted:      '#9A9A9A',
  border:     'rgba(255,255,255,0.06)',
  surface:    '#1A1A1A',
  gain:       '#39D98A',
  loss:       '#FF4D4D',
};

const CHAIN_COLORS: Record<string, string> = {
  Ethereum:      '#627EEA',
  Polygon:       '#8247E5',
  Arbitrum:      '#28A0F0',
  Optimism:      '#FF0420',
  Base:          '#2151F5',
  'BNB Chain':   '#F3BA2F',
  Avalanche:     '#E84142',
};

const TOOLTIP_STYLE = {
  contentStyle: {
    background: C.surface,
    border: `1px solid rgba(247,147,26,0.2)`,
    borderRadius: 8,
    fontSize: 11,
    color: '#F5F1E8',
  },
  itemStyle: { color: '#F5F1E8' },
  cursor: { fill: 'rgba(247,147,26,0.06)' },
};

// Interpolate between orange and a dim gray based on rank
function barColor(index: number, total: number): string {
  if (index === 0) return C.primary;
  if (index === 1) return C.primarySoft;
  const fade = Math.max(0.15, 1 - index / total);
  return `rgba(100,100,100,${fade})`;
}

// ── Shared horizontal bar chart (used by missed_opportunity + portfolio_drivers)
function HBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(100, data.length * 28)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 6, bottom: 0, left: 0 }}
      >
        <XAxis type="number" hide domain={[0, 100]} />
        <YAxis
          type="category"
          dataKey="name"
          width={44}
          tick={{ fill: C.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(v) => [`${(v as number).toFixed(1)}%`, 'Allocation']}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={14}>
          {data.map((_, i) => (
            <Cell key={i} fill={barColor(i, data.length)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut chart (concentration_risk) ──────────────────────────────────────
const DONUT_COLORS = [C.primary, C.primarySoft, '#6B6B6B', '#4A4A4A', '#2E2E2E', '#1E1E1E'];

function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={44}
          outerRadius={66}
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_COLORS[i] ?? '#1A1A1A'} />
          ))}
        </Pie>
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(v, _key, props) => [`${(v as number).toFixed(1)}%`, props.payload.name]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Chain bar chart (chain_exposure) ──────────────────────────────────────
function ChainBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(80, data.length * 28)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 6, bottom: 0, left: 0 }}
      >
        <XAxis type="number" hide domain={[0, 100]} />
        <YAxis
          type="category"
          dataKey="name"
          width={72}
          tick={{ fill: C.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(v) => [`${(v as number).toFixed(1)}%`, 'Chain share']}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={14}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={CHAIN_COLORS[entry.name] ?? C.muted} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Card data helpers ──────────────────────────────────────────────────────

function cardFor(analysis: AdoneyePortfolioAnalysis | null, type: string): InsightCardData | undefined {
  return analysis?.cards.find(c => c.type === type);
}

interface Props {
  dataset: LLMPortfolioAnalysisDataset;
  analysis: AdoneyePortfolioAnalysis | null;
}

// ── Main export ────────────────────────────────────────────────────────────
export function AnalysisCards({ dataset, analysis }: Props) {
  // ── Missed Opportunity ─────────────────────────────────────────────────
  const moCard = cardFor(analysis, 'missed_opportunity');
  const moData = dataset.benchmarkContext.eligiblePositions
    .slice(0, 5)
    .map(p => ({ name: p.symbol, value: p.allocationPct }));

  // ── Portfolio Drivers ──────────────────────────────────────────────────
  const pdCard = cardFor(analysis, 'portfolio_drivers');
  const pdData = dataset.portfolioDrivers.positions
    .slice(0, 5)
    .map(p => ({ name: p.symbol, value: p.allocationPct }));

  // ── Concentration Risk ─────────────────────────────────────────────────
  const crCard = cardFor(analysis, 'concentration_risk');
  const top5Sum = dataset.positions.slice(0, 5).reduce((s, p) => s + p.allocationPct, 0);
  const othersAlloc = Math.max(0, Math.round((100 - top5Sum) * 100) / 100);
  const crData = [
    ...dataset.positions.slice(0, 5).map(p => ({ name: p.symbol, value: p.allocationPct })),
    ...(othersAlloc > 0.5 ? [{ name: 'Others', value: othersAlloc }] : []),
  ];

  // ── Chain Exposure ─────────────────────────────────────────────────────
  const ceCard = cardFor(analysis, 'chain_exposure');
  const ceData = dataset.walletSummary.chainAllocation
    .slice(0, 6)
    .map(c => ({ name: c.chain, value: c.allocationPct }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* 1 — Missed Opportunity */}
      <InsightCard
        title={moCard?.title ?? 'Missed Opportunity'}
        subtitle={moCard?.subtitle ?? 'Same-chain benchmark comparison'}
        summary={moCard?.summary}
        severity={moCard?.severity}
        metrics={moCard?.metrics}
        assumptions={moCard?.assumptions}
      >
        {moData.length > 0 && <HBarChart data={moData} />}
      </InsightCard>

      {/* 2 — Portfolio Drivers */}
      <InsightCard
        title={pdCard?.title ?? 'Portfolio Drivers'}
        subtitle={pdCard?.subtitle ?? 'Position weight by USD value'}
        summary={pdCard?.summary}
        severity={pdCard?.severity}
        metrics={pdCard?.metrics}
        assumptions={pdCard?.assumptions}
      >
        {pdData.length > 0 && <HBarChart data={pdData} />}
      </InsightCard>

      {/* 3 — Concentration Risk */}
      <InsightCard
        title={crCard?.title ?? 'Concentration Risk'}
        subtitle={crCard?.subtitle ?? 'Allocation spread across top positions'}
        summary={crCard?.summary}
        severity={crCard?.severity}
        metrics={crCard?.metrics ?? [
          { label: 'Top asset', value: `${dataset.concentrationRisk.topAssetSymbol} · ${dataset.concentrationRisk.topAssetPct.toFixed(1)}%` },
          { label: 'Top 3 combined', value: `${dataset.concentrationRisk.top3Pct.toFixed(1)}%` },
          { label: 'Top 5 combined', value: `${dataset.concentrationRisk.top5Pct.toFixed(1)}%` },
          { label: 'Total positions', value: dataset.concentrationRisk.positionCount.toString() },
        ]}
        assumptions={crCard?.assumptions}
      >
        {crData.length > 0 && <DonutChart data={crData} />}
      </InsightCard>

      {/* 4 — Chain Exposure */}
      <InsightCard
        title={ceCard?.title ?? 'Chain Exposure'}
        subtitle={ceCard?.subtitle ?? 'Portfolio value by EVM chain'}
        summary={ceCard?.summary}
        severity={ceCard?.severity}
        metrics={ceCard?.metrics ?? dataset.walletSummary.chainAllocation.slice(0, 4).map(c => ({
          label: c.chain,
          value: `${c.allocationPct.toFixed(1)}%`,
        }))}
        assumptions={ceCard?.assumptions}
      >
        {ceData.length > 0 && <ChainBarChart data={ceData} />}
      </InsightCard>
    </div>
  );
}
