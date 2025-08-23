import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Abi } from "viem";
import ABI from "@/contracts/monad-games-id.abi.json";

const account = privateKeyToAccount(process.env.ADMIN_PRIVATE_KEY as `0x${string}`);

const monadTestnet = {
  id: Number(process.env.MONAD_CHAIN_ID),
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC_URL!] } },
} as const;

export const walletClient = createWalletClient({
  account,
  chain: monadTestnet,
  transport: http(monadTestnet.rpcUrls.default.http[0])
});

export async function submitPlayerDelta(args: { player: `0x${string}`; scoreDelta: bigint; txDelta: bigint }) {
  return walletClient.writeContract({
    address: process.env.MONAD_GAMES_ID_ADDRESS as `0x${string}`,
    abi: ABI as unknown as Abi,
    functionName: "updatePlayerData",
    args: [args.player, args.scoreDelta, args.txDelta],
  });
}
