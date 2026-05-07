'use client';

import { useState } from 'react';

export function useCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    const apiUrl = process.env.NEXT_PUBLIC_ADONEYE_API_URL;
    if (!apiUrl) {
      setError('Checkout not configured');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // TODO: Replace with real authenticated user data when auth is implemented
      const userId = 'test-user-1';
      const email = 'test@example.com';

      const res = await fetch(`${apiUrl}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email }),
      });

      const data: unknown = await res.json().catch(() => ({}));
      const payload = data as Record<string, string>;

      if (!res.ok) {
        throw new Error(payload.error ?? 'Checkout unavailable');
      }
      if (!payload.url) {
        throw new Error('Invalid checkout response');
      }

      // Redirect to Stripe Checkout — intentionally keep isLoading true during redirect
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsLoading(false);
    }
  }

  return { startCheckout, isLoading, error };
}
