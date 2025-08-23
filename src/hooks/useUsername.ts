"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

type ApiResp =
  | { hasUsername: true; user: { id: number; username: string; walletAddress: string } }
  | { hasUsername: false };

export function useUsername(wallet: string | null | undefined) {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const hasWallet = useMemo(() => !!wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet), [wallet]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    setUsername(null);
    setError(null);
    if (!hasWallet) return;

    const ctrl = new AbortController();
    const url = `https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${wallet}`;
    setLoading(true);

    fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: ApiResp = await r.json();
        if (data && "hasUsername" in data && data.hasUsername && data.user?.username) {
          setUsername(data.user.username);
        } else {
          setUsername(null);
        }
      })
      .catch((e: any) => {
        if (e.name !== "AbortError") setError(e.message || "Erro ao buscar username");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [hasWallet, wallet, tick]);

  return { loading, username, error, refetch };
}
