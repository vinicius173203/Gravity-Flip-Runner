// /components/GlobalLeaderboard.tsx
"use client";
import { useEffect, useState } from "react";

type Row = { name: string; score: number; display?: string }; // display opcional

export default function GlobalLeaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
  let alive = true;
  (async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/global-leaderboard"); // sem "no-store"
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Erro ao carregar leaderboard");
      if (alive) setRows(j.entries as Row[]);
    } catch (e: any) {
      if (alive) setErr(e?.message || "Falha ao carregar leaderboard");
    } finally {
      if (alive) setLoading(false);
    }
  })();
  return () => { alive = false; };
}, []);


  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-4 backdrop-blur-md shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
        <span className="text-xs text-white/70">Top 10 • Scores</span>
      </div>

      {loading && <div className="animate-pulse text-white/70 text-sm">Carregando…</div>}
      {err && <div className="text-sm text-red-300">{err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div className="text-white/70 text-sm">Sem dados no momento.</div>
      )}

      {!loading && !err && rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((e, i) => (
  <li key={`${e.name}-${i}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/8 p-3">
    <div className="flex items-center gap-3">
      <div className={[
        "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold",
        i===0?"bg-yellow-300 text-black":i===1?"bg-gray-200 text-black":i===2?"bg-amber-600 text-white":"bg-white/10 text-white/90"
      ].join(" ")}>
        {i+1}
      </div>
      <div className="text-sm text-white font-medium">{e.name}</div>
    </div>
    <div className="text-right">
      <div className="text-lg font-extrabold text-yellow-300 tabular-nums">
        {/* PRIORIDADE: texto original do site */}
        {e.display ?? formatScoreFallback(e.score)}
      </div>
    </div>
  </li>
))}
        </ol>
      )}
    </div>
  );
}

function formatScoreFallback(n: number) {
  // não usa milhares; mantém 3 casas só se houver decimais
  return Number.isInteger(n)
    ? String(n)
    : n.toLocaleString("en-US", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
        useGrouping: false,
      });
}
