'use client';

import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { usePortfolio } from '@/hooks/usePortfolio';
import type { TokenHolding } from '@/types/portfolio';

const CHAIN_BADGE: Record<string, string> = {
  Ethereum: 'bg-zinc-700/60 text-zinc-300',
  Polygon:  'bg-purple-900/50 text-purple-300',
  Arbitrum: 'bg-sky-900/50 text-sky-300',
  Optimism: 'bg-red-900/50 text-red-300',
  Base:     'bg-indigo-900/50 text-indigo-300',
};

function fmtUsd(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function HoldingRow({ holding }: { holding: TokenHolding }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-border last:border-0 hover:bg-surface-elevated transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-md ${CHAIN_BADGE[holding.chain] ?? 'bg-surface-elevated text-muted'}`}>
          {holding.chain}
        </span>
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{holding.symbol}</span>
          <span className="text-xs text-muted ml-2 hidden sm:inline">{holding.name}</span>
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

export default function Home() {
  const { isConnected, address, connector: activeConnector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const disconnect = useDisconnect();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, error } = usePortfolio();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleButtonClick() {
    if (isConnected) {
      setMenuOpen((prev) => !prev);
    } else {
      openConnectModal?.();
    }
  }

  function handleDisconnect() {
    disconnect.disconnect()
    setMenuOpen(false);
  }

  const uniqueChains = data ? new Set(data.holdings.map(h => h.chain)).size : 0;
  const pricedCount  = data ? data.holdings.filter(h => h.usdValue !== null).length : 0;

  return (
    <div className="min-h-screen bg-hero-glow flex flex-col items-center">
      {/* Spacer: shrinks from viewport center to top padding when connected.
          calc(50vh - 56px) keeps the message+button group visually centered. */}
      <div
        style={{
          height: isConnected ? '64px' : 'calc(50vh - 72px)',
          transition: 'height 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
        }}
      />

      {/* Tagline — only in disconnected state */}
      {!isConnected && (
        <p className="message-pulse text-xs text-muted tracking-[0.2em] uppercase text-center select-none pointer-events-none mb-8">
          Reveal the Unseen
        </p>
      )}

      <div ref={menuRef} className="relative shrink-0">
        {/* Orbital decorations — only in disconnected state */}
        {!isConnected && (
          <>
            <div className="arc-orbit" />
            <div className="arc-orbit-2" />
            <div className="pulse-ring" />
            <div className="pulse-ring pulse-ring-delay" />
          </>
        )}

        <button
          onClick={handleButtonClick}
          className={`btn-primary w-24 h-24 rounded-full cursor-pointer overflow-hidden relative z-10 ${isConnected ? 'glow-oracle' : 'glow-breathe'}`}
          aria-label={isConnected ? 'Wallet options' : 'Connect wallet'}
        >
          <Image src="/logo.png" alt="" width={96} height={96} unoptimized loading='eager' />
        </button>

        {menuOpen && isConnected && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 min-w-48 bg-surface border border-border-accent rounded-xl shadow-2xl overflow-hidden z-50">
            <div className="px-4 py-3 text-xs text-muted border-b border-border font-mono tracking-wide">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </div>
            <button
              onClick={handleDisconnect}
              className="w-full text-left px-4 py-3 text-sm text-loss hover:bg-surface-elevated transition-colors cursor-pointer"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {isConnected && (
        <div className="analytics-enter w-full max-w-6xl px-6 mt-12 pb-16 flex flex-col gap-5">

          {/* Total portfolio value */}
          <div className={`h-32 rounded-2xl bg-surface border border-border-accent flex items-center px-8 ${isLoading ? 'animate-pulse' : ''}`}>
            {data && (
              <div>
                <div className="text-3xl font-semibold text-foreground tabular-nums">
                  {fmtUsd(data.totalUsdValue)}
                </div>
                <div className="text-sm text-muted mt-1.5">
                  {data.holdingCount} assets · {uniqueChains} {uniqueChains === 1 ? 'chain' : 'chains'}
                </div>
              </div>
            )}
            {isError && (
              <p className="text-sm text-loss">{error?.message ?? 'Failed to load portfolio'}</p>
            )}
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              { label: 'Assets',        value: data?.holdingCount.toString() ?? '—', sub: 'total holdings'        },
              { label: 'Active chains', value: data ? uniqueChains.toString() : '—', sub: 'of 5 tracked'          },
              { label: 'Priced',        value: data ? pricedCount.toString()  : '—', sub: `of ${data?.holdingCount ?? '—'} with USD value` },
            ] as const).map(({ label, value, sub }) => (
              <div
                key={label}
                className={`h-28 rounded-2xl bg-surface border border-border-accent flex flex-col justify-center px-6 ${isLoading ? 'animate-pulse' : ''}`}
              >
                {(data || isError) && (
                  <>
                    <div className="text-xs text-muted mb-1">{label}</div>
                    <div className="text-2xl font-semibold text-foreground tabular-nums">{value}</div>
                    <div className="text-xs text-muted mt-0.5">{sub}</div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Holdings list */}
          <div className={`rounded-2xl bg-surface border border-border-accent overflow-hidden ${isLoading ? 'animate-pulse' : ''}`}>
            {isLoading && <div className="h-64" />}
            {isError && (
              <div className="flex items-center justify-center h-32 text-sm text-loss">
                {error?.message ?? 'Failed to load holdings'}
              </div>
            )}
            {data && data.holdings.length === 0 && (
              <div className="flex items-center justify-center h-32 text-sm text-muted">
                No token holdings found
              </div>
            )}
            {data && data.holdings.length > 0 && (
              <div className="max-h-[420px] overflow-y-auto">
                {data.holdings.map((h, i) => (
                  <HoldingRow key={`${h.chainId}-${h.contractAddress ?? 'native'}-${i}`} holding={h} />
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
