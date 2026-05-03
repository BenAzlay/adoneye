'use client';

import { useEffect } from 'react';

function fmtUsd(v: number | null): string {
  if (v === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(new Date(iso));
}

function fmtCountdown(s: number): string {
  if (s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  chainName: string | undefined;
  totalValueUsd: number | null;
  lastAnalysisAt: string | null;
  cooldownRemaining: number;
  isAnalysisLoading: boolean;
  onRerunAnalysis: () => void;
  onDisconnect: () => void;
}

export function WalletModal({
  isOpen,
  onClose,
  address,
  chainName,
  totalValueUsd,
  lastAnalysisAt,
  cooldownRemaining,
  isAnalysisLoading,
  onRerunAnalysis,
  onDisconnect,
}: WalletModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const redacted = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const canRerun = cooldownRemaining <= 0 && !isAnalysisLoading;
  const countdown = fmtCountdown(cooldownRemaining);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/55 z-40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Wallet options"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 bg-surface border border-border-accent rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Wallet identity */}
        <div className="px-5 py-4 border-b border-border">
          <div className="text-xs text-muted mb-1">Connected wallet</div>
          <div className="font-mono text-sm text-foreground tracking-wide">{redacted}</div>
          {chainName && (
            <div className="text-xs text-muted mt-1">{chainName}</div>
          )}
        </div>

        {/* Portfolio snapshot */}
        <div className="px-5 py-4 border-b border-border grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted">Portfolio value</div>
            <div className="text-sm font-semibold text-foreground tabular-nums mt-0.5">
              {fmtUsd(totalValueUsd)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Last analysis</div>
            <div className="text-sm text-foreground mt-0.5">{fmtTime(lastAnalysisAt)}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 flex flex-col gap-2.5">
          <button
            onClick={() => { onRerunAnalysis(); onClose(); }}
            disabled={!canRerun}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer
              bg-primary text-background
              disabled:opacity-40 disabled:cursor-not-allowed
              enabled:hover:opacity-90 enabled:active:opacity-80"
          >
            {isAnalysisLoading
              ? 'Analysis running…'
              : countdown
                ? `Cooldown (${countdown})`
                : 'Run new analysis'}
          </button>

          <button
            onClick={onDisconnect}
            className="w-full py-2.5 rounded-xl text-sm text-loss border border-loss/20 hover:bg-loss/8 transition-colors cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </div>
    </>
  );
}
