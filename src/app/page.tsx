'use client';

import Image from 'next/image';
import { useAccount } from 'wagmi';
import { useConnectModal, useAccountModal } from '@rainbow-me/rainbowkit';

export default function Home() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();

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

      <button
        onClick={isConnected ? openAccountModal : openConnectModal}
        className="w-16 h-16 rounded-full bg-orange-500 hover:bg-orange-400 active:bg-orange-600 transition-colors shrink-0 cursor-pointer overflow-hidden"
        aria-label="Connect wallet"
      >
        <Image src="/logo.png" alt="" width={64} height={64} unoptimized />
      </button>

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
