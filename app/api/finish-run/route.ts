import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, http, publicActions, defineChain } from 'viem'; // Adicione defineChain
import { privateKeyToAccount } from 'viem/accounts';

// Defina a chain custom para Monad Testnet (não existe pré-definida no viem)
const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] }, // RPC correto
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
});

const CONTRACT_ADDRESS = '0xceCBFF203C8B6044F52CE23D914A1bfD997541A4' as const;

// ABI completo do contrato (copie do explorer: https://testnet.monadexplorer.com/address/0xceCBFF203C8B6044F52CE23D914A1bfD997541A4?tab=Contract)
// Abaixo, um exemplo mínimo; substitua pelo ABI full para evitar erros
const ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "_game", "type": "address" },
      { "internalType": "string", "name": "_name", "type": "string" },
      { "internalType": "string", "name": "_image", "type": "string" },
      { "internalType": "string", "name": "_url", "type": "string" }
    ],
    "name": "registerGame",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "player", "type": "address" },
      { "internalType": "uint256", "name": "scoreAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "transactionAmount", "type": "uint256" }
    ],
    "name": "updatePlayerData",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // Adicione o resto do ABI aqui (funções como getGame, getPlayerData, etc.)
] as const;

// Private key da wallet registrada como _game (guarde em .env.local e Vercel env vars)
const GAME_PRIVATE_KEY = process.env.GAME_PRIVATE_KEY as `0x${string}`;

export async function POST(req: NextRequest) {
  try {
    const { sessionId, scoreDelta, txDelta, wallet } = await req.json();

    // Validações (adicione mais se necessário, ex: validar wallet como endereço válido)
    if (!wallet || scoreDelta == null || txDelta == null || !GAME_PRIVATE_KEY) {
      return NextResponse.json({ error: 'Dados inválidos ou configuração ausente' }, { status: 400 });
    }

    const account = privateKeyToAccount(GAME_PRIVATE_KEY);
    const client = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(),
    }).extend(publicActions);

    const { request } = await client.simulateContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: 'updatePlayerData',
      args: [wallet, BigInt(scoreDelta), BigInt(txDelta)],
    });

    const txHash = await client.writeContract(request);

    return NextResponse.json({ ok: true, txHash });
  } catch (error) {
    console.error('Erro ao submeter:', error);
    return NextResponse.json({ error: 'Falha ao submeter on-chain: ' + (error as Error).message }, { status: 500 });
  }
}