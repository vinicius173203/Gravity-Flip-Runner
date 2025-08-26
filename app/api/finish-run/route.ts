// app/api/finish-run/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// —— cache simples em memória para idempotência (por instância) ——
const recentRuns: Set<string> = (globalThis as any).__recentRuns ?? new Set<string>();
(globalThis as any).__recentRuns = recentRuns;

// ABI mínima do contrato
const ABI = [
  {
    type: "function",
    name: "updatePlayerData",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "scoreAmount", type: "uint256" },
      { name: "transactionAmount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// Serializa BigInt em JSON
function bigintReplacer(_k: string, v: any) {
  return typeof v === "bigint" ? v.toString() : v;
}

function getEnvSafe() {
  const contract = (process.env.MONAD_GAMES_ID_ADDRESS ?? "").trim();
  const rpcUrl = (process.env.MONAD_RPC_URL ?? "").trim();
  const chainIdStr = (process.env.MONAD_CHAIN_ID ?? "").trim();
  let pk = (process.env.ADMIN_PRIVATE_KEY ?? "").trim();

  // normaliza private key
  pk = pk.replace(/^['"]|['"]$/g, "");
  if (pk && !pk.startsWith("0x")) pk = `0x${pk}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(pk))
    throw new Error("ADMIN_PRIVATE_KEY inválida (formato 0x + 64 hex).");
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract))
    throw new Error("MONAD_GAMES_ID_ADDRESS inválido (0x + 40 hex).");

  const chainId = Number(chainIdStr);
  if (!rpcUrl || !chainId)
    throw new Error("MONAD_RPC_URL / MONAD_CHAIN_ID ausentes.");

  // confirmações mínimas antes de responder
  const confirmations = Math.max(1, Number(process.env.REQUIRED_CONFIRMATIONS || "1"));

  // fator para “reduzir” score enviado (MVP). Padrão 0.5 (metade)
  const SCORE_SEND_FACTOR = Number(process.env.SCORE_SEND_FACTOR || "0.5");
  const scoreFactor =
    Number.isFinite(SCORE_SEND_FACTOR) && SCORE_SEND_FACTOR > 0
      ? SCORE_SEND_FACTOR
      : 1;

  const chain = {
    id: chainId,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  return {
    contract: contract as `0x${string}`,
    rpcUrl,
    chain,
    pk: pk as Hex,
    confirmations,
    scoreFactor,
  };
}

function extractWallet(body: any): `0x${string}` | null {
  const cand =
    typeof body?.wallet === "string"
      ? body.wallet
      : typeof body?.wallet?.address === "string"
      ? body.wallet.address
      : "";
  const s = String(cand || "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? (s as `0x${string}`) : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // —— Idempotência (runId no header ou body) ——
    const runId = String(req.headers.get("x-idempotency-key") || body?.runId || "").trim();
    if (!runId)
      return NextResponse.json({ ok: false, error: "runId ausente" }, { status: 400 });
    if (recentRuns.has(runId))
      return NextResponse.json(
        { ok: false, error: "Requisição duplicada (idempotência)" },
        { status: 409 },
      );
    recentRuns.add(runId);
    setTimeout(() => recentRuns.delete(runId), 2 * 60 * 1000).unref?.();

    // —— Validações do payload ——
    const wallet = extractWallet(body);
    const scoreDelta = Number(body?.scoreDelta ?? 0);
    const txDeltaRaw = Number(body?.txDelta ?? 0);
    const txDelta = Number.isFinite(txDeltaRaw) && txDeltaRaw > 0 ? txDeltaRaw : 0;
    // 🔍 Aqui entra o log:
    console.log("FINISH_RUN", {
      runId,
      wallet,
      scoreDelta,
      txDelta,
      now: Date.now(),
    });

    if (!wallet)
      return NextResponse.json({ ok: false, error: "wallet inválida" }, { status: 400 });

    // ✅ aceita score >= 0 OU txDelta > 0 (ao menos um válido)
    const scoreValid = Number.isFinite(scoreDelta) && scoreDelta >= 0;
    if (!scoreValid && txDelta <= 0) {
      return NextResponse.json(
        { ok: false, error: "payload inválido (scoreDelta>=0 ou txDelta>0)" },
        { status: 400 },
      );
    }

    const { contract, rpcUrl, chain, pk, confirmations, scoreFactor } = getEnvSafe();

    // 🔧 MVP: aplica fator no score (pode resultar 0)
    const scaledScoreDelta = Math.max(0, Math.floor(scoreDelta * scoreFactor));

    // —— Envia transação ——
    const account = privateKeyToAccount(pk);
    // 👇 AQUI (depois de criar o account, antes do writeContract)
console.log('FINISH_RUN args', {
  runId,
  sender: account.address,  // quem está chamando updatePlayerData
  wallet,                   // player
  scoreDelta,
  txDelta,
  t: Date.now(),
});
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    const hash = await walletClient.writeContract({
      address: contract,
      abi: ABI as any,
      functionName: "updatePlayerData",
      args: [wallet, BigInt(scaledScoreDelta), BigInt(txDelta)],
    });

    console.log('FINISH_RUN hash', { runId, hash });
    // Espera confirmação antes de responder
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations });
console.log('FINISH_RUN receipt', {
  runId,
  block: receipt.blockNumber?.toString(),
  status: (receipt as any).status ?? null,
});

    const payload = {
      ok: true,
      confirmed: true,
      confirmations,
      txHash: hash,
      sent: {
        scoreDelta: scaledScoreDelta, // o que foi efetivamente enviado
        txDelta,
      },
      receipt: {
        blockNumber: receipt.blockNumber?.toString(),
        status: (receipt as any).status ?? null,
      
      },
      
    };

    return new NextResponse(JSON.stringify(payload, bigintReplacer), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (e: any) {
    
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

    