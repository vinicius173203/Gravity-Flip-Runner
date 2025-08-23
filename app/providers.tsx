"use client";
import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  return (
    <PrivyProvider
      appId={appId ?? ""}
      config={{
        // Mostra exclusivamente o provedor do Monad Games ID no modal
        // (formato: "privy:<provider-app-id>")
        loginMethodsAndOrder: {
          primary: ["privy:cmd8euall0037le0my79qpz42"],
        },
        // Garante criação da embedded wallet (Global Wallet) no login
        embeddedWallets: { createOnLogin: "all-users" },
        appearance: { theme: "dark" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
