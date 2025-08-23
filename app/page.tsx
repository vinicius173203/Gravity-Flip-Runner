"use client";
import { useState } from "react";
import GameCanvas from "@/components/GameCanvas";
import { usePrivy } from "@privy-io/react-auth";
import { useMonadGamesWallet } from "@/hooks/useMonadGamesWallet";
import { useUsername } from "@/hooks/useUsername";
import UsernameGate from "@/components/UsernameGate";

export default function Home() {
  const [lastScore, setLastScore] = useState<number | null>(null);
  const { login, loginWithWallet, logout, authenticated } = usePrivy();
  const { address: wallet } = useMonadGamesWallet();
  const { loading, username, refetch } = useUsername(wallet || undefined);

  const canPlay = authenticated && wallet && username; // exige username para jogar/enviar

  const handleSubmit = async () => {
    if (!wallet || lastScore == null) return;
    const r = await fetch("/api/finish-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "demo", scoreDelta: lastScore, txDelta: 0, wallet }),
    }).then((r) => r.json());
    alert(r.ok ? `Enviado! txHash: ${r.txHash}` : `Falhou: ${r.error}`);
  };

  return (
    <main className="min-h-dvh flex flex-col items-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Gravity Flip Runner — M7</h1>

      {/* Login */}
      {!authenticated ? (
        <div className="flex gap-2">
          <button onClick={() => login()} className="px-4 py-2 rounded-2xl bg-emerald-600 hover:opacity-90">
            Sign in with Monad Games ID
          </button>
          {loginWithWallet && (
            <button onClick={() => loginWithWallet()} className="px-4 py-2 rounded-2xl bg-zinc-800 hover:bg-zinc-700">
              Conectar outra wallet
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm opacity-70">
            {wallet ? `Wallet: ${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Conectando…"}
            {username ? ` · @${username}` : ""}
          </span>
          <button onClick={() => logout()} className="px-3 py-2 bg-zinc-800 rounded">
            Sair
          </button>
        </div>
      )}

      {/* Gate de username */}
      {authenticated && wallet && !username ? (
        <UsernameGate onCheckAgain={refetch} />
      ) : (
        <>
          {/* Gameplay liberado */}
          <GameCanvas onGameOver={(s) => setLastScore(s)} />
          <div className="flex gap-3 items-center">
            <button className="px-3 py-2 bg-zinc-800 rounded" onClick={() => location.reload()}>
              Tentar de novo
            </button>
            <button
              disabled={!canPlay || lastScore == null}
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
