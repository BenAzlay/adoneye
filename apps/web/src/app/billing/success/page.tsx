import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Subscription confirmed — Adoneye",
};

export default function BillingSuccessPage() {
  return (
    <div className="min-h-screen bg-hero-glow flex flex-col items-center justify-center px-6">
      <div className="analytics-enter flex flex-col items-center w-full max-w-sm">

        {/* Oracle ring icon */}
        <div className="relative w-20 h-20 mb-8">
          <div className="absolute inset-0 rounded-full border border-[rgb(247_147_26/0.35)] glow-oracle" />
          <div className="absolute inset-[10px] rounded-full border border-[rgb(247_147_26/0.15)]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 11.5L9 16.5L18 6"
                stroke="rgb(247 147 26)"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-foreground tracking-tight text-center">
          Reading confirmed.
        </h1>
        <p className="text-sm text-muted mt-2 text-center">
          Your Adoneye subscription is now active.
        </p>

        {/* Detail card */}
        <div className="w-full mt-8 bg-surface border border-border-accent rounded-2xl overflow-hidden">
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                Weekly Analysis
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-[rgb(247_147_26/0.1)] text-primary border border-[rgb(247_147_26/0.2)]">
                Active
              </span>
            </div>
            <p className="text-xs text-muted mt-3 leading-relaxed">
              Each week, your holdings are benchmarked against BTC and ETH.
              Missed opportunities are ranked by dollar impact, not noise.
              Insight cards explain what happened — clearly, without hype.
            </p>
          </div>

          <div className="border-t border-border px-6 py-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted">Cadence</div>
              <div className="text-sm text-foreground mt-0.5">Weekly</div>
            </div>
            <div>
              <div className="text-xs text-muted">Benchmarks</div>
              <div className="text-sm text-foreground mt-0.5">BTC · ETH</div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <Link
          href="/"
          className="btn-primary w-full mt-5 py-3 rounded-xl text-sm font-semibold text-center"
        >
          Return to portfolio
        </Link>

        <p className="text-xs text-muted mt-4 text-center">
          This is not financial advice.
        </p>
      </div>
    </div>
  );
}
