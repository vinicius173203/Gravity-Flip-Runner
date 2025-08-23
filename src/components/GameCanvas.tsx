"use client";
import { useEffect, useRef, useState } from "react";
import { Engine } from "@/game/engine";

export default function GameCanvas({ onGameOver }: { onGameOver: (s:number)=>void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const resize = () => { canvas.width = Math.min(720, window.innerWidth - 32); canvas.height = 300; };
    resize();
    const ctx = canvas.getContext("2d")!;
    const e = new Engine(ctx, canvas.width, canvas.height, { onGameOver });
    setEngine(e);
    e.start();
    window.addEventListener("resize", resize);
    const key = (ev: KeyboardEvent) => { if (ev.code === "Space" || ev.code === "ArrowUp") { ev.preventDefault(); e.triggerFlip(); } };
    window.addEventListener("keydown", key);
    const tap = () => e.triggerFlip();
    canvas.addEventListener("pointerdown", tap);
    return () => {
      e.stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
      canvas.removeEventListener("pointerdown", tap);
    };
  }, [onGameOver]);

  return <canvas ref={ref} className="rounded-2xl shadow-xl border border-zinc-800" />;
}
