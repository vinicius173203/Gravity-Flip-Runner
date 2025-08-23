"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMonadGamesWallet } from "@/hooks/useMonadGamesWallet";
import GameCanvas from "@/components/GameCanvas";

const REG_URL = "https://monad-games-id-site.vercel.app/";

export default function Home() {
  const { login, logout, authenticated, ready } = usePrivy();

  // Normaliza retorno do hook para string
  const mgw = useMonadGamesWallet() as any;
  const wallet: string | null =
    typeof mgw === "string" ? mgw : mgw?.address ?? mgw?.accountAddress ?? null;

  const [username, setUsername] = useState<string | null>(null);

  // estado da rodada
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sentOnchain, setSentOnchain] = useState<number | null>(null);


  // idempotência & reentrância no client
  const runIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const pendingScoreRef = useRef<number | null>(null);

  // exige MONA ID
  useEffect(() => {
    if (!authenticated || !ready || !wallet) return;
    const url = `https://monad-games-id-site.vercel.app/api/check-wallet?wallet=${wallet}`;
    (async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        const data = await r.json();
        const hasUsername = !!(data?.hasUsername && data?.user?.username);
        if (!hasUsername) {
          window.location.href = REG_URL;
          return;
        }
        setUsername(data.user.username as string);
      } catch (e) {
        console.warn("Falha ao checar username:", e);
      }
    })();
  }, [authenticated, ready, wallet]);

  const short = (addr?: string | null) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const canPlay = Boolean(authenticated && wallet && username);

  const handleRestart = () => {
    if (!confirmed || submitting) return; // só depois da confirmação
    setLastScore(null);
    setSubmitError(null);
    setConfirmed(false);
    setTxHash(null);
    setSentOnchain(null);          
    runIdRef.current = null;
    pendingScoreRef.current = null;
    setGameKey((k) => k + 1);
  };

  const handleSubmit = async () => {
    setSubmitError(null);

    if (submitLockRef.current) return; // anti-duplo clique síncrono
    submitLockRef.current = true;

    try {
      if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        setSubmitError("Wallet inválida.");
        return;
      }
      if (!Number.isFinite(lastScore) || (lastScore ?? 0) <= 0) {
        setSubmitError("Score precisa ser > 0 (delta).");
        return;
      }
      // mesma pontuação já enviada/pendente?
      if (pendingScoreRef.current !== lastScore) {
        setSubmitError("Pontuação mudou. Jogue novamente.");
        return;
      }
      if (!runIdRef.current) {
        setSubmitError("Rodada inválida. Jogue novamente.");
        return;
      }
      if (confirmed) return; // já confirmado; nada a fazer

      setSubmitting(true);
      setTxHash(null);

      const resp = await fetch("/api/finish-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": runIdRef.current, // dica pro server
        },
        body: JSON.stringify({
          runId: runIdRef.current,
          sessionId: "demo",
          scoreDelta: lastScore,
          txDelta: 0,
          wallet,
        }),
      });

      const r = await resp.json().catch(() => ({}));
      if (!resp.ok || !r?.ok) {
        setSubmitError(r?.error ?? "Falha ao enviar score.");
        return;
      }

      setConfirmed(true);       // API só responde após confirmar
      setTxHash(r.txHash as string);
      setSentOnchain(
  r?.sent?.scoreDelta != null ? Number(r.sent.scoreDelta) : null
);
    } catch (e: any) {
      setSubmitError(e?.message ?? "Erro ao enviar score.");
    } finally {
      setSubmitting(false);
      // libera novo clique apenas se ainda não confirmou (deixa travado após confirmar)
      if (!confirmed) submitLockRef.current = false;
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Gravity Runner</h1>

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
            {username ? ` · MONAD ID: ${username}` : ""}
          </span>
          <button onClick={() => logout()} className="px-3 py-2 bg-zinc-800 rounded">
            Sair
          </button>
        </div>
      )}

      {canPlay && (
        <>
          <GameCanvas
            key={gameKey}
            onGameOver={(score) => {
              setLastScore(score);
              setSubmitError(null);
              setConfirmed(false);
              setTxHash(null);
              setSentOnchain(null);
              // gera um runId único para esta rodada e marca pontuação pendente
              const rid = (globalThis.crypto?.randomUUID?.() ??
                Math.random().toString(36).slice(2) + Date.now().toString(36));
              runIdRef.current = rid;
              pendingScoreRef.current = score;
              // libera o lock de envio (caso rodada anterior tenha travado)
              submitLockRef.current = false;
            }}
          />

          {lastScore !== null && (
            <div className="w-full max-w-xl mt-2 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between">
                <div className="text-lg">
                  🏁 Fim de jogo! Pontuação:{" "}
                  <span className="font-bold">{lastScore}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRestart}
                    className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700"
                    disabled={!confirmed || submitting}
                    title={!confirmed ? "Aguarde a confirmação onchain" : "Começar nova rodada"}
                  >
                    Jogar novamente
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || confirmed || lastScore <= 0}
                    className="px-3 py-2 rounded bg-amber-600 disabled:opacity-40 hover:opacity-90"
                    title={
                      confirmed
                        ? "Score já confirmado onchain"
                        : "Enviar e aguardar confirmação onchain"
                    }
                    style={{ pointerEvents: submitting || confirmed ? "none" : "auto" }} // anti duplo clique
                  >
                    {submitting
                      ? "Confirmando…"
                      : confirmed
                      ? "Confirmado ✓"
                      : `Enviar score (${lastScore})`}
                  </button>
                </div>
              </div>

            {txHash && (
                <p className="mt-2 text-sm">
                  ✅ Confirmado. Tx: <span className="opacity-80">{txHash}</span>
                </p>
              )}


              {submitError && (
                <p className="mt-2 text-sm text-red-400">{submitError}</p>
              )}
            </div>
          )}

          <a
            className="mt-2 underline opacity-80"
            href="https://monad-games-id-site.vercel.app/leaderboard?page=1&gameId=72"
            target="_blank"
          >
            Ver Leaderboard
          </a>
        </>
      )}
    </main>
  );
}
