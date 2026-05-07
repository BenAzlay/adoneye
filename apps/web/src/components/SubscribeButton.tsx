'use client';

import { useCheckout } from '@/hooks/useCheckout';

export function SubscribeButton() {
  const { startCheckout, isLoading, error } = useCheckout();

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={startCheckout}
        disabled={isLoading}
        className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer
          border border-[rgb(247_147_26/0.25)] text-primary bg-transparent
          hover:bg-[rgb(247_147_26/0.05)] hover:border-[rgb(247_147_26/0.45)]
          hover:shadow-[0_0_16px_rgb(247_147_26/0.1)]
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Redirecting…' : 'Subscribe'}
      </button>
      <p className="text-center text-xs text-muted">Weekly portfolio readings</p>
      {error && (
        <p className="text-center text-xs text-loss mt-0.5">{error}</p>
      )}
    </div>
  );
}
