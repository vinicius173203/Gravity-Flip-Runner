import { NextRequest, NextResponse } from "next/server";
import { submitPlayerDelta } from "@/server/onchain";

export async function POST(req: NextRequest) {
  try {
    const { sessionId, scoreDelta, txDelta, wallet } = await req.json();
    // TODO: validar sessionId, limites e rate limit
    if (!wallet || typeof scoreDelta !== "number") throw new Error("payload inválido");
    const txHash = await submitPlayerDelta({
      player: wallet,
      scoreDelta: BigInt(scoreDelta),
      txDelta: BigInt(txDelta ?? 0),
    });
    return NextResponse.json({ ok: true, txHash });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 400 });
  }
}
