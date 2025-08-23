// app/api/finish-run/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Garanta Node runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Carregue envs
const CONTRACT = (process.env.MONAD_GAMES_ID_ADDRESS || "").trim() as Hex;
const RPC_URL = (process.env.MONAD_RPC_URL || "").trim();
const CHAIN_ID = Number(process.env.MONAD_CHAIN_ID || "0");

// ABI mínima
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
];

// Normaliza/valida a private key com mensagens claras
function getAdminAccount() {
  let pk = (process.env.ADMIN_PRIVATE_KEY || "").trim();
  // remove aspas acidentais
  pk = pk.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
  // adiciona 0x se faltar
  if (pk && !pk.startsWith("0x")) pk = `0x${pk}`;
  const isHex64 = /^0x[0-9a-fA-F]{64}$/.test(pk);
  if (!isHex64) {
    throw new Error(
      "ADMIN_PRIVATE_KEY inválida. Esperado formato 0x + 64 hex (ex.: 0xAB..64 hex..CD). " +
      "Confira nas Environment Variables da Vercel."
    );
  }
  return privateKeyToAccount(pk as Hex);
}

function getChain() {
  if (!RPC_URL || !CHAIN_ID) throw new Error("MONAD_RPC_URL / MONAD_CHAIN_ID ausentes.");
  return {
    id: CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };
}

export async function POST(req: NextRequest) {
  try {
    const { wallet, scoreDelta, txDelta } = await req.json();

    if (!wallet) return NextResponse.json({ ok: false, error: "wallet ausente" }, { status: 400 });
    if (typeof scoreDelta !== "number" || scoreDelta <= 0) {
      return NextResponse.json({ ok: false, error: "scoreDelta inválido" }, { status: 400 });
    }
    const txInc = typeof txDelta === "number" && txDelta > 0 ? txDelta : 0;

    const account = getAdminAccount();
    const chain = getChain();

    const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
    const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: ABI as any,
      functionName: "updatePlayerData",
      args: [wallet as `0x${string}`, BigInt(scoreDelta), BigInt(txInc)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return NextResponse.json({ ok: true, txHash: hash, block: receipt.blockNumber });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "erro" }, { status: 500 });
  }
}
