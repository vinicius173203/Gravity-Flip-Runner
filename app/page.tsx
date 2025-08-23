"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMonadGamesWallet } from "@/hooks/useMonadGamesWallet";
import GameCanvas from "@/components/GameCanvas";

const REG_URL = "https://monad-games-id-site.vercel.app/"; // página oficial p/ registrar username

export default function Home() {
  const { login, logout, authenticated, ready } = usePrivy();
  const wallet = useMonadGamesWallet(); // string | null
  const [username, setUsername] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);

  // Checar username e redirecionar se não existir
  useEffect(() => {
    if (!authenticated || !ready || !wallet) return;
    const url = `https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${wallet}`;
    (async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        const data = await r.json();
        const hasUsername = !!(data?.hasUsername && data?.user?.username);
        if (!hasUsername) {
          // redireciona para o site do Monad Games ID para registrar o username
          window.location.href = REG_URL;
          return;
        }
        setUsername(data.user.username);
      } catch (e) {
        console.warn("Falha ao checar username:", e);
      }
    })();
  }, [authenticated, ready, wallet]);

  const short = (addr?: string | null) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const canPlay = Boolean(authenticated && wallet && username);

  const handleSubmit = async () => {
    if (!wallet || lastScore == null) return;
    const r = await fetch("/api/finish-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "demo",
        scoreDelta: lastScore, // ENVIE SEMPRE DELTA (incremento)
        txDelta: 0,
        wallet,
      }),
    }).then((r) => r.json());
    alert(r.ok ? `Enviado! txHash: ${r.txHash}` : `Falhou: ${r.error}`);
  };

  return (
    <main className="min-h-dvh flex flex-col items-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Gravity Flip Runner — M7</h1>

      {!authenticated ? (
        <button
          onClick={() => login()}
          disabled={!ready}
          className="px-4 py-2 rounded-2xl bg-emerald-600 disabled:opacity-40 hover:opacity-90"
        >
          {ready ? "Sign in with Monad Games ID" : "Carregando…"}
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm opacity-70">
            {wallet ? `Wallet: ${short(wallet)}` : "Conectando…"}
            {username ? ` · MONA ID: @${username}` : ""}
          </span>
          <button onClick={() => logout()} className="px-3 py-2 bg-zinc-800 rounded">
            Sair
          </button>
        </div>
      )}

      {/* Só libera o jogo quando tiver wallet + MONA ID */}
      {canPlay && (
        <>
          <GameCanvas onGameOver={(s) => setLastScore(s)} />
          <div className="flex gap-3 items-center">
            <button
              className="px-3 py-2 bg-zinc-800 rounded"
              onClick={() => location.reload()}
            >
              Tentar de novo
            </button>
            <button
              disabled={lastScore == null}
              className="px-3 py-2 rounded bg-amber-600 disabled:opacity-40"
              onClick={handleSubmit}
            >
              Enviar score onchain
            </button>
            <a
              className="underline opacity-80"
              href="https://monad-games-id-site.vercel.app/leaderboard"
              target="_blank"
            >
              Ver Leaderboard
            </a>
          </div>
        </>
      )}
    </main>
  );
}
