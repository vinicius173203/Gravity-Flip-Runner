"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMonadGamesWallet } from "@/hooks/useMonadGamesWallet";
import GameCanvas from "@/components/GameCanvas";
import GlobalLeaderboard from "@/components/GlobalLeaderboard";

const REG_URL = "https://monad-games-id-site.vercel.app/";

type Entry = { name: string; score: number; wallet: string; at: number };
type TxEntry = { txHash: string; score: number; at: number };

function shorten(addr?: string | null) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export default function Home() {
  const { login, logout, authenticated, ready } = usePrivy();

  // normaliza o retorno do hook
  const mgw = useMonadGamesWallet() as any;
  const wallet: string | null =
    typeof mgw === "string" ? mgw : mgw?.address ?? mgw?.accountAddress ?? null;

  const [username, setUsername] = useState<string | null>(null);

  // rodada/score
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [gameKey, setGameKey] = useState(0);

  // envio/confirm
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sentOnchain, setSentOnchain] = useState<number | null>(null);

  // leaderboard + high score local
  const [board, setBoard] = useState<Entry[]>([]);
  const [highScore, setHighScore] = useState<number>(0);

  // recent txs
  const [recentTxs, setRecentTxs] = useState<TxEntry[]>([]);

  // idempotência
  const runIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const pendingScoreRef = useRef<number | null>(null);

  // valores ao vivo
  const [currentScore, setCurrentScore] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);

  // exige MONAD GAMES ID
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

  // util: deduplica por nome, mantém o melhor score por nome e ordena desc
  function dedupeAndSortTopByName(entries: Entry[], limit: number) {
    const bestByName = new Map<string, Entry>();
    for (const e of entries) {
      const cur = bestByName.get(e.name);
      if (!cur || e.score > cur.score) bestByName.set(e.name, e);
    }
    return Array.from(bestByName.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // carrega highScore/recentTxs
  useEffect(() => {
    const hs = localStorage.getItem("highScore");
    if (hs) setHighScore(parseInt(hs, 10) || 0);
    const savedTxs = localStorage.getItem("recentTxs");
    if (savedTxs) {
      try {
        const parsed = JSON.parse(savedTxs) as TxEntry[];
        setRecentTxs(parsed);
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("recentTxs", JSON.stringify(recentTxs));
  }, [recentTxs]);

  const canPlay = Boolean(authenticated && wallet && username);

  function addToBoard(score: number) {
    const entry: Entry = {
      name: username || "Player",
      score,
      wallet: wallet ?? "",
      at: Date.now(),
    };
    setBoard((prev) => {
      const next = [...prev, entry];
      return dedupeAndSortTopByName(next, 10);
    });
  }

  const handleRestart = () => {
    setLastScore(null);
    setSubmitError(null);
    setConfirmed(false);
    setTxHash(null);
    setSentOnchain(null);
    runIdRef.current = null;
    pendingScoreRef.current = null;
    setGameKey((k) => k + 1);
  };

  // ====== ENVIA SCORE (scoreDelta > 0) ======
  // ====== ENVIA SCORE (scoreDelta > 0) E +1 TRANSAÇÃO ======
const handleSubmit = async (score: number) => {
  console.log("Starting handleSubmit", { score, wallet, runId: runIdRef.current });
  setSubmitError(null);
  if (submitLockRef.current) {
    console.log("Early return: submit locked");
    return;
  }
  submitLockRef.current = true;
  const thisRunId = runIdRef.current;

  try {
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      console.log("Early return: invalid wallet", wallet);
      setSubmitError("Wallet inválida.");
      return;
    }
    if (!Number.isFinite(score) || score <= 0) {
      console.log("Early return: invalid score", score);
      setSubmitError("Score precisa ser > 0 (delta).");
      return;
    }
    if (!thisRunId) {
      console.log("Early return: no runId");
      setSubmitError("Rodada inválida. Jogue novamente.");
      return;
    }
    if (confirmed) {
      console.log("Early return: already confirmed");
      return;
    }

    setSubmitting(true);
    setTxHash(null);

    console.log("Fetching /api/finish-run with body", {
      runId: thisRunId,
      sessionId: "demo",
      scoreDelta: score,
      txDelta: 1, // ALTERADO: sempre enviar 1 para transactionAmount
      wallet,
    });

    const resp = await fetch("/api/finish-run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": thisRunId,
      },
      body: JSON.stringify({
        runId: thisRunId,
        sessionId: "demo",
        scoreDelta: score,
        txDelta: 0, // ALTERADO: sempre enviar 1 para transactionAmount
        wallet,
      }),
    });

    console.log("Fetch response status", resp.status, resp.ok);

    const r = await resp.json().catch(() => ({}));
    console.log("Parsed response json", r);

    if (!resp.ok || !r?.ok) {
      const error = r?.error ?? "Falha ao enviar score.";
      console.log("Error in response", error);
      setSubmitError(error);
      return;
    }

    console.log("Success, txHash", r.txHash);

    if (runIdRef.current === thisRunId) {
      setConfirmed(true);
      setTxHash(r.txHash as string);
      setSentOnchain(r?.sent?.scoreDelta != null ? Number(r.sent.scoreDelta) : null);
    }
    setRecentTxs((prev) =>
      [
        {
          txHash: r.txHash as string,
          score: Number(r?.sent?.scoreDelta) || score,
          at: Date.now(),
        },
        ...prev,
      ].slice(0, 10),
    );
  } catch (e: any) {
    console.error("Error in handleSubmit catch", e);
    setSubmitError(e?.message ?? "Erro ao enviar score.");
  } finally {
    setSubmitting(false);
    if (runIdRef.current === thisRunId) {
      submitLockRef.current = false;
    }
  }
};

  // ====== NOVO: ENVIA +1 TRANSAÇÃO (scoreDelta = 0, txDelta = 1) ======
  async function handleUserTransaction(txHash: string) {
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      console.warn("Wallet inválida para tx tracking");
      return;
    }
    try {
      const resp = await fetch("/api/finish-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": txHash, // evita contagem em dobro
        },
        body: JSON.stringify({
          runId: txHash, // usa o hash como idempotência
          sessionId: "tx-only",
          scoreDelta: 0, // sem pontos
          txDelta: 1, // +1 transação
          wallet,
        }),
      });
      const r = await resp.json().catch(() => ({}));
      if (!resp.ok || !r?.ok) {
        console.warn("Falha ao registrar transactionAmount:", r?.error);
        return;
      }
      // atualiza a listinha de “Últimas transações”
      setRecentTxs((prev) =>
        [{ txHash: (r.txHash as string) ?? txHash, score: 0, at: Date.now() }, ...prev].slice(0, 10),
      );
    } catch (e) {
      console.warn("Erro no handleUserTransaction", e);
    }
  }

  const top3 = useMemo(() => board.slice(0, 3), [board]);

  return (
    <main className="min-h-dvh flex flex-col items-center gap-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex w-full max-w-7xl items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">Gravity Runner</h1>
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
            <span className="text-xs sm:text-sm opacity-70">
              {username ? `MONAD ID: ${username}` : ""}
            </span>
            <button onClick={() => logout()} className="px-3 py-2 bg-zinc-800 rounded">
              Sair
            </button>
          </div>
        )}
      </div>

      {canPlay && (
        <div className="grid w-full max-w-7xl grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* ==== COLUNA JOGO ==== */}
          <section className="w-full">
            {/* Stats fora do canvas em telas menores (mobile) */}
            <div className="sm:hidden mb-4 flex flex-col gap-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-3 shadow-lg">
              <div className="flex items-center gap-4">
                <img
                  src={"/images/player.png"}
                  alt="avatar"
                  className="h-10 w-10 rounded-xl object-cover ring-2 ring-white/20"
                />

                <div className="text-white">
                  <div className="text-sm font-semibold drop-shadow-sm">
                    {username || "Player"}
                  </div>
                </div>
              </div>

              {/* Valores simples */}
              <div className="flex justify-between text-white">
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-wider text-white/70">Score</div>
                  <div className="text-base font-semibold">{currentScore}</div>
                </div>
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-wider text-white/70">Speed</div>
                  <div className="text-base font-semibold">{Math.round(currentSpeed)} px/s</div>
                </div>
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-wider text-white/70">High Score</div>
                  <div className="text-lg font-bold text-yellow-300 drop-shadow">{highScore}</div>
                </div>
              </div>
            </div>

            <div className="relative">
              {/* Canvas */}
              <GameCanvas
                key={gameKey}
                playerScale={1.6}
                onStatsChange={({ score, speed }) => {
                  setCurrentScore(score);
                  setCurrentSpeed(speed);
                }}
                onGameOver={(score) => {
                  console.log("Game over with score", score);
                  setLastScore(score);
                  // high score local
                  if (score > highScore) {
                    setHighScore(score);
                    localStorage.setItem("highScore", String(score));
                  }
                  addToBoard(score);
                  setSubmitError(null);
                  setConfirmed(false);
                  setTxHash(null);
                  setSentOnchain(null);
                  // id de rodada + anti duplo envio
                  const rid =
                    (globalThis.crypto?.randomUUID?.() ??
                      Math.random().toString(36).slice(2)) + Date.now().toString(36);
                  runIdRef.current = rid;
                  pendingScoreRef.current = score;
                  submitLockRef.current = false;
                  if (score > 0) {
                    console.log("Calling handleSubmit for score > 0");
                    handleSubmit(score);
                  }
                }}
              />

              {/* Overlay desktop */}
              <div className="pointer-events-none absolute left-3 top-3 right-3 hidden sm:flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-3 shadow-lg">
                  <img
                    src={"/images/player.png"}
                    alt="avatar"
                    className="h-10 w-10 rounded-xl object-cover ring-2 ring-white/20"
                  />

                  <div className="text-white">
                    <div className="text-sm font-semibold drop-shadow-sm">
                      {username || "Player"}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-white">
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-white/70">Score</div>
                      <div className="text-base font-semibold">{currentScore}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-white/70">Speed</div>
                      <div className="text-base font-semibold">{Math.round(currentSpeed)} px/s</div>
                    </div>
                  </div>

                  <div className="ml-2 h-8 w-px bg-white/15" />

                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-white/70">
                      High Score
                    </div>
                    <div className="text-lg font-bold text-yellow-300 drop-shadow">{highScore}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ações pós-jogo */}
            {lastScore !== null && (
              <div className="w-full mt-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-base sm:text-lg">
                    🏁 Fim de jogo! Pontuação: <span className="font-bold">{lastScore}</span>
                    {lastScore > 0 && submitting && " - Enviando tx..."}
                    {lastScore > 0 && confirmed && " - Confirmado ✓"}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRestart}
                      className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      Jogar novamente
                    </button>
                  </div>
                </div>

                {txHash && (
                  <p className="mt-2 text-sm">
                    ✅ Confirmado. Tx: <span className="opacity-80">{txHash}</span>
                  </p>
                )}
                {submitError && <p className="mt-2 text-sm text-red-400">{submitError}</p>}

              </div>
            )}

            <p className="mt-2 text-xs text-white/70">
              Toque na tela ou pressione <kbd className="rounded bg-white/10 px-1">Espaço</kbd> para
              trocar de pista.
            </p>

            {/* Últimas transações */}
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-white mb-2">Últimas transações enviadas</h2>
              <ol className="space-y-2">
                {recentTxs.length === 0 && (
                  <li className="text-white/70 text-sm">Nenhuma ainda.</li>
                )}
                {recentTxs.map((tx, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-xl bg-white/5 p-2 border border-white/10"
                  >
                    <div className="text-sm text-white">Score: {tx.score}</div>
                    <div className="text-sm text-white/70">Tx: {shorten(tx.txHash)}</div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ==== COLUNA LEADERBOARD ==== */}
          <aside className="lg:sticky lg:top-4 h-fit">
            <GlobalLeaderboard />
          </aside>
        </div>
      )}
    </main>
  );
}
