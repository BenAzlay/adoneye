'use client';

const STEPS = [
  'Fetching portfolio',
  'Mapping exposure',
  'Measuring opportunity',
  'Summoning analysis',
] as const;

export function AnalysisLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-10">
      {/* Dual-ring scanning animation reusing the existing orbital keyframes */}
      <div className="relative w-20 h-20 shrink-0">
        <div className="analysis-ring" />
        <div className="analysis-ring-inner" />
        {/* Static center dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-primary/60" />
        </div>
      </div>

      <p className="message-pulse text-xs text-muted tracking-[0.2em] uppercase select-none">
        Reading the unseen
      </p>

      {/* Steps animate in one by one */}
      <div className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className="analysis-step flex items-center gap-3"
            style={{ animationDelay: `${i * 0.9}s` }}
          >
            <span
              className="analysis-step-dot w-1.5 h-1.5 rounded-full shrink-0"
              style={{ animationDelay: `${i * 0.9}s` }}
            />
            <span className="text-xs text-muted">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
