"use client";

export function UsernameBadge({
  wallet,
  username,
  loading,
}: {
  wallet?: string | null;
  username?: string | null;
  loading?: boolean;
}) {
  if (!wallet) return null;

  const short = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

  return (
    <div className="text-sm flex items-center gap-2">
      <span className="opacity-70">Wallet: {short}</span>
      {loading ? (
        <span className="opacity-60">· buscando username…</span>
      ) : username ? (
        <span className="px-2 py-0.5 rounded-full bg-emerald-700/30 border border-emerald-700/40">
          @{username}
        </span>
      ) : (
        <a
          className="underline opacity-80"
          href="https://monad-games-id-site.vercel.app/"
          target="_blank"
        >
          · reservar username
        </a>
      )}
    </div>
  );
}
