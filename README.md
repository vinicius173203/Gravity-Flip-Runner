# Gravity Flip Runner — Mission 7 (Monad Games ID)

Jogo web simples (Next.js + TS + Canvas) integrado ao **Monad Games ID** via **Privy** e submissão onchain de **deltas** (score/tx) usando **viem**.

## Rodando local

```bash
npm i
cp .env.example .env.local
# preencha NEXT_PUBLIC_PRIVY_APP_ID, MONAD_RPC_URL, MONAD_CHAIN_ID, ADMIN_PRIVATE_KEY
npm run dev
```
Abra http://localhost:3000

## Integração Monad Games ID

- Login: "Sign in with Monad Games ID" (Privy)
- Cross App ID (para encontrar a conta cross_app): `cmd8euall0037le0my79qpz42`
- Username check: `https://monad-games-id-site.vercel.app/api/check-wallet?wallet={wallet}`
- Contrato: `MONAD_GAMES_ID_ADDRESS` no `.env.local` (testnet)

> **Importante:** faça a chamada onchain **no servidor** (nunca no cliente) e envie **deltas** (_incrementos_) — não o total acumulado.

## Registrar o jogo
Use o `registerGame` no contrato (explorer) com `_game` = endereço da sua `ADMIN_PRIVATE_KEY`.

## Estrutura
- `app/` (App Router, páginas e API Routes)
- `src/game/engine.ts` (engine simples com flip de gravidade)
- `src/components/GameCanvas.tsx` (canvas + input)
- `src/hooks/useMonadGamesWallet.ts` (wallet do Cross App)
- `src/server/onchain.ts` (viem writeContract)
- `contracts/monad-games-id.abi.json` (adicione a ABI do explorer)

## Licença
MIT
