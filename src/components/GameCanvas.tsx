"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/** Config de velocidade */
const SPEED_START = 220;   // px/s inicial
const SPEED_ADD   = 50;    // +px/s por obstáculo ultrapassado
const SPEED_MAX   = 5000;   // clamp de velocidade máxima

/** Canvas / jogo */
const WIDTH = 800;
const HEIGHT = 360;
const GROUND_Y = HEIGHT - 40;
const CEILING_Y = 40;
const PLAYER_X = 120;
const PLAYER_SIZE = 22;

type Obstacle = {
  x: number;
  width: number;
  lane: "top" | "bottom";
  passed: boolean;
};

const SPAWN_MIN = 500;   // dist mínima entre obstáculos (px)
const SPAWN_MAX = 800;  // dist máxima entre obstáculos (px)

export default function GameCanvas({
  onGameOver,
}: {
  onGameOver: (score: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // estado só pra HUD/borda
  const [gameOver, setGameOver] = useState(false);

  // ======= ESTADO DO JOGO (em refs, não travam no closure) =======
  const scoreRef = useRef(0);                               // ✅ placar vivo
  const speedRef = useRef(SPEED_START);                     // ✅ velocidade viva
  const laneRef = useRef<"top" | "bottom">("bottom");
  const obstaclesRef = useRef<Obstacle[]>([]);
  const nextSpawnDistRef = useRef(rand(SPAWN_MIN, SPAWN_MAX));
  const lastTsRef = useRef<number | null>(null);

  const stoppedRef = useRef(false);    // ✅ pausa real do loop
  const notifiedRef = useRef(false);   // chama onGameOver apenas 1x

  // ===============================================================

  const resetStateRefs = () => {
    scoreRef.current = 0;
    speedRef.current = SPEED_START;
    laneRef.current = "bottom";
    obstaclesRef.current = [];
    nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
    lastTsRef.current = null;
    stoppedRef.current = false;
    notifiedRef.current = false;
    setGameOver(false);
  };

  // Input: flip de pista
  const flipLane = useCallback(() => {
    if (stoppedRef.current) return; // não aceita input parado
    laneRef.current = laneRef.current === "bottom" ? "top" : "bottom";
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        flipLane();
      }
    };
    const onClick = () => flipLane();

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
    };
  }, [flipLane]);

  // Loop principal
  useEffect(() => {
    resetStateRefs();

    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    let mounted = true;

    const frame = (ts: number) => {
      if (!mounted) return;

      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(0.04, (ts - lastTsRef.current) / 1000); // clamp dt
      lastTsRef.current = ts;

      if (!stoppedRef.current) {
        step(dt);
        draw(ctx);
        rafRef.current = requestAnimationFrame(frame);
      } else {
        draw(ctx); // cena “congelada”
      }
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // re-monta quando o pai troca a prop "key"
  }, []);

  // ---------- Lógica por frame ----------
  const step = (dt: number) => {
    const dx = speedRef.current * dt; // ✅ usa veloc. viva

    // move obsts
    const obs = obstaclesRef.current;
    for (const o of obs) {
      o.x -= dx;

      // colisão?
      const playerY =
        laneRef.current === "bottom" ? GROUND_Y - PLAYER_SIZE : CEILING_Y;
      const sameLane =
        (o.lane === "bottom" && playerY === GROUND_Y - PLAYER_SIZE) ||
        (o.lane === "top" && playerY === CEILING_Y);
      const overlapX = o.x < PLAYER_X + PLAYER_SIZE && o.x + o.width > PLAYER_X;

      if (sameLane && overlapX) {
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          setGameOver(true);
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onGameOver(scoreRef.current);
          }
        }
        return;
      }

      // ✅ passou o obstáculo? +1 ponto e aumenta a velocidade
      if (!o.passed && o.x + o.width < PLAYER_X) {
        o.passed = true;
        scoreRef.current += 1; // +1 ponto
        // aumenta a velocidade (aditivo)
        speedRef.current = Math.min(SPEED_MAX, speedRef.current + SPEED_ADD);
      }
    }

    // remove muito à esquerda
    while (obs.length && obs[0].x + obs[0].width < -100) obs.shift();

    // spawn por distância
    nextSpawnDistRef.current -= dx;
    if (nextSpawnDistRef.current <= 0) {
      obstaclesRef.current.push(spawnObstacle());
      nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
    }
  };

  // ---------- Render ----------
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // pistas
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    line(ctx, 0, CEILING_Y + PLAYER_SIZE, WIDTH, CEILING_Y + PLAYER_SIZE);
    line(ctx, 0, GROUND_Y, WIDTH, GROUND_Y);

    // player
    const playerY =
      laneRef.current === "bottom" ? GROUND_Y - PLAYER_SIZE : CEILING_Y;
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(PLAYER_X, playerY, PLAYER_SIZE, PLAYER_SIZE);

    // obstáculos
    ctx.fillStyle = "#ef476f";
    for (const o of obstaclesRef.current) {
      const y = o.lane === "bottom" ? GROUND_Y - PLAYER_SIZE : CEILING_Y;
      ctx.fillRect(o.x, y, o.width, PLAYER_SIZE);
    }

    // HUD (usa refs vivas — não fica “travado” no primeiro render)
    ctx.fillStyle = "white";
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas";
    ctx.fillText(`Score: ${scoreRef.current}`, 16, 24);
    ctx.fillText(`Vel: ${Math.round(speedRef.current)} px/s`, 16, 42);
    ctx.fillText(
      stoppedRef.current
        ? `Game Over — aguarde envio/confirmação`
        : `Flip: clique ou barra de espaço`,
      16,
      62
    );
  };

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      className={`w-full max-w-4xl rounded-2xl border border-white/10 ${
        gameOver ? "opacity-90" : "opacity-100"
      }`}
      style={{ background: "rgba(0,0,0,0.5)" }}
    />
  );
}

// helpers
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function spawnObstacle(): Obstacle {
  const width = rand(22, 32);
  const lane: "top" | "bottom" = Math.random() < 0.5 ? "top" : "bottom";
  return {
    x: WIDTH + rand(0, 80),
    width,
    lane,
    passed: false,
  };
}
