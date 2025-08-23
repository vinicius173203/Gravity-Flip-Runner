"use client";
import { useEffect, useState } from "react";
import { usePrivy, CrossAppAccountWithMetadata } from "@privy-io/react-auth";

const CROSS_APP_ID = "cmd8euall0037le0my79qpz42"; // Monad Games ID (Cross App ID)

export function useMonadGamesWallet() {
  const { authenticated, ready, user } = usePrivy();
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "missing">("idle");

  useEffect(() => {
    // reset em mudanças de sessão
    setAddress(null);
    if (!ready) { setStatus("loading"); return; }
    if (!authenticated || !user) { setStatus("idle"); return; }

    const accounts = user.linkedAccounts ?? [];
    const cross = accounts.find(
      (acc): acc is CrossAppAccountWithMetadata =>
        acc.type === "cross_app" && (acc as any).providerApp?.id === CROSS_APP_ID
    );

    if (!cross) { setStatus("missing"); return; }

    const embedded = cross.embeddedWallets ?? [];
    if (embedded.length > 0 && embedded[0]?.address) {
      setAddress(embedded[0].address);
      setStatus("ok");
    } else {
      setStatus("missing");
    }
  }, [authenticated, ready, user]);

  return { address, status }; // status: idle/loading/ok/missing
}
