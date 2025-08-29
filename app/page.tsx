"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMonadGamesWallet } from "@/hooks/useMonadGamesWallet";
import GameCanvas, { GameCanvasHandle } from "@/components/GameCanvas";
import GlobalLeaderboard from "@/components/GlobalLeaderboard";
import { FaDiscord, FaTwitter, FaGithub, FaRegCopy, FaCheck } from "react-icons/fa6";

const REG_URL = "https://monad-games-id-site.vercel.app/";

type Entry = { name: string; score: number; wallet: string; at: number };
type TxEntry = { txHash: string; score: number; at: number };

function shorten(addr?: string | null) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export default function Home() {
  const { login, logout, authenticated, ready } = usePrivy();
  const gameRef = useRef<GameCanvasHandle | null>(null);

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
  const [highScore, setHighScore] = useState(0);

  // recent txs
  const [recentTxs, setRecentTxs] = useState<TxEntry[]>([]);

  // idempotência
  const runIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const pendingScoreRef = useRef<number | null>(null);

  // valores ao vivo
  const [currentScore, setCurrentScore] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);

  // header height = canvas height
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [canvasHeight, setCanvasHeight] = useState<number>(360);

  // toast de "copiado"
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);

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

  // medir canvas wrapper
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasHeight(el.clientHeight || 360);
    });
    ro.observe(el);
    setCanvasHeight(el.clientHeight || 360);
    return () => ro.disconnect();
  }, []);

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
  };

  // copiar util
  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(`${label} copiado!`);
      setTimeout(() => setCopiedMsg(null), 1200);
    } catch {
      setCopiedMsg("Falha ao copiar");
      setTimeout(() => setCopiedMsg(null), 1200);
    }
  }

  // ====== ENVIA SCORE (scoreDelta > 0) ======
  const handleSubmit = async (score: number) => {
    setSubmitError(null);
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    const thisRunId = runIdRef.current;

    try {
      if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        setSubmitError("Wallet inválida.");
        return;
      }
      if (!Number.isFinite(score) || score <= 0) {
        setSubmitError("Score precisa ser > 0 (delta).");
        return;
      }
      if (!thisRunId) {
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
          "X-Idempotency-Key": thisRunId,
        },
        body: JSON.stringify({
          runId: thisRunId,
          sessionId: "demo",
          scoreDelta: score,
          txDelta: 1,
          wallet,
        }),
      });

      const r = await resp.json().catch(() => ({}));
      if (!resp.ok || !r?.ok) {
        const error = r?.error ?? "Falha ao enviar score.";
        setSubmitError(error);
        return;
      }

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
      setSubmitError(e?.message ?? "Erro ao enviar score.");
    } finally {
      setSubmitting(false);
      if (runIdRef.current === thisRunId) {
        submitLockRef.current = false;
      }
    }
  };

  // ====== registrar tx manual (opcional) ======
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
          "X-Idempotency-Key": txHash,
        },
        body: JSON.stringify({
          runId: txHash,
          sessionId: "tx-only",
          scoreDelta: 0,
          txDelta: 0,
          wallet,
        }),
      });

      const r = await resp.json().catch(() => ({}));
      if (!resp.ok || !r?.ok) {
        console.warn("Falha ao registrar transactionAmount:", r?.error);
        return;
      }
      setRecentTxs((prev) =>
        [{ txHash: (r.txHash as string) ?? txHash, score: 0, at: Date.now() }, ...prev].slice(0, 10),
      );
    } catch (e) {
      console.warn("Erro no handleUserTransaction", e);
    }
  }

  const top3 = useMemo(() => board.slice(0, 3), [board]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-4 md:p-6 bg-gradient-to-b from-black via-indigo-950 to-black relative overflow-hidden">
      {/* BG fx */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(79,70,229,0.12)_0%,transparent_55%)]" />
        <div className="stars absolute inset-0" />
      </div>

      {/* ===== HEADER (altura = altura do canvas) ===== */}
      <header
        className="
            z-20 w-full
            h-14         /* altura padrão (56px) para mobile */
            sm:h-16      /* altura 64px em telas ≥640px */
            md:h-20      /* altura 80px em telas ≥768px */
          "
        >
        <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur px-4 py-3 shadow-xl shadow-indigo-500/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-tr from-cyan-400 to-violet-500 shadow-lg shadow-cyan-500/25" />
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Zero Gravity Runner</h1>
              <p className="text-xs text-white/60">Onchain arcade • flip to survive</p>
            </div>
          </div>

          {!authenticated ? (
            <button
              onClick={() => login()}
              disabled={!ready}
              className="px-4 py-2 rounded-2xl bg-emerald-600 disabled:opacity-40 hover:opacity-90 shadow shadow-emerald-600/30"
            >
              {ready ? "Sign in with Monad Games ID" : "Carregando…"}
            </button>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              {/* wallet pill + copiar */}
              <div className="hidden sm:flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm text-white/80">
                  {username || "Player"} {wallet ? `· ${shorten(wallet)}` : ""}
                </span>
                {wallet && (
                  <button
                    onClick={() => copyToClipboard(wallet, "Wallet")}
                    className="ml-1 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/80 hover:bg-black/60"
                    title="Copy wallet"
                  >
                    <FaRegCopy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                )}
              </div>

              <button
                onClick={() => logout()}
                className="px-3 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700"
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ===== MAIN GRID ===== */}
      {canPlay && (
        <div className="grid w-full max-w-7xl grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 z-10 mt-6">
          {/* ==== COLUNA JOGO ==== */}
          <section className="w-full">
            {/* Stats fora do canvas (mobile) */}
            <div className="sm:hidden mb-4 flex flex-col gap-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-3 shadow-lg shadow-indigo-500/20">
              <div className="flex items-center gap-4">
                <img
                  src={"/images/player.png"}
                  alt="avatar"
                  className="h-10 w-10 rounded-xl object-cover ring-2 ring-white/20"
                />
                <div className="text-white">
                  <div className="text-sm font-semibold drop-shadow-sm">{username || "Player"}</div>
                </div>
              </div>

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

            {/* Botão Select character (mobile) */}
            <div className="mt-2 sm:hidden">
              <button
                onClick={() => gameRef.current?.openCharSelect()}
                disabled={lastScore === null}
                className={`w-full px-3 py-2 rounded-2xl text-sm border transition-colors
                  ${
                    lastScore !== null
                      ? "bg-black/50 text-white border-white/15 hover:bg-black/70"
                      : "bg-black/30 text-white/60 border-white/10 cursor-not-allowed"
                  }`}
                title={lastScore !== null ? "Selecionar personagem" : "Disponível após o fim da partida"}
              >
                👤 Select character
              </button>
            </div>

            {/* === CANVAS WRAPPER (referência para medir altura) === */}
            <div
              ref={canvasWrapRef}
              className="relative rounded-2xl overflow-hidden shadow-xl shadow-indigo-500/30 border border-white/10"
            >
              <GameCanvas
                ref={gameRef}
                key={gameKey}
                playerScale={1.6}
                onStatsChange={({ score, speed }) => {
                  setCurrentScore(score);
                  setCurrentSpeed(speed);
                }}
                onGameOver={(score) => {
                  setLastScore(score);
                  if (score > highScore) {
                    setHighScore(score);
                    localStorage.setItem("highScore", String(score));
                  }
                  addToBoard(score);
                  setSubmitError(null);
                  setConfirmed(false);
                  setTxHash(null);
                  setSentOnchain(null);
                  const rid =
                    (globalThis.crypto?.randomUUID?.() ??
                      Math.random().toString(36).slice(2)) + Date.now().toString(36);
                  runIdRef.current = rid;
                  pendingScoreRef.current = score;
                  submitLockRef.current = false;
                  if (score > 0) {
                    handleSubmit(score);
                  }
                }}
                onRestartRequest={handleRestart}
              />

              {/* Overlay desktop sobre o canvas */}
              <div className="pointer-events-none absolute left-3 top-3 right-3 hidden sm:flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-3 shadow-lg shadow-indigo-500/20">
                  <img
                    src={"/images/player.png"}
                    alt="avatar"
                    className="h-10 w-10 rounded-xl object-cover ring-2 ring-white/20"
                  />

                  <div className="text-white">
                    <div className="text-sm font-semibold drop-shadow-sm">{username || "Player"}</div>
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
                    <div className="text-[10px] uppercase tracking-wider text-white/70">High Score</div>
                    <div className="text-lg font-bold text-yellow-300 drop-shadow">{highScore}</div>
                  </div>

                  <button
                    onClick={() => gameRef.current?.openCharSelect()}
                    disabled={lastScore === null}
                    className={`ml-3 px-3 py-2 rounded-2xl text-white text-sm backdrop-blur border pointer-events-auto transition-colors
                      ${
                        lastScore !== null
                          ? "bg-black/50 border-white/15 hover:bg-black/70"
                          : "bg-black/30 border-white/10 cursor-not-allowed opacity-60"
                      }`}
                    title={lastScore !== null ? "Selecionar personagem" : "Disponível após o fim da partida"}
                  >
                    👤 Select character
                  </button>
                </div>
              </div>
            </div>

            {/* Ações pós-jogo */}
            {lastScore !== null && (
              <div className="w-full mt-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 shadow-md shadow-indigo-500/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-base sm:text-lg">
                    🏁 Game over! Score: <span className="font-bold">{lastScore}</span>
                    {lastScore > 0 && submitting && " - Enviando tx..."}
                    {lastScore > 0 && confirmed && " - Confirmado ✓"}
                  </div>
                </div>

                {txHash && (
                  <p className="mt-2 text-sm flex items-center gap-2">
                    ✅ Confirmed. Tx:
                    <span className="opacity-80">{txHash}</span>
                    <button
                      onClick={() => copyToClipboard(txHash, "Tx")}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/80 hover:bg-black/60"
                      title="Copy transaction hash"
                    >
                      <FaRegCopy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  </p>
                )}
                {submitError && <p className="mt-2 text-sm text-red-400">{submitError}</p>}
              </div>
            )}

            <p className="mt-2 text-xs text-white/70">
              Tap the screen or press <kbd className="rounded bg-white/10 px-1">Space</kbd> to change lanes.
            </p>

            {/* Últimas transações (com copiar) */}
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-white mb-2">Latest Sent Transactions</h2>
              <ol className="space-y-2">
                {recentTxs.length === 0 && (
                  <li className="text-white/70 text-sm">Nenhuma ainda.</li>
                )}
                {recentTxs.map((tx, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-xl bg-white/5 p-2 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <div className="text-sm text-white">Score: {tx.score}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm text-white/70">{shorten(tx.txHash)}</div>
                      <button
                        onClick={() => copyToClipboard(tx.txHash, "Tx")}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/80 hover:bg-black/60"
                        title="Copy transaction hash"
                      >
                        <FaRegCopy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ==== COLUNA LEADERBOARD ==== */}
          <aside className="lg:sticky lg:top-4 h-fit rounded-2xl border border-white/10 bg-zinc-900/60 p-4 shadow-lg shadow-indigo-500/20">
            <GlobalLeaderboard />
          </aside>
        </div>
      )}

      {/* Footer com redes */}
      <footer className="w-full border-t border-white/10 mt-10">
        <div className="mx-auto max-w-7xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/70">
            © {new Date().getFullYear()} Zero Gravity Runner — Developed by Vinícius Medina
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/vinicius173203"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              aria-label="GitHub"
              title="GitHub"
            >
              <FaGithub className="h-5 w-5 text-white/80 group-hover:text-white" />
            </a>
            <a
              href="https://discord.com/channels/905936657075810316"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              aria-label="Discord"
              title="Discord"
            >
              <FaDiscord className="h-5 w-5 text-white/80 group-hover:text-white" />
            </a>
            <a
              href="https://x.com/viniciusmedian"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              aria-label="Twitter / X"
              title="Twitter / X"
            >
              <FaTwitter className="h-5 w-5 text-white/80 group-hover:text-white" />
            </a>
          </div>
        </div>
      </footer>

      {/* Toast copiando */}
      {copiedMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-sm text-white shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <FaCheck className="h-4 w-4 text-emerald-400" />
            {copiedMsg}
          </div>
        </div>
      )}
    </div>
  );
}
