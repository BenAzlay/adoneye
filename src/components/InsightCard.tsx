'use client';

import { useState } from 'react';
import type { Severity } from '@/types/llm';

const SEVERITY_BADGE: Record<Severity, string> = {
  high:   'bg-loss/15 text-loss border-loss/20',
  medium: 'bg-primary/15 text-primary-soft border-primary/20',
  low:    'bg-gain/15 text-gain border-gain/20',
};

interface Metric {
  label: string;
  value: string;
  highlight?: boolean;
}

interface InsightCardProps {
  title?: string;
  subtitle?: string;
  summary?: string;
  severity?: Severity;
  metrics?: Metric[];
  assumptions?: string[];
  isLoading?: boolean;
  children?: React.ReactNode; // chart slot
}

export function InsightCard({
  title,
  subtitle,
  summary,
  severity,
  metrics = [],
  assumptions = [],
  isLoading = false,
  children,
}: InsightCardProps) {
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-surface border border-border-accent p-6 flex flex-col gap-4 min-h-72">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <div className="h-4 w-32 bg-surface-elevated rounded animate-pulse" />
            <div className="h-3 w-44 bg-surface-elevated rounded animate-pulse" />
          </div>
          <div className="h-5 w-14 bg-surface-elevated rounded-md animate-pulse shrink-0" />
        </div>
        <div className="flex-1 min-h-36 bg-surface-elevated rounded-xl animate-pulse" />
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="h-3 w-full bg-surface-elevated rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-surface-elevated rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface border border-border-accent p-6 flex flex-col gap-4 min-h-72">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {severity && (
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-md border ${SEVERITY_BADGE[severity]}`}>
            {severity}
          </span>
        )}
      </div>

      {/* Chart slot */}
      {children && (
        <div className="flex-1 min-h-36">
          {children}
        </div>
      )}

      {/* Summary */}
      {summary && (
        <p className="text-xs text-muted leading-relaxed">{summary}</p>
      )}

      {/* Metrics */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-border">
          {metrics.slice(0, 6).map((m) => (
            <div key={m.label}>
              <div className="text-xs text-muted">{m.label}</div>
              <div className={`text-sm font-medium tabular-nums mt-0.5 ${m.highlight ? 'text-primary' : 'text-foreground'}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assumptions — collapsed footer */}
      {assumptions.length > 0 && (
        <div className="pt-1 border-t border-border">
          <button
            onClick={() => setAssumptionsOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted/50 hover:text-muted transition-colors cursor-pointer"
          >
            <span className={`transition-transform duration-150 inline-block ${assumptionsOpen ? 'rotate-90' : ''}`}>›</span>
            Assumptions
          </button>
          {assumptionsOpen && (
            <ul className="mt-2 space-y-1 pl-3">
              {assumptions.map((a, i) => (
                <li key={i} className="text-xs text-muted/50 leading-relaxed">· {a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
