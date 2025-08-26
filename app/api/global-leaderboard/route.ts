// /app/api/global-leaderboard/route.ts
import { NextResponse } from "next/server";

// 🚫 desliga cache do Next/Vercel para esta rota
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Se estiver em Next >= 14.2: export const fetchCache = "default-no-store";

const SOURCE =
  "https://monad-games-id-site.vercel.app/leaderboard?page=1&gameId=89&sortBy=scores";
const TOP_N = 10;

// ===== Tipos =====
type Entry = { name: string; score: number; display: string };
type Payload = { ok: true; source: string; entries: Entry[] };

// ===== Cache in-memory =====
const TTL_MS = 60_000;
let cacheData: Payload | null = null;
let cacheExpiresAt = 0;
let pending: Promise<Payload> | null = null;

export async function GET() {
  try {
    const now = Date.now();

    if (cacheData && now < cacheExpiresAt) {
      return withCacheHeaders(
        NextResponse.json({
          ...cacheData,
          cache: { hit: true, age: Math.floor((TTL_MS - (cacheExpiresAt - now)) / 1000) },
        }),
      );
    }
    if (pending) {
      const data = await pending;
      return withCacheHeaders(
        NextResponse.json({ ...data, cache: { hit: true, coalesced: true } }),
      );
    }

    pending = (async (): Promise<Payload> => {
      const entries = await fetchAndParse();
      const payload: Payload = { ok: true, source: SOURCE, entries };
      cacheData = payload;
      cacheExpiresAt = Date.now() + TTL_MS;
      return payload;
    })();

    const data = await pending;
    pending = null;

    return withCacheHeaders(NextResponse.json({ ...data, cache: { hit: false } }));
  } catch (e: any) {
    pending = null;
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status: 500 });
  }
}

// ✅ não deixe o CDN/navegador reter a resposta desta rota
function withCacheHeaders(resp: NextResponse) {
  resp.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  return resp;
}

/* =============== core =============== */

async function fetchAndParse(): Promise<Entry[]> {
  const res = await fetch(SOURCE, {
    // ✅ desliga cache do fetch no Next
    cache: "no-store",
    next: { revalidate: 0 },
    headers: {
      // pede sempre uma cópia fresca da origem/CDN
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  const html = await res.text();

  // ... resto igual ...
  // 1) escolhe a tabela mais provável
  const tables = (html.match(/<table[\s\S]*?<\/table>/gi) ?? []) as string[];
  if (tables.length === 0) throw new Error("Nenhuma <table> no HTML");

  let chosen: string = tables[0];
  const maybe = tables.find((t) => {
    const headTxt = (t.match(/<th[\s\S]*?<\/th>/gi) ?? [])
      .map(stripHtml)
      .join(" ")
      .toLowerCase();
    return /(rank|player|wallet|score|pontua)/.test(headTxt);
  });
  if (maybe) chosen = maybe;

  // 2) índices (se tiver header)
  const ths = chosen.match(/<th[\s\S]*?<\/th>/gi) ?? [];
  const headerTexts = ths.map((th) => stripHtml(th).toLowerCase());
  let playerCol = indexOfHeader(headerTexts, ["player", "jogador", "nome"]);
  let scoreCol = indexOfHeader(headerTexts, ["score", "pontuação", "scores"]);
  let walletCol = indexOfHeader(headerTexts, ["wallet", "carteira", "endereço"]);

  // 3) linhas
  const rows = chosen.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const entries: Entry[] = [];

  for (const row of rows) {
    const tds = row.match(/<td[\s\S]*?<\/td>/gi);
    if (!tds) continue;

    if (walletCol < 0) walletCol = guessWalletCol(tds);
    if (scoreCol < 0) scoreCol = guessScoreCol(tds);
    if (playerCol < 0) playerCol = guessPlayerCol(tds, walletCol, scoreCol);

    if (playerCol < 0 || scoreCol < 0) continue;

    const nameCell = tds[playerCol];
    const scoreCell = tds[scoreCol];
    if (!nameCell || !scoreCell) continue;

    const name = cleanName(stripHtml(nameCell));
    if (!name || isRankLike(name)) continue;

    const scoreTextRaw = normalizeScoreText(stripHtml(scoreCell));
    const score = parseHumanNumber(scoreTextRaw);
    const display = scoreTextRaw.replace(/,/g, ".");

    if (Number.isFinite(score)) entries.push({ name, score, display });
  }

  const top = Array.from(bestByName(entries).entries())
    .map(([name, v]) => ({ name, score: v.score, display: v.display }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return top;
}

// ... helpers inalterados ...


/* =============== helpers =============== */

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function cleanName(s: string) {
  return s.replace(/\s+/g, " ").trim();
}
function normalizeScoreText(s: string) {
  return s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}
function isRankLike(s: string) {
  return /^(#?\d+(st|nd|rd|th)?)$/i.test(s);
}
function indexOfHeader(headers: string[], needles: string[]) {
  return headers.findIndex((h) => needles.some((n) => h.includes(n)));
}

/**
 * Converte texto em número entendendo milhar/decimal:
 * - '.' e ',' presentes → o ÚLTIMO separador é decimal.
 * - só ',' → se grupos de 3 dígitos → MILHAR; senão decimal.
 * - só '.' → se grupos de 3 dígitos → MILHAR; senão decimal.
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
      bestV = v;
      bestI = i;
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
function bestByName(items: Entry[]) {
  const map = new Map<string, { score: number; display: string }>();
  for (const it of items) {
    const cur = map.get(it.name);
    if (!cur || it.score > cur.score) map.set(it.name, { score: it.score, display: it.display });
  }
  return map;
}
