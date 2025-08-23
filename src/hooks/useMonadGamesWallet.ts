"use client";
import { useEffect, useState } from "react";
import { usePrivy, CrossAppAccountWithMetadata } from "@privy-io/react-auth";

const CROSS_APP_ID = "cmd8euall0037le0my79qpz42"; // Monad Games ID

export function useMonadGamesWallet() {
  const { authenticated, user, ready } = usePrivy();
  const [accountAddress, setAccountAddress] = useState<string | null>(null);

  useEffect(() => {
    setAccountAddress(null);
    if (!(authenticated && user && ready)) return;

    // === EXATAMENTE COMO NO GUIA (filter(...)[0]) ===
    const linked = user.linkedAccounts ?? [];
    if (linked.length > 0) {
      const crossAppAccount: CrossAppAccountWithMetadata =
        linked.filter(
          (account) =>
            account.type === "cross_app" &&
            (account as any).providerApp?.id === CROSS_APP_ID
        )[0] as CrossAppAccountWithMetadata;

      // The first embedded wallet created using Monad Games ID, is the wallet address
      if (crossAppAccount?.embeddedWallets?.length > 0) {
        setAccountAddress(crossAppAccount.embeddedWallets[0].address);
      }
    }
  }, [authenticated, user, ready]);

  return accountAddress; // string ou null
}
