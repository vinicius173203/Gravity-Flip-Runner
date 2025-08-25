"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/** ====== CONFIG ====== */

/** Velocidade (ajuste ao gosto) */
const SPEED_START = 225; // px/s inicial
const SPEED_ADD = 25; // +px/s por obstáculo DESVIADO
const SPEED_MAX = 5000;

/** Canvas base (o canvas renderiza nesses "px lógicos" e é escalado via CSS) */
const WIDTH = 800;
const HEIGHT = 360;

/** Layout das pistas (margem do teto/solo) */
const CEILING_Y = 40;
const GROUND_Y = HEIGHT - 40;

/** Player (tamanho base; o real é BASE * playerScale) */
const PLAYER_BASE = 32;

/** Obstáculos (hidrantes) */
const HYDRANT_W = 28;
const HYDRANT_H = 36;

/** Spawn / espaçamento dos obstáculos */
const SPAWN_MIN = 500; // px
const SPAWN_MAX = 800; // px

/** Assets (ajuste as extensões conforme seus arquivos) */
const PLAYER_SRC = "/images/player.png"; // troque se for .jpg
const HYDRANT_GREEN_SRC = "/images/h1.png";
const HYDRANT_RED_SRC = "/images/h2.png";
const HYDRANT_BLUE_SRC = "/images/h3.png";

/** Backgrounds em sequência (ordem = progressão) */
const BG_SRCS = [
  "/images/bg1.png",
  "/images/bg2.png",
  "/images/bg3.png",
  "/images/bg4.jpeg",
  "/images/bg5.png",
  "/images/bg6.png",
  "/images/bg7.png",
  "/images/bg8.png",
  "/images/bg9.png",
  "/images/bg10.jpeg",
];

/** Troca de tema a cada N pontos desviados */
const THEME_INTERVAL = 8;

/** Crossfade (segundos) ao trocar de tema */
const BG_FADE_SECS = 0.8;

/** Parallax (0 = estático, 0.35 = leve rolagem) */
const BG_SPEED_FACTOR = 0.35;

/** Músicas + regras de troca por score (pode apontar tudo p/ mesma faixa se quiser) */
const MUSIC = {
  exploration: "/audio/1.mp3",
  battle: "/audio/2.mp3",
  boss: "/audio/3.mp3",
} as const;

const MUSIC_EXPLORATION_MAX = 20; // score <= 20 → exploração
const MUSIC_BATTLE_MAX = 40; // 21..49 → batalha
// >= 50 → boss

const MUSIC_FADE_SECS = 0.8; // fade entre faixas
const MUSIC_DEFAULT_VOL = 0.6;

/** ====== TIPOS ====== */
type Lane = "top" | "bottom";
type HydrantColor = "green" | "red" | "blue";
type MusicKind = keyof typeof MUSIC;

type Obstacle = {
  x: number;
  lane: Lane;
  passed: boolean;
  color: HydrantColor;
};

type GameCanvasProps = {
  onGameOver: (score: number) => void;
  playerScale?: number;
  onStatsChange?: (s: { score: number; speed: number }) => void;
};

export default function GameCanvas({
  onGameOver,
  playerScale = 1.6,
  onStatsChange,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // HUD (apenas flags/estado; não renderizamos overlays)
  const [gameOver, setGameOver] = useState(false);

  // ===== estado do jogo em refs =====
  const scoreRef = useRef(0);
  const speedRef = useRef(SPEED_START);
  const laneRef = useRef<Lane>("bottom");
  const obstaclesRef = useRef<Obstacle[]>([]);
  const nextSpawnDistRef = useRef(rand(SPAWN_MIN, SPAWN_MAX));
  const lastTsRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const notifiedRef = useRef(false);

  // ===== assets (imagens) =====
  const bgImgsRef = useRef<HTMLImageElement[] | null>(null); // vários BGs
  const playerImgRef = useRef<HTMLImageElement | null>(null);
  const hydrantGreenRef = useRef<HTMLImageElement | null>(null);
  const hydrantRedRef = useRef<HTMLImageElement | null>(null);
  const hydrantBlueRef = useRef<HTMLImageElement | null>(null);
  const [assetsReady, setAssetsReady] = useState(false);

  // parallax + tema
  const bgOffRef = useRef(0);
  const bgIdxRef = useRef(0); // tema atual
  const bgPrevIdxRef = useRef(0); // tema anterior (p/ fade)
  const bgFadeTRef = useRef(1); // 0..1 (1=sem transição)

  // ===== áudio =====
  const explorationMusicRef = useRef<HTMLAudioElement | null>(null);
  const battleMusicRef = useRef<HTMLAudioElement | null>(null);
  const bossMusicRef = useRef<HTMLAudioElement | null>(null);
  const currentMusicRef = useRef<MusicKind | null>(null);
  const audioUnlockedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ==== medidas do player derivadas da escala ====
  const PLAYER_W = Math.round(PLAYER_BASE * playerScale);
  const PLAYER_H = Math.round(PLAYER_BASE * playerScale);
  const PLAYER_X = 120; // pode virar derivado tb se quiser

  const resetStateRefs = () => {
    scoreRef.current = 0;
    speedRef.current = SPEED_START;
    laneRef.current = "bottom";
    obstaclesRef.current = [];
    nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
    lastTsRef.current = null;
    stoppedRef.current = false;
    notifiedRef.current = false;

    // fundo/tema
    bgOffRef.current = 0;
    bgIdxRef.current = 0;
    bgPrevIdxRef.current = 0;
    bgFadeTRef.current = 1;

    setGameOver(false);
    if (typeof onStatsChange === "function") {
      onStatsChange({ score: 0, speed: SPEED_START });
    }
  };

  // input: flip de pista
  const flipLane = useCallback(() => {
    if (stoppedRef.current) return;
    laneRef.current = laneRef.current === "bottom" ? "top" : "bottom";
  }, []);

  /** ===== carregar imagens ===== */
  useEffect(() => {
    let disposed = false;
    const toLoad: HTMLImageElement[] = [];

    function make(src: string) {
      const img = new Image();
      img.src = src;
      toLoad.push(img);
      return img;
    }

    // BGs múltiplos
    const bgImgs = BG_SRCS.map(make);
    bgImgsRef.current = bgImgs;

    // Demais assets
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

  /** ===== carregar áudio ===== */
  useEffect(() => {
    // WebAudio para aumentar as chances de autoplay em mobile
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext | null = Ctx ? new Ctx() : null;
    if (ctx) audioCtxRef.current = ctx;

    explorationMusicRef.current = new Audio(MUSIC.exploration);
    battleMusicRef.current = new Audio(MUSIC.battle);
    bossMusicRef.current = new Audio(MUSIC.boss);

    [explorationMusicRef.current, battleMusicRef.current, bossMusicRef.current].forEach((a) => {
      if (!a) return;
      a.loop = true;
      a.volume = 0; // começa mudo (vamos fazer fade-in)
      // Conecta ao WebAudio (melhora compatibilidade iOS)
      try {
        if (ctx) {
          const source = (ctx as any).createMediaElementSource(a);
          source.connect(ctx.destination);
        }
      } catch {}
    });

    // Tenta iniciar o áudio assim que o game começar (desktop costuma permitir)
    const tryAutoStart = async () => {
      try {
        if (ctx && ctx.state === "suspended") await ctx.resume();
        audioUnlockedRef.current = true;
        crossfadeTo("exploration");
      } catch {
        // se falhar, aguardamos interação do usuário
      }
    };

    // Autotentativa no mount
    tryAutoStart();

    // Desbloqueia áudio na 1ª interação do usuário
    const unlockAudio = async () => {
      try {
        if (ctx && ctx.state === "suspended") await ctx.resume();
      } catch {}
      audioUnlockedRef.current = true;
      crossfadeTo("exploration");
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      [explorationMusicRef.current, battleMusicRef.current, bossMusicRef.current].forEach((a) => a?.pause());
      try {
        ctx?.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // util: fade
  function fadeAudio(el: HTMLAudioElement, to: number, secs: number) {
    const from = el.volume;
    const start = performance.now();
    const dur = secs * 1000;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      el.volume = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(step);
      else el.volume = to;
    };
    requestAnimationFrame(step);
  }

  // toca só a faixa escolhida (com crossfade)
  function crossfadeTo(kind: MusicKind) {
    if (!audioUnlockedRef.current) return;

    const map: Record<MusicKind, HTMLAudioElement | null> = {
      exploration: explorationMusicRef.current,
      battle: battleMusicRef.current,
      boss: bossMusicRef.current,
    };

    const target = map[kind];
    if (!target) return;

    // fade out das outras
    (Object.keys(map) as MusicKind[]).forEach((k) => {
      const el = map[k];
      if (!el) return;
      if (k === kind) return;
      if (!el.paused) fadeAudio(el, 0, MUSIC_FADE_SECS);
      // pausa após o fade (pequeno timeout)
      setTimeout(() => el.pause(), MUSIC_FADE_SECS * 1000 + 50);
    });

    // tocar alvo com fade in
    if (target.paused) {
      target.currentTime = 0;
      target.play().catch(() => {});
    }
    fadeAudio(target, MUSIC_DEFAULT_VOL, MUSIC_FADE_SECS);
    currentMusicRef.current = kind;
  }

  // escolhe música pelo score
  function evaluateMusicByScore(score: number) {
    let desired: MusicKind = "exploration";
    if (score > MUSIC_EXPLORATION_MAX && score <= MUSIC_BATTLE_MAX) {
      desired = "battle";
    } else if (score > MUSIC_BATTLE_MAX) {
      desired = "boss";
    }
    if (desired !== currentMusicRef.current) crossfadeTo(desired);
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsReady]);

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
      const TOP_LINE_Y = CEILING_Y + PLAYER_H;
      const playerY = laneRef.current === "bottom" ? GROUND_Y - PLAYER_H : TOP_LINE_Y;
      const sameLane =
        (o.lane === "bottom" && playerY === GROUND_Y - PLAYER_H) ||
        (o.lane === "top" && playerY === TOP_LINE_Y);
      const overlapX = o.x < PLAYER_X + PLAYER_W && o.x + HYDRANT_W > PLAYER_X;

      if (sameLane && overlapX) {
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          setGameOver(true);
          // pausa música suavemente
          ["exploration", "battle", "boss"].forEach((k) => {
            const el =
              k === "exploration"
                ? explorationMusicRef.current
                : k === "battle"
                ? battleMusicRef.current
                : bossMusicRef.current;
            if (el && !el.paused) fadeAudio(el, 0, MUSIC_FADE_SECS);
            setTimeout(() => el?.pause(), MUSIC_FADE_SECS * 1000 + 50);
          });
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
          evaluateMusicByScore(scoreRef.current); // ← troca de música conforme score
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

    /** ===== PROGRESSÃO DE TEMA + CROSSFADE ===== */
    const totalBgs = bgImgsRef.current?.length ?? 1;
    const desiredIdx = Math.floor(scoreRef.current / THEME_INTERVAL);
    // ciclo infinito
    const targetIdx = totalBgs > 0 ? desiredIdx % totalBgs : 0;

    // Se o tema mudou, inicia a transição
    if (targetIdx !== bgIdxRef.current) {
      bgPrevIdxRef.current = bgIdxRef.current;
      bgIdxRef.current = targetIdx;
      bgFadeTRef.current = 0; // começa o fade
    }

    // Avança o crossfade (0..1)
    if (bgFadeTRef.current < 1) {
      bgFadeTRef.current = Math.min(1, bgFadeTRef.current + dt / BG_FADE_SECS);
    }

    // Atualiza o overlay/telemetria externa a cada frame
    if (typeof onStatsChange === "function") {
      onStatsChange({
        score: scoreRef.current,
        speed: speedRef.current,
      });
    }
  };

  // render
  const draw = (ctx: CanvasRenderingContext2D) => {
    drawBackground(ctx);

    // linhas guia (sutileza)
    const TOP_LINE_Y = CEILING_Y + PLAYER_H;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    line(ctx, 0, TOP_LINE_Y, WIDTH, TOP_LINE_Y);
    line(ctx, 0, GROUND_Y, WIDTH, GROUND_Y);

    // player (vira ao ir para o topo)
    const isTop = laneRef.current === "top";
    const player_base_y = isTop ? TOP_LINE_Y : GROUND_Y;
    const player_draw_y = isTop ? player_base_y : player_base_y - PLAYER_H;
    drawFlippable(
      ctx,
      playerImgRef.current,
      PLAYER_X,
      player_draw_y,
      PLAYER_W,
      PLAYER_H,
      isTop,
      "#ffd166"
    );

    // hidrantes (agora com flip e ajuste de y na pista superior)
    for (const o of obstaclesRef.current) {
      const isOTop = o.lane === "top";
      const o_base_y = isOTop ? TOP_LINE_Y : GROUND_Y;
      const o_draw_y = isOTop ? o_base_y : o_base_y - HYDRANT_H;
      const flip = isOTop;
      const img =
        o.color === "green"
          ? hydrantGreenRef.current
          : o.color === "red"
          ? hydrantRedRef.current
          : hydrantBlueRef.current;
      const fallback =
        o.color === "green" ? "#00d084" : o.color === "red" ? "#ef476f" : "#3b82f6";
      drawFlippable(ctx, img, o.x, o_draw_y, HYDRANT_W, HYDRANT_H, flip, fallback);
    }

    // HUD (debug/telemetria básica)
    ctx.fillStyle = "black";
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas";
    ctx.fillText(`Score: ${scoreRef.current}`, 16, 24);
    ctx.fillText(`Vel: ${Math.round(speedRef.current)} px/s`, 16, 42);
  };

  // fundo com crossfade e tile horizontal (parallax)
  const drawBackground = (ctx: CanvasRenderingContext2D) => {
    const bgs = bgImgsRef.current;
    if (!bgs || bgs.length === 0) {
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      return;
    }

    const idxA = bgPrevIdxRef.current;
    const idxB = bgIdxRef.current;
    const imgA = bgs[idxA];
    const imgB = bgs[idxB];
    const t = bgFadeTRef.current; // 0..1

    // função auxiliar cover + repeat-x
    const drawCover = (img: HTMLImageElement, alpha: number, offsetX = 0) => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;

      const canvasRatio = WIDTH / HEIGHT;
      const imgRatio = iw / ih;
      let drawW: number, drawH: number, dx = 0, dy = 0;

      if (imgRatio > canvasRatio) {
        const scale = HEIGHT / ih;
        drawW = iw * scale;
        drawH = HEIGHT;
        dx = -(drawW - WIDTH) / 2;
      } else {
        const scale = WIDTH / iw;
        drawW = WIDTH;
        drawH = ih * scale;
        dy = -(drawH - HEIGHT) / 2;
      }

      // leve parallax horizontal
      dx -= (bgOffRef.current * BG_SPEED_FACTOR) % drawW;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0, iw, ih, dx + offsetX, dy, drawW, drawH);

      // repetir em x para cobrir gaps
      if (dx > 0) {
        ctx.drawImage(img, 0, 0, iw, ih, dx - drawW + offsetX, dy, drawW, drawH);
      } else if (dx + drawW < WIDTH) {
        ctx.drawImage(img, 0, 0, iw, ih, dx + drawW + offsetX, dy, drawW, drawH);
      }
      ctx.restore();
    };

    // fundo base (A) + crossfade para (B)
    if (imgA && imgA.complete && t < 1) drawCover(imgA, 1 - t);
    if (imgB && imgB.complete) drawCover(imgB, t);
    else {
      // fallback
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  };

  // inputs globais
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

  /** ======== FULLSCREEN + LANDSCAPE ======== */
  const enterFullscreenAndLandscape = async () => {
    const cont = containerRef.current as any;
    if (!cont) return;
    try {
      if (cont.requestFullscreen) await cont.requestFullscreen();
      else if (cont.webkitRequestFullscreen) await cont.webkitRequestFullscreen();
    } catch {}

    // Tenta travar em paisagem (não funciona em todos os navegadores)
    try {
      if ((screen as any).orientation && (screen.orientation as any).lock) {
        await (screen.orientation as any).lock("landscape");
      }
    } catch {
      // iOS Safari geralmente não permite; seguimos sem travar
    }
  };

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {}
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-4xl mx-auto"
      style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className={`w-full h-auto rounded-2xl border border-white/10 ${gameOver ? "opacity-90" : "opacity-100"}`}
        style={{ background: "rgba(0,0,0,0.5)" }}
      />

      {/* Toolbar (top-right) */}
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <button
          onClick={enterFullscreenAndLandscape}
          className="px-3 py-2 rounded-xl bg-black/50 text-white text-sm backdrop-blur border border-white/10 hover:bg-black/70"
          title="Tela cheia"
        >
          ⛶ Tela cheia
        </button>
        <button
          onClick={() => {
            // Força tocar áudio caso ainda não tenha liberado
            if (!audioUnlockedRef.current) {
              try {
                audioCtxRef.current?.resume();
              } catch {}
              audioUnlockedRef.current = true;
              crossfadeTo("exploration");
            }
          }}
          className="px-3 py-2 rounded-xl bg-black/50 text-white text-sm backdrop-blur border border-white/10 hover:bg-black/70"
          title="Ativar som"
        >
          🔊 Som
        </button>
        <button
          onClick={exitFullscreen}
          className="px-3 py-2 rounded-xl bg-black/50 text-white text-sm backdrop-blur border border-white/10 hover:bg-black/70"
          title="Sair da tela cheia"
        >
          ↩︎ Sair
        </button>
      </div>
    </div>
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

/** Desenha imagem ou retângulo fallback, com opção de flip vertical (para pista superior) */
function drawFlippable(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  flipVertical: boolean,
  fallbackColor?: string
) {
  ctx.save();

  if (flipVertical) {
    ctx.translate(x, y + h);
    ctx.scale(1, -1);
  } else {
    ctx.translate(x, y);
  }

  if (img && img.complete) {
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, w, h);
  } else if (fallbackColor) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
}

function spawnObstacle(): Obstacle {
  const color = (['green', 'red', 'blue'] as HydrantColor[])[rand(0, 2)];
  const lane: Lane = Math.random() < 0.5 ? 'top' : 'bottom';
  return {
    x: WIDTH + rand(0, 80),
    lane,
    passed: false,
    color,
  };
}
