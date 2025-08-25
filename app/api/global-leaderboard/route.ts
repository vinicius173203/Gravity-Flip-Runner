import { NextResponse } from "next/server";

const SOURCE =
  "https://monad-games-id-site.vercel.app/leaderboard?page=1&gameId=72&sortBy=scores";
const TOP_N = 10;

// === CACHE IN-MEMORY (processo) ===
const TTL_MS = 60_000;
let cacheData:
  | { ok: true; source: string; entries: Array<{ name: string; score: number; display: string }> }
  | null = null;
let cacheExpiresAt = 0;
let pending: Promise<typeof cacheData> | null = null;

export async function GET() {
  try {
    const now = Date.now();
    // 1) hit de cache
    if (cacheData && now < cacheExpiresAt) {
      return withCacheHeaders(NextResponse.json({ ...cacheData, cache: { hit: true, age: Math.floor((TTL_MS - (cacheExpiresAt - now)) / 1000) } }));
    }
    // 2) requisição já em andamento? aguarda a mesma
    if (pending) {
      const data = await pending;
      return withCacheHeaders(NextResponse.json({ ...(data ?? { ok: false, entries: [] as any }), cache: { hit: true, coalesced: true } }));
    }

    // 3) dispara a busca e guarda em "pending" para dedupe
    pending = (async () => {
      const entries = await fetchAndParse();
      const payload = { ok: true as const, source: SOURCE, entries };
      cacheData = payload;
      cacheExpiresAt = Date.now() + TTL_MS;
      return payload;
    })();

    const data = await pending;
    pending = null;

    return withCacheHeaders(NextResponse.json({ ...data, cache: { hit: false } }));
  } catch (e: any) {
    pending = null;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 500 }
    );
  }
}

function withCacheHeaders(resp: NextResponse) {
  resp.headers.set(
    "Cache-Control",
    // CDN (s-maxage) 60s + SWR 5min; browser pode reusar por 30s
    "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
  );
  return resp;
}

/* =============== core =============== */

async function fetchAndParse() {
  const res = await fetch(SOURCE, {
    // deixe o fetch cacheável por infra; nós já temos TTL in-memory
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  const html = await res.text();

  // 1) escolha a tabela mais provável
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  if (tables.length === 0) throw new Error("Nenhuma <table> no HTML");

  const chosen =
    tables.find((t) => {
      const headTxt = (t.match(/<th[\s\S]*?<\/th>/gi) ?? [])
        .map(stripHtml)
        .join(" ")
        .toLowerCase();
      return /(rank|player|wallet|score|pontua)/.test(headTxt);
    }) ?? tables[0];

  // 2) índices (se tiver header)
  const ths = chosen.match(/<th[\s\S]*?<\/th>/gi) ?? [];
  const headerTexts = ths.map((th) => stripHtml(th).toLowerCase());
  let playerCol = indexOfHeader(headerTexts, ["player", "jogador", "nome"]);
  let scoreCol  = indexOfHeader(headerTexts, ["score", "pontuação", "scores"]);
  let walletCol = indexOfHeader(headerTexts, ["wallet", "carteira", "endereço"]);

  // 3) linhas
  const rows = chosen.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const entries: { name: string; score: number; display: string }[] = [];

  for (const row of rows) {
    const tds = row.match(/<td[\s\S]*?<\/td>/gi);
    if (!tds) continue;

    // fallback por heurística
    if (walletCol < 0) walletCol = guessWalletCol(tds);
    if (scoreCol  < 0) scoreCol  = guessScoreCol(tds);
    if (playerCol < 0) playerCol = guessPlayerCol(tds, walletCol, scoreCol);

    const nameCell  = tds[playerCol];
    const scoreCell = tds[scoreCol];
    if (!nameCell || !scoreCell) continue;

    const name = cleanName(stripHtml(nameCell));
    if (!name || isRankLike(name)) continue;

    const scoreTextRaw = normalizeScoreText(stripHtml(scoreCell)); // "8,582" | "8.584" | "284"
    const score = parseHumanNumber(scoreTextRaw);                   // 8582    | 8584    | 284
    const display = scoreTextRaw.replace(/,/g, ".");                // exibimos com PONTO como milhar

    if (Number.isFinite(score)) entries.push({ name, score, display });
  }

  // 4) dedupe por nome (maior score) e ordena
  const top = Array.from(bestByName(entries).entries())
    .map(([name, v]) => ({ name, score: v.score, display: v.display }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return top;
}

/* =============== helpers =============== */

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function cleanName(s: string) {
  return s.replace(/\s+/g, " ").trim();
}
function normalizeScoreText(s: string) {
  // limpa espaços (inclui NBSP), mantém sinais/pontos/vírgulas
  return s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}
function isRankLike(s: string) {
  return /^(#?\d+(st|nd|rd|th)?)$/i.test(s);
}
function indexOfHeader(headers: string[], needles: string[]) {
  return headers.findIndex((h) => needles.some((n) => h.includes(n)));
}

/**
 * Converte texto “humano” em número:
 * - '.' e ',' presentes → o ÚLTIMO separador é decimal.
 * - só ',' → se grupos de 3 dígitos → MILHAR; senão decimal.
 * - só '.' → se grupos de 3 dígitos → MILHAR; senão decimal.
 * - senão → inteiro puro.
 */
function parseHumanNumber(raw: string) {
  let s = (raw || "").trim();
  if (!s) return NaN;
  s = s.replace(/\u00A0/g, " "); // NBSP

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    const intPart = s.slice(0, lastSep).replace(/[.,\s]/g, "");
    const fracPart = s.slice(lastSep + 1).replace(/[^\d]/g, "");
    return Number(`${intPart}.${fracPart}`);
  }

  if (hasComma && !hasDot) {
    const parts = s.split(",");
    const allTriads = parts.slice(1).every((p) => /^\d{3}$/.test(p));
    if (parts.length > 1 && allTriads) return Number(parts.join("")); // 8,582 → 8582
    return Number(s.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")); // 3,5 → 3.5
  }

  if (hasDot && !hasComma) {
    const parts = s.split(".");
    const allTriads = parts.slice(1).every((p) => /^\d{3}$/.test(p));
    if (parts.length > 1 && allTriads) return Number(parts.join("")); // 8.584 → 8584
    return Number(s.replace(/,/g, "").replace(/[^\d.]/g, "")); // 3.5 → 3.5
  }

  return Number(s.replace(/[^\d-]/g, ""));
}

function guessWalletCol(tds: string[]) {
  const idx = tds.findIndex((td) => /0x[a-fA-F0-9]{40}/.test(td));
  return idx >= 0 ? idx : -1;
}
function guessScoreCol(tds: string[]) {
  const nums = tds.map((td) => {
    const txt = stripHtml(td);
    const m = txt.match(/-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?/g) || [];
    const last = m.length ? m[m.length - 1] : "";
    return parseHumanNumber(last);
  });
  let bestI = -1;
  let bestV = -Infinity;
  nums.forEach((v, i) => {
    if (Number.isFinite(v) && v > bestV) {
      bestV = v; bestI = i;
    }
  });
  return bestI;
}
function guessPlayerCol(tds: string[], walletCol: number, scoreCol: number) {
  for (let i = 0; i < tds.length; i++) {
    if (i === walletCol || i === scoreCol) continue;
    const txt = cleanName(stripHtml(tds[i]));
    if (!txt) continue;
    if (isRankLike(txt)) continue;
    if (/0x[a-fA-F0-9]{40}/.test(txt)) continue;
    return i;
  }
  return 0;
}
function bestByName(items: { name: string; score: number; display: string }[]) {
  const map = new Map<string, { score: number; display: string }>();
  for (const it of items) {
    const cur = map.get(it.name);
    if (!cur || it.score > cur.score) map.set(it.name, { score: it.score, display: it.display });
  }
  return map;
}
