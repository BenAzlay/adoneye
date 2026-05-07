"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useAccount, useChainId, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useAnalysis, AnalysisCooldownError } from "@/hooks/useAnalysis";
import { PORTFOLIO_ANALYSIS_COOLDOWN_SECONDS } from "@/constants/analysis";
import { AnalysisLoading } from "@/components/AnalysisLoading";
import { AnalysisCards } from "@/components/AnalysisCards";
import { WalletModal } from "@/components/WalletModal";
import type { TokenHolding } from "@/types/portfolio";

// ── Helpers ────────────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  137: "Polygon",
  42161: "Arbitrum",
  10: "Optimism",
  8453: "Base",
};

const CHAIN_BADGE: Record<string, string> = {
  Ethereum: "bg-zinc-700/60 text-zinc-300",
  Polygon: "bg-purple-900/50 text-purple-300",
  Arbitrum: "bg-sky-900/50 text-sky-300",
  Optimism: "bg-red-900/50 text-red-300",
  Base: "bg-indigo-900/50 text-indigo-300",
};

function fmtUsd(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function fmtAnalysisDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function HoldingRow({ holding }: { holding: TokenHolding }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-border last:border-0 hover:bg-surface-elevated transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-md ${CHAIN_BADGE[holding.chain] ?? "bg-surface-elevated text-muted"}`}
        >
          {holding.chain}
        </span>
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">
            {holding.symbol}
          </span>
          <span className="text-xs text-muted ml-2 hidden sm:inline">
            {holding.name}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0 ml-4">
        <div className="text-sm text-foreground tabular-nums">
          {holding.balance} <span className="text-muted">{holding.symbol}</span>
        </div>
        <div className="text-xs text-muted">{fmtUsd(holding.usdValue)}</div>
      </div>
    </div>
  );
}

type Tab = "analysis" | "portfolio";

// ── Page ───────────────────────────────────────────────────────────────────

export default function Home() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [modalOpen, setModalOpen] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("analysis");

  const {
    data: portfolio,
    isLoading: portfolioLoading,
    isError: portfolioError,
    error: portfolioErr,
  } = usePortfolio();
  const {
    data: analyseData,
    isFetching: analysisLoading,
    error: analysisError,
    rerunAnalysis,
  } = useAnalysis();

  // Derive remaining cooldown from the stored analysis timestamp so the button
  // is correctly disabled after a page refresh, not just after a 429 response.
  // Server-provided remaining seconds from a 429 take priority when present.
  useEffect(() => {
    if (analysisError instanceof AnalysisCooldownError) {
      setCooldownRemaining(analysisError.remainingSeconds);
    } else if (analyseData?.createdAt) {
      const elapsedSeconds =
        (Date.now() - new Date(analyseData.createdAt).getTime()) / 1000;
      setCooldownRemaining(
        Math.max(
          0,
          Math.ceil(PORTFOLIO_ANALYSIS_COOLDOWN_SECONDS - elapsedSeconds),
        ),
      );
    }
  }, [analysisError, analyseData?.createdAt]);

  // Live countdown ticker
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const id = setInterval(
      () => setCooldownRemaining((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [cooldownRemaining]);

  // Reset to analysis tab when a new wallet connects
  useEffect(() => {
    if (isConnected) setActiveTab("analysis");
  }, [address, isConnected]);

  function handleLogoClick() {
    if (isConnected) setModalOpen(true);
    else openConnectModal?.();
  }

  function handleDisconnect() {
    disconnect();
    setModalOpen(false);
    setCooldownRemaining(0);
  }

  // Derived analysis state
  const showAnalysisLoading = isConnected && analysisLoading;
  const showAnalysisCards = isConnected && !!analyseData && !analysisLoading;
  const isCooldownError = analysisError instanceof AnalysisCooldownError;
  const isGenericError = !!analysisError && !isCooldownError;

  const uniqueChains = portfolio
    ? new Set(portfolio.holdings.map((h) => h.chain)).size
    : 0;
  const pricedCount = portfolio
    ? portfolio.holdings.filter((h) => h.usdValue !== null).length
    : 0;

  return (
    <div className="min-h-screen bg-hero-glow flex flex-col items-center">
      {/* Spacer: visually centers the logo when disconnected */}
      <div
        style={{
          height: isConnected ? "64px" : "calc(50vh - 72px)",
          transition: "height 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
          flexShrink: 0,
        }}
      />

      {!isConnected && (
        <p className="message-pulse text-xs text-muted tracking-[0.2em] uppercase text-center select-none pointer-events-none mb-8">
          Reveal the Unseen
        </p>
      )}

      {/* Logo / wallet button */}
      <div className="relative shrink-0">
        {!isConnected && (
          <>
            <div className="arc-orbit" />
            <div className="arc-orbit-2" />
            <div className="pulse-ring" />
            <div className="pulse-ring pulse-ring-delay" />
          </>
        )}

        <button
          onClick={handleLogoClick}
          className={`btn-primary w-24 h-24 rounded-full cursor-pointer overflow-hidden relative z-10 ${isConnected ? "glow-oracle" : "glow-breathe"}`}
          aria-label={isConnected ? "Wallet options" : "Connect wallet"}
        >
          <Image
            src="/logo.png"
            alt=""
            width={96}
            height={96}
            unoptimized
            loading="eager"
          />
        </button>
      </div>

      {/* Connected content */}
      {isConnected && (
        <div className="analytics-enter w-full max-w-6xl px-6 mt-12 pb-16 flex flex-col gap-6">
          {/* Portfolio value — shared context above both tabs */}
          <div
            className={`h-32 rounded-2xl bg-surface border border-border-accent flex items-center px-8 ${portfolioLoading ? "animate-pulse" : ""}`}
          >
            {portfolio && (
              <div>
                <div className="text-3xl font-semibold text-foreground tabular-nums">
                  {fmtUsd(portfolio.totalUsdValue)}
                </div>
                <div className="text-sm text-muted mt-1.5">
                  {portfolio.holdingCount} assets · {uniqueChains}{" "}
                  {uniqueChains === 1 ? "chain" : "chains"}
                </div>
              </div>
            )}
            {portfolioError && (
              <p className="text-sm text-loss">
                {portfolioErr?.message ?? "Failed to load portfolio"}
              </p>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-border gap-7">
            <TabButton
              label="AI Analysis"
              active={activeTab === "analysis"}
              onClick={() => setActiveTab("analysis")}
            />
            <TabButton
              label="Portfolio"
              active={activeTab === "portfolio"}
              onClick={() => setActiveTab("portfolio")}
            />
          </div>

          {/* ── Analysis tab ─────────────────────────────────────────────── */}
          {activeTab === "analysis" && (
            <div className="flex flex-col gap-5">
              {showAnalysisLoading && <AnalysisLoading />}

              {showAnalysisCards && (
                <>
                  {/* Creation timestamp — persists until a new analysis is run */}
                  <div className="flex items-center text-xs text-muted/50 font-mono">
                    {fmtAnalysisDate(analyseData.createdAt)}
                  </div>
                  <AnalysisCards
                    dataset={analyseData.dataset}
                    analysis={analyseData.analysis}
                  />
                </>
              )}

              {!showAnalysisCards && isCooldownError && (
                <div className="rounded-2xl bg-surface border border-border-accent flex items-center justify-between px-6 py-5">
                  <div>
                    <p className="text-sm text-foreground">
                      Analysis cooldown active
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {cooldownRemaining > 0
                        ? `Available in ${Math.floor(cooldownRemaining / 60)}m ${cooldownRemaining % 60}s`
                        : "Ready — open wallet menu to run a new analysis"}
                    </p>
                  </div>
                </div>
              )}

              {!showAnalysisCards && isGenericError && (
                <div className="rounded-2xl bg-surface border border-border-accent flex items-center justify-between px-6 py-5">
                  <p className="text-sm text-loss">
                    {analysisError?.message ?? "Analysis failed"}
                  </p>
                  <button
                    onClick={() => rerunAnalysis()}
                    className="text-xs text-primary hover:text-primary-soft transition-colors cursor-pointer ml-4 shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Portfolio tab ─────────────────────────────────────────────── */}
          {activeTab === "portfolio" && (
            <div className="flex flex-col gap-5">
              {/* Stat cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(
                  [
                    {
                      label: "Assets",
                      value: portfolio?.holdingCount.toString() ?? "—",
                      sub: "total holdings",
                    },
                    {
                      label: "Active chains",
                      value: portfolio ? uniqueChains.toString() : "—",
                      sub: "of 5 tracked",
                    },
                    {
                      label: "Priced",
                      value: portfolio ? pricedCount.toString() : "—",
                      sub: `of ${portfolio?.holdingCount ?? "—"} with USD value`,
                    },
                  ] as const
                ).map(({ label, value, sub }) => (
                  <div
                    key={label}
                    className={`h-28 rounded-2xl bg-surface border border-border-accent flex flex-col justify-center px-6 ${portfolioLoading ? "animate-pulse" : ""}`}
                  >
                    {(portfolio || portfolioError) && (
                      <>
                        <div className="text-xs text-muted mb-1">{label}</div>
                        <div className="text-2xl font-semibold text-foreground tabular-nums">
                          {value}
                        </div>
                        <div className="text-xs text-muted mt-0.5">{sub}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Holdings list */}
              <div
                className={`rounded-2xl bg-surface border border-border-accent overflow-hidden ${portfolioLoading ? "animate-pulse" : ""}`}
              >
                {portfolioLoading && <div className="h-64" />}
                {portfolioError && (
                  <div className="flex items-center justify-center h-32 text-sm text-loss">
                    {portfolioErr?.message ?? "Failed to load holdings"}
                  </div>
                )}
                {portfolio && portfolio.holdings.length === 0 && (
                  <div className="flex items-center justify-center h-32 text-sm text-muted">
                    No token holdings found
                  </div>
                )}
                {portfolio && portfolio.holdings.length > 0 && (
                  <div className="max-h-[420px] overflow-y-auto">
                    {portfolio.holdings.map((h, i) => (
                      <HoldingRow
                        key={`${h.chainId}-${h.contractAddress ?? "native"}-${i}`}
                        holding={h}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Wallet modal */}
      <WalletModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        address={address ?? ""}
        chainName={CHAIN_NAMES[chainId]}
        totalValueUsd={portfolio?.totalUsdValue ?? null}
        lastAnalysisAt={analyseData?.createdAt ?? null}
        cooldownRemaining={cooldownRemaining}
        isAnalysisLoading={analysisLoading}
        onRerunAnalysis={() => rerunAnalysis()}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
}

// ── Tab button ─────────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-3 text-sm font-medium tracking-wide border-b-2 -mb-px transition-colors cursor-pointer ${
        active
          ? "text-foreground border-primary"
          : "text-muted border-transparent hover:text-foreground/70"
      }`}
    >
      {label}
    </button>
  );
}
