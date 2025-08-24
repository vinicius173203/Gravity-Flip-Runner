"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMonadGamesWallet } from "@/hooks/useMonadGamesWallet";
import GameCanvas from "@/components/GameCanvas";

const REG_URL = "https://monad-games-id-site.vercel.app/";

type Entry = { name: string; score: number; wallet: string; at: number };

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

  // idempotência
  const runIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const pendingScoreRef = useRef<number | null>(null);

  // valores ao vivo (sem barras, só números)
  const [currentScore, setCurrentScore] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);

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

  // carrega leaderboard/highscore
  useEffect(() => {
    const saved = localStorage.getItem("leaderboard");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Entry[];
        setBoard(parsed);
      } catch {}
    }
    const hs = localStorage.getItem("highScore");
    if (hs) setHighScore(parseInt(hs, 10) || 0);
  }, []);
  useEffect(() => {
    localStorage.setItem("leaderboard", JSON.stringify(board.slice(0, 50)));
  }, [board]);

  const canPlay = Boolean(authenticated && wallet && username);

  function addToBoard(score: number) {
    const entry: Entry = {
      name: username || "Player",
      score,
      wallet: wallet ?? "",
      at: Date.now(),
    };
    setBoard((prev) =>
      [...prev, entry].sort((a, b) => b.score - a.score).slice(0, 20)
    );
  }

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
    if (submitLockRef.current) return;
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
      if (pendingScoreRef.current !== lastScore) {
        setSubmitError("Pontuação mudou. Jogue novamente.");
        return;
      }
      if (!runIdRef.current) {
        setSubmitError("Rodada inválida. Jogue novamente.");
        return;
      }
      if (confirmed) return;

      setSubmitting(true);
      setTxHash(null);

      const resp = await fetch("/api/finish-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": runIdRef.current,
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

      setConfirmed(true);
      setTxHash(r.txHash as string);
      setSentOnchain(
        r?.sent?.scoreDelta != null ? Number(r.sent.scoreDelta) : null
      );
    } catch (e: any) {
      setSubmitError(e?.message ?? "Erro ao enviar score.");
    } finally {
      setSubmitting(false);
      if (!confirmed) submitLockRef.current = false;
    }
  };

  const top3 = useMemo(() => board.slice(0, 3), [board]); // opcional, pode remover

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
                      Math.random().toString(36).slice(2)) +
                    Date.now().toString(36);
                  runIdRef.current = rid;
                  pendingScoreRef.current = score;
                  submitLockRef.current = false;
                }}
              />

              {/* ==== OVERLAY (avatar + stats + high score) ==== */}
              <div className="pointer-events-none absolute left-3 top-3 right-3 hidden sm:flex sm:flex-row sm:items-center gap-3">
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
                  {/* HUD compacto para mobile (fica fora do canvas) */}
<div className="sm:hidden mt-2">
  <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-3">
    <div className="flex items-center gap-3">
      <img
        src={"/images/player.png"}
        alt="avatar"
        className="h-8 w-8 rounded-lg object-cover ring-2 ring-white/20"
      />
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">{username || "Player"}</div>
        {/* opcional: carteira curta */}
        {/* <div className="text-[10px] text-white/70">{shorten(wallet ?? "")}</div> */}
      </div>
    </div>

    <div className="flex items-center gap-4 text-white">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-white/70">Pts</div>
        <div className="text-base font-semibold">{currentScore}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-white/70">Vel</div>
        <div className="text-base font-semibold">{Math.round(currentSpeed)} px/s</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-white/70">HS</div>
        <div className="text-base font-bold text-yellow-300">{highScore}</div>
      </div>
    </div>
  </div>
</div>


                  {/* Valores simples */}
                  <div className="flex items-center gap-4 text-white">
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-white/70">
                        Score
                      </div>
                      <div className="text-base font-semibold">{currentScore}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-white/70">
                        Speed
                      </div>
                      <div className="text-base font-semibold">
                        {Math.round(currentSpeed)} px/s
                      </div>
                    </div>
                  </div>

                  <div className="ml-2 h-8 w-px bg-white/15" />

                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-white/70">
                      High Score
                    </div>
                    <div className="text-lg font-bold text-yellow-300 drop-shadow">
                      {highScore}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ações pós-jogo */}
            {lastScore !== null && (
              <div className="w-full mt-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-base sm:text-lg">
                    🏁 Fim de jogo! Pontuação:{" "}
                    <span className="font-bold">{lastScore}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRestart}
                      className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700"
                      disabled={!confirmed || submitting}
                      title={
                        !confirmed
                          ? "Aguarde a confirmação onchain"
                          : "Começar nova rodada"
                      }
                    >
                      Jogar novamente
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || confirmed || (lastScore ?? 0) <= 0}
                      className="px-3 py-2 rounded bg-amber-600 disabled:opacity-40 hover:opacity-90"
                      title={
                        confirmed
                          ? "Score já confirmado onchain"
                          : "Enviar e aguardar confirmação onchain"
                      }
                      style={{ pointerEvents: submitting || confirmed ? "none" : "auto" }}
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

            <p className="mt-2 text-xs text-white/70">
              Toque na tela ou pressione{" "}
              <kbd className="rounded bg-white/10 px-1">Espaço</kbd> para trocar
              de pista.
            </p>
          </section>

          {/* ==== COLUNA LEADERBOARD ==== */}
          <aside className="lg:sticky lg:top-4 h-fit">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
                <a
                  href="https://monad-games-id-site.vercel.app/leaderboard?page=1&gameId=72"
                  target="_blank"
                  className="text-xs underline text-white/80 hover:text-white"
                >
                  ver completa ↗
                </a>
              </div>
              <ol className="space-y-2">
                {board.length === 0 && (
                  <li className="text-white/70 text-sm">Jogue para criar o ranking ✨</li>
                )}
                {board.map((e, i) => (
                  <li
                    key={`${e.wallet}-${e.at}-${i}`}
                    className="flex items-center justify-between rounded-xl bg-white/5 p-2 border border-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-xs text-white/90">
                        #{i + 1}
                      </div>
                      <div className="leading-tight">
                        <div className="text-sm text-white font-medium">{e.name}</div>
                        <div className="text-xs text-white/70">{shorten(e.wallet)}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-yellow-300">{e.score}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
