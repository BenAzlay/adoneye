'use client';

import '@rainbow-me/rainbowkit/styles.css';
import {
  RainbowKitProvider,
  connectorsForWallets,
  darkTheme,
} from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  walletConnectWallet,
  coinbaseWallet,
  phantomWallet,
  trustWallet,
  ledgerWallet,
  braveWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, WagmiProvider } from 'wagmi';
import { mainnet, polygon, arbitrum, optimism, base } from 'wagmi/chains';
import { http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Wallets',
      wallets: [
        metaMaskWallet,
        walletConnectWallet,
        coinbaseWallet,
        phantomWallet,
        trustWallet,
        ledgerWallet,
        braveWallet,
        injectedWallet,
      ],
    },
  ],
  { appName: 'Adoneye', projectId }
);

const wagmiConfig = createConfig({
  connectors,
  chains: [mainnet, polygon, arbitrum, optimism, base],
  transports: {
    [mainnet.id]:   http('https://cloudflare-eth.com'),
    [polygon.id]:   http('https://polygon-rpc.com'),
    [arbitrum.id]:  http('https://arb1.arbitrum.io/rpc'),
    [optimism.id]:  http('https://mainnet.optimism.io'),
    [base.id]:      http('https://mainnet.base.org'),
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
