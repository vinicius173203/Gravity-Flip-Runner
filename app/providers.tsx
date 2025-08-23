"use client";
import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  console.log("[Privy appId]", appId, "len:", appId?.length);

  return (
    <PrivyProvider
      appId={appId ?? ""}
      config={{
        // Removemos loginMethodsAndOrder (causava concat em undefined)
        // Deixe o default do Privy por enquanto.
        embeddedWallets: { createOnLogin: "all-users" },
        appearance: { theme: "dark" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
