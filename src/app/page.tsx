'use client';

import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';
import { useAccount, useDisconnect, useConnections, useConfig } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

export default function Home() {
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const config = useConfig();
  const connections = useConnections();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    const connection = connections[0];
    if (!connection) return;

    // Match the serialized state connector to the live instance (which has methods).
    // The UID may be stale (e.g. config reloaded) — guard explicitly so we never
    // pass `undefined` and silently fall back to wagmi's broken internal lookup.
    const liveConnector = config.connectors.find((c) => c.uid === connection.connector.uid);
    if (!liveConnector) {
      console.error('Disconnect error: no live connector found for uid', connection.connector.uid);
      return;
    }

    disconnect({ connector: liveConnector }, {
      onError: (error) => console.error('Disconnect error:', error),
    });
    setMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center">
      {/* Spacer: shrinks from viewport center to top padding when connected */}
      <div
        style={{
          height: isConnected ? '64px' : 'calc(50vh - 32px)',
          transition: 'height 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
        }}
      />

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={handleButtonClick}
          className="w-16 h-16 rounded-full bg-orange-500 hover:bg-orange-400 active:bg-orange-600 transition-colors cursor-pointer overflow-hidden"
          aria-label={isConnected ? 'Wallet options' : 'Connect wallet'}
        >
          <Image src="/logo.png" alt="" width={64} height={64} unoptimized loading='eager' />
        </button>

        {menuOpen && isConnected && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 min-w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
            <div className="px-4 py-3 text-xs text-zinc-500 border-b border-zinc-800 font-mono tracking-wide">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </div>
            <button
              onClick={handleDisconnect}
              className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {isConnected && (
        <div className="analytics-enter w-full max-w-6xl px-6 mt-12 pb-16 flex flex-col gap-5">
          <div className="h-32 rounded-2xl bg-zinc-900 border border-zinc-800/60" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="h-28 rounded-2xl bg-zinc-900 border border-zinc-800/60" />
            <div className="h-28 rounded-2xl bg-zinc-900 border border-zinc-800/60" />
            <div className="h-28 rounded-2xl bg-zinc-900 border border-zinc-800/60" />
          </div>
          <div className="h-64 rounded-2xl bg-zinc-900 border border-zinc-800/60" />
        </div>
      )}
    </div>
  );
}
