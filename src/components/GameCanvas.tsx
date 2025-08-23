"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/** ====== CONFIG ====== */

/** Velocidade (ajuste ao gosto) */
const SPEED_START = 220; // px/s inicial
const SPEED_ADD = 50;    // +px/s por obstáculo DESVIADO
const SPEED_MAX = 5000;

/** Canvas base (o canvas renderiza nesses "px lógicos" e é escalado via CSS) */
const WIDTH = 800;
const HEIGHT = 360;

/** Layout das pistas (margem do teto/solo) */
const CEILING_Y = 40;
const GROUND_Y = HEIGHT - 40;

/** Player */
const PLAYER_X = 120;
const PLAYER_W = 32;   // ajuste para encaixar melhor sua imagem
const PLAYER_H = 32;

/** Obstáculos (hidrantes) */
const HYDRANT_W = 28;
const HYDRANT_H = 36;

/** Spawn / espaçamento dos obstáculos */
const SPAWN_MIN = 500; // px
const SPAWN_MAX = 800; // px

/** Assets */
const BG_SRC = "/images/bg.jpg";
const PLAYER_SRC = "/images/player.jpg";
const HYDRANT_GREEN_SRC = "/images/h1.jpg";
const HYDRANT_RED_SRC   = "/images/h2.jpg";
const HYDRANT_BLUE_SRC  = "/images/h3.jpg";

/** Fundo único com leve parallax (0 = estático, 0.35 = leve rolagem) */
const BG_SPEED_FACTOR = 0.35;

/** ====== TIPOS ====== */
type Lane = "top" | "bottom";
type HydrantColor = "green" | "red" | "blue";

type Obstacle = {
  x: number;
  lane: Lane;
  passed: boolean;
  color: HydrantColor;
};

export default function GameCanvas({
  onGameOver,
}: {
  onGameOver: (score: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // HUD
  const [gameOver, setGameOver] = useState(false);

  // ===== estado do jogo em refs (não travam no closure) =====
  const scoreRef = useRef(0);
  const speedRef = useRef(SPEED_START);
  const laneRef = useRef<Lane>("bottom");
  const obstaclesRef = useRef<Obstacle[]>([]);
  const nextSpawnDistRef = useRef(rand(SPAWN_MIN, SPAWN_MAX));
  const lastTsRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const notifiedRef = useRef(false);

  // ===== assets (imagens) =====
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const playerImgRef = useRef<HTMLImageElement | null>(null);
  const hydrantGreenRef = useRef<HTMLImageElement | null>(null);
  const hydrantRedRef = useRef<HTMLImageElement | null>(null);
  const hydrantBlueRef = useRef<HTMLImageElement | null>(null);
  const [assetsReady, setAssetsReady] = useState(false);

  // parallax
  const bgOffRef = useRef(0);

  const resetStateRefs = () => {
    scoreRef.current = 0;
    speedRef.current = SPEED_START;
    laneRef.current = "bottom";
    obstaclesRef.current = [];
    nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
    lastTsRef.current = null;
    stoppedRef.current = false;
    notifiedRef.current = false;
    bgOffRef.current = 0;
    setGameOver(false);
  };

  // input: flip de pista
  const flipLane = useCallback(() => {
    if (stoppedRef.current) return;
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

  // carregar imagens
  useEffect(() => {
    let disposed = false;
    const toLoad: HTMLImageElement[] = [];

    function make(src: string) {
      const img = new Image();
      img.src = src;
      toLoad.push(img);
      return img;
    }

    bgImgRef.current = make(BG_SRC);
    playerImgRef.current = make(PLAYER_SRC);
    hydrantGreenRef.current = make(HYDRANT_GREEN_SRC);
    hydrantRedRef.current = make(HYDRANT_RED_SRC);
    hydrantBlueRef.current = make(HYDRANT_BLUE_SRC);

    let loaded = 0;
    const done = () => {
      loaded += 1;
      if (!disposed && loaded === toLoad.length) setAssetsReady(true);
    };
    toLoad.forEach((img) => {
      if (img.complete) done();
      else {
        img.addEventListener("load", done);
        img.addEventListener("error", done); // não travar se falhar
      }
    });

    return () => {
      disposed = true;
      toLoad.forEach((img) => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
      });
    };
  }, []);

  // loop principal
  useEffect(() => {
    resetStateRefs();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    let mounted = true;

    const frame = (ts: number) => {
      if (!mounted) return;
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(0.04, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (!stoppedRef.current) {
        step(dt);
        draw(ctx);
        rafRef.current = requestAnimationFrame(frame);
      } else {
        draw(ctx);
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // lógica por frame
  const step = (dt: number) => {
    const dx = speedRef.current * dt;

    // parallax
    bgOffRef.current += dx * BG_SPEED_FACTOR;

    // obstáculos
    const obs = obstaclesRef.current;
    for (const o of obs) {
      o.x -= dx;

      // colisão (caixa simples)
      const playerY = laneRef.current === "bottom" ? GROUND_Y - PLAYER_H : CEILING_Y;
      const sameLane =
        (o.lane === "bottom" && playerY === GROUND_Y - PLAYER_H) ||
        (o.lane === "top" && playerY === CEILING_Y);
      const overlapX = o.x < PLAYER_X + PLAYER_W && o.x + HYDRANT_W > PLAYER_X;

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

      // pontua só se DESVIOU (pista oposta) quando o obstáculo passou
      if (!o.passed && o.x + HYDRANT_W < PLAYER_X) {
        o.passed = true;
        const dodged = laneRef.current !== o.lane;
        if (dodged) {
          scoreRef.current += 1;
          speedRef.current = Math.min(SPEED_MAX, speedRef.current + SPEED_ADD);
        }
      }
    }

    // remove fora da tela
    while (obs.length && obs[0].x + HYDRANT_W < -100) obs.shift();

    // spawn por distância
    nextSpawnDistRef.current -= dx;
    if (nextSpawnDistRef.current <= 0) {
      obstaclesRef.current.push(spawnObstacle());
      nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
    }
  };

  // render
  const draw = (ctx: CanvasRenderingContext2D) => {
    drawBackground(ctx);

    // linhas guia (sutileza)
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    line(ctx, 0, CEILING_Y + PLAYER_H, WIDTH, CEILING_Y + PLAYER_H);
    line(ctx, 0, GROUND_Y, WIDTH, GROUND_Y);

    // player (vira ao ir para o topo)
    const playerY = laneRef.current === "bottom" ? GROUND_Y - PLAYER_H : CEILING_Y;
    drawPlayerFlippable(ctx,playerImgRef.current, PLAYER_X, playerY, PLAYER_W, PLAYER_H, laneRef.current === "top");

    // hidrantes
    for (const o of obstaclesRef.current) {
      const y = o.lane === "bottom" ? GROUND_Y - HYDRANT_H : CEILING_Y;
      const img =
        o.color === "green"
          ? hydrantGreenRef.current
          : o.color === "red"
          ? hydrantRedRef.current
          : hydrantBlueRef.current;
      const fallback =
        o.color === "green" ? "#00d084" : o.color === "red" ? "#ef476f" : "#3b82f6";
      drawImageOrRect(ctx, img, o.x, y, HYDRANT_W, HYDRANT_H, fallback);
    }

    // HUD
    ctx.fillStyle = "black";
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas";
    ctx.fillText(`Score: ${scoreRef.current}`, 16, 24);
    ctx.fillText(`Vel: ${Math.round(speedRef.current)} km/s`, 16, 42);

  };

  // fundo com uma imagem (repetindo horizontalmente)
  const drawBackground = (ctx: CanvasRenderingContext2D) => {
  const img = bgImgRef.current;
  if (!img || !img.complete) {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  // cover: preenche o canvas inteiro mantendo proporção
  const canvasRatio = WIDTH / HEIGHT;
  const imgRatio = iw / ih;

  let drawW: number, drawH: number, dx = 0, dy = 0;

  if (imgRatio > canvasRatio) {
    // imagem mais “larga” -> escala pela altura
    const scale = HEIGHT / ih;
    drawW = iw * scale;
    drawH = HEIGHT;
    dx = - (drawW - WIDTH) / 2;
  } else {
    // imagem mais “alta” -> escala pela largura
    const scale = WIDTH / iw;
    drawW = WIDTH;
    drawH = ih * scale;
    dy = - (drawH - HEIGHT) / 2;
  }

  // Se quiser parallax bem leve, pode deslocar dx usando bgOffRef:
  // dx -= (bgOffRef.current % drawW) * 0.05;  // 0.05 = fator bem pequeno
  // Ou deixe estático (sem parallax):
  ctx.drawImage(img, 0, 0, iw, ih, dx, dy, drawW, drawH);
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

/** ===== utils & desenho ===== */
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function drawImageOrRect(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  fallbackColor: string
) {
  if (img && img.complete) {
    ctx.drawImage(img, 0, 0, img.width, img.height, x, y, w, h);
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(x, y, w, h);
  }
}

/** Desenha o player, com opção de "virar" verticalmente no topo */
function drawPlayerFlippable(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null, // 👈 receba a imagem
  x: number,
  y: number,
  w: number,
  h: number,
  flipVertical: boolean
) {
  if (!img || !img.complete) {
    // fallback
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(x, y, w, h);
    return;
  }

  if (!flipVertical) {
    ctx.drawImage(img, 0, 0, img.width, img.height, x, y, w, h);
  } else {
    ctx.save();
    // espelha verticalmente em torno do retângulo do player
    ctx.translate(0, y * 2 + h);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, img.width, img.height, x, y, w, h);
    ctx.restore();
  }
}


function spawnObstacle(): Obstacle {
  const color = (["green", "red", "blue"] as HydrantColor[])[rand(0, 2)];
  const lane: Lane = Math.random() < 0.5 ? "top" : "bottom";
  return {
    x: WIDTH + rand(0, 80),
    lane,
    passed: false,
    color,
  };
}
