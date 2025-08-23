"use client";

export default function UsernameGate({
  onCheckAgain,
}: {
  onCheckAgain: () => void;
}) {
  return (
    <div className="w-full max-w-xl rounded-3xl bg-[#1e0b3a] text-zinc-50 p-8 shadow-2xl border border-white/10">
      <div className="flex flex-col items-center gap-4">
        <div className="text-2xl font-bold">Monad Username Required</div>
        <p className="text-center opacity-90">
          You need to register your Monad username to play this game.
        </p>

        <a
          href="https://monad-games-id-site.vercel.app/"
          target="_blank"
          className="mt-2 px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 transition font-semibold"
        >
          Register Username
        </a>

        <button
          onClick={onCheckAgain}
          className="mt-4 w-full px-6 py-3 rounded-xl bg-indigo-600/40 hover:bg-indigo-600/60 border border-indigo-400/30"
        >
          ⟳ Check Again
        </button>
      </div>
    </div>
  );
}
