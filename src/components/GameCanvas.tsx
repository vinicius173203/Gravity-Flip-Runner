"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";

/** ====== CONFIG ====== */

/** Velocidade */
const SPEED_START = 225; // px/s inicial
const SPEED_ADD = 10;    // +px/s por obstáculo DESVIADO
const SPEED_MAX = 5000;

/** Canvas base */
const WIDTH = 800;
const HEIGHT = 360;

/** Layout das pistas */
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
const HYDRANT_GREEN_SRC = "/images/h1.png";
const HYDRANT_RED_SRC   = "/images/h2.png";
const HYDRANT_BLUE_SRC  = "/images/h3.png";

/** Personagens disponíveis para seleção */
type Character = { name: string; src: string };
const CHARACTERS: Character[] = [
  { name: "Pulse",  src: "/images/player.png"  },
  { name: "Riff",   src: "/images/player2.png" },
  { name: "Melody", src: "/images/player3.png" },
];

/** Backgrounds em sequência (ordem = progressão) */
type BgItem =
  | { type: "image"; src: string }
  | { type: "video"; src: string; loop?: boolean };

const BG_ITEMS: BgItem[] = [
  { type: "image", src: "/images/bg1.png" },
  { type: "image", src: "/images/bg2.png" },
  { type: "image", src: "/images/bg3.png" },
  { type: "image", src: "/images/bg4.png"},
  { type: "image", src: "/images/bg6.png" },
  { type: "image", src: "/images/bg7.png" },
  { type: "image", src: "/images/bg8.png" },
];

/** Troca de tema a cada N pontos desviados */
const THEME_INTERVAL = 8;

/** Crossfade (segundos) ao trocar de tema */
const BG_FADE_SECS = 0.8;

/** Parallax (0 = estático, 0.35 = leve rolagem) */
const BG_SPEED_FACTOR = 0.35;

/** Músicas + regras de troca por score */
const MUSIC = {
  exploration: "/audio/1.mp3",
  battle: "/audio/2.mp3",
  boss: "/audio/3.mp3",
} as const;

const MUSIC_EXPLORATION_MAX = 20; // score <= 20 → exploração
const MUSIC_BATTLE_MAX = 40;      // 21..49 → batalha
const MUSIC_FADE_SECS = 0.8;      // fade entre faixas
const MUSIC_DEFAULT_VOL = 0.6;

/** ====== TIPOS ====== */
type Lane = "top" | "bottom";
type HydrantColor = "green" | "red" | "blue";
type MusicKind = keyof typeof MUSIC;

/** ===== POWER-UPS / PICKUPS =====
 * Mantém apenas 'ghost' e 'clone'.
 */
type PowerUpKind = "ghost" | "clone";
const PU_DURATION: Record<PowerUpKind, number> = {
  ghost: 6,   // atravessa tudo
  clone: 8,   // duplica pontos
};

type ObstacleBehavior = "static" | "wiggle" | "fall" | "slide" | "spin";

type Obstacle = {
  kind?: undefined; // para diferenciar no union
  x: number;
  lane: Lane;
  passed: boolean;
  color: HydrantColor;
  behavior: ObstacleBehavior;
  t?: number;       // tempo local p/ animação
  fake?: boolean;   // obstáculos-surpresa que não colidem
};

type Gate = {
  kind: "gate";
  x: number;
  width: number;
  holeH: number; // altura do buraco (igual à altura do player)
  t: number;     // 0..1 posição do buraco (0=topo, 1=base) — FIXO
  passed: boolean;
};

type Pickup = {
  x: number;
  lane: Lane;
  kind: PowerUpKind;
  taken?: boolean;
};

// Probabilidades e parâmetros de spawn
const FAKE_OBS_CHANCE = 0.15;      // 15% dos obstáculos são "fakes"
const DYN_BEHAV_CHANCE = 0.55;     // 55% usam comportamento dinâmico
const PICKUP_CHANCE    = 0.25;     // 25% de chance de nascer 1 pickup após um obstáculo
const PICKUP_W = 20, PICKUP_H = 20;

// Bônus de estilo por “flip no limite”
const FLIP_WINDOW = 0.25; // s

// Anti-reflip / UX do flip
const FLIP_COOLDOWN = 0.12;           // cooldown leve
const MIN_TWEEN_TO_REFLIP = 0.75;     // precisa concluir 75% do tween para aceitar outro flip
const DUP_FLIP_GUARD_SECS = 0.18;     // guarda contra taps duplos próximos

/** Gate */
const GATE_WIDTH = 56;
const GATE_SCORE_INTERVAL = 7;     // intervalo de score para marcar o PRÓXIMO spawn como gate
const POST_GATE_SAFE_DIST = 220;   // px sem hidrantes logo após o gate

type GameCanvasProps = {
  onGameOver: (score: number) => void;
  playerScale?: number;
  onStatsChange?: (s: { score: number; speed: number }) => void;
  onRestartRequest?: () => void;
  locked?: boolean;
  onRequireLogin?: () => void;
};
export type GameCanvasHandle = {
  openCharSelect: () => void;
};

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
/** Desenha imagem crua (sem translate/flip), ou retângulo fallback */
function drawImageOrRect(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  fallbackColor?: string
) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, w, h);
  } else if (fallbackColor) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(x, y, w, h);
  }
}
/** Desenha imagem com opção de flip vertical (para pista superior) */
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
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, w, h);
  } else if (fallbackColor) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Spawns */
function spawnObstacle(): Obstacle {
  const color = (["green", "red", "blue"] as HydrantColor[])[rand(0, 2)];
  const lane: Lane = Math.random() < 0.5 ? "top" : "bottom";

  const behaviors: ObstacleBehavior[] = ["wiggle", "fall", "slide", "spin"];
  const behavior: ObstacleBehavior =
    Math.random() < DYN_BEHAV_CHANCE ? behaviors[rand(0, behaviors.length - 1)] : "static";

  const fake = Math.random() < FAKE_OBS_CHANCE;

  return {
    x: WIDTH + rand(0, 80),
    lane,
    passed: false,
    color,
    behavior,
    t: 0,
    fake,
  };
}

function spawnPickup(): Pickup | null {
  if (Math.random() > PICKUP_CHANCE) return null;
  const kinds: PowerUpKind[] = ["ghost", "clone"];
  const kind = kinds[rand(0, kinds.length - 1)];
  const lane: Lane = Math.random() < 0.5 ? "top" : "bottom";
  return {
    x: WIDTH + rand(120, 200),
    lane,
    kind,
  };
}

/** ===== COMPONENTE ===== */
function GameCanvas(
  {
    onGameOver,
    playerScale = 1.6,
    onStatsChange,
    onRestartRequest,
    locked = false,
    onRequireLogin,
  }: GameCanvasProps,
  ref: React.Ref<GameCanvasHandle>
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const fadeRafRef = useRef<Map<HTMLAudioElement, number>>(new Map());

  // HUD
  const [gameOver, setGameOver] = useState(false);

  // Estado para seleção de personagem e início do jogo
  const [gameStarted, setGameStarted] = useState(false);
  const [showCharSelect, setShowCharSelect] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [highScore, setHighScore] = useState(0);

  // ===== estado do jogo em refs =====
  const scoreRef = useRef(0);
  const speedRef = useRef(SPEED_START);
  const obstaclesRef = useRef<(Obstacle | Gate)[]>([]);
  const pickupsRef = useRef<Pickup[]>([]);
  const nextSpawnDistRef = useRef(rand(SPAWN_MIN, SPAWN_MAX));
  const lastTsRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const notifiedRef = useRef(false);

  // Gate agendamento (substitui um spawn)
  const nextGateThresholdRef = useRef(GATE_SCORE_INTERVAL); // quando bater esse score, marcar próximo spawn como gate
  const wantGateNextRef = useRef(false);                     // se true, o próximo spawn é gate (em vez de hidrante)
  const gateStartsTopRef = useRef(true);                     // alterna TOP/BOTTOM do buraco

  // Proteções pós-gate
  const postGateSafeDistRef = useRef(0);         // px sem hidrantes logo após o gate
  const nextHydrantMustBeFakeRef = useRef(false); // primeiro hidrante após gate é fake

  // ===== GRAVIDADE (manual) =====
  const gravityInvertedRef = useRef(false); // baixo=false, topo=true
  const gravityFlipCooldownRef = useRef(0);
  const playerYAnimRef = useRef(0);  // alvo 0|1
  const playerYAnimTRef = useRef(1); // progresso 0..1
  const FLIP_TWEEN_SECS = 0.22;
  const lastFlipAtRef = useRef(-999);
  const wantFlipRef = useRef(false);
  const justFlippedAtRef = useRef(0);

  // power-ups ativos (somente ghost/clone)
  const ghostUntilRef = useRef(0);
  const wasGhostRef = useRef(false);
  const cloneUntilRef = useRef(0);

  // ===== assets (BG imagens/vídeos + sprites) =====
  const bgMediaRef = useRef<(HTMLImageElement | HTMLVideoElement)[] | null>(null);
  const playerImgRef = useRef<HTMLImageElement | null>(null);
  const hydrantGreenRef = useRef<HTMLImageElement | null>(null);
  const hydrantRedRef = useRef<HTMLImageElement | null>(null);
  const hydrantBlueRef = useRef<HTMLImageElement | null>(null);
  const [assetsReady, setAssetsReady] = useState(false);

  // parallax + tema
  const bgOffRef = useRef(0);
  const bgIdxRef = useRef(0);
  const bgPrevIdxRef = useRef(0);
  const bgFadeTRef = useRef(1);

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
  const PLAYER_X = 120;

  const lockedRef = useRef(!!locked);
  useEffect(() => { lockedRef.current = !!locked; }, [locked]);

  // Carregar high score e personagem selecionado do localStorage
  useEffect(() => {
    const savedHighScore = localStorage.getItem("highScore");
    if (savedHighScore) setHighScore(parseInt(savedHighScore, 10));

    const savedChar = localStorage.getItem("selectedCharacter");
    if (savedChar) setSelectedCharacter(JSON.parse(savedChar) as Character);
    else setSelectedCharacter(CHARACTERS[0]);

    setShowCharSelect(false);
    setGameStarted(true);
  }, []);
  // ⬇️ depois dos outros useState/useEffect
const [isShortLandscape, setIsShortLandscape] = useState(false);

useEffect(() => {
  const check = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const landscape = w > h;
    setIsShortLandscape(landscape && h <= 480); // ajuste o 480 se quiser
  };
  check();
  const mq = window.matchMedia('(orientation: landscape)');
  mq.addEventListener?.('change', check);
  window.addEventListener('resize', check);
  return () => {
    mq.removeEventListener?.('change', check);
    window.removeEventListener('resize', check);
  };
}, []);


  // Salvar high score quando mudar
  useEffect(() => {
    localStorage.setItem("highScore", highScore.toString());
  }, [highScore]);

  // Salvar personagem selecionado
  useEffect(() => {
    if (selectedCharacter) {
      localStorage.setItem("selectedCharacter", JSON.stringify(selectedCharacter));
    }
  }, [selectedCharacter]);

  const resetStateRefs = () => {
    scoreRef.current = 0;
    speedRef.current = SPEED_START;
    obstaclesRef.current = [];
    pickupsRef.current = [];
    nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
    lastTsRef.current = null;
    stoppedRef.current = false;
    notifiedRef.current = false;

    // gravidade (manual)
    gravityInvertedRef.current = false;
    gravityFlipCooldownRef.current = 0;
    playerYAnimRef.current = 0;
    playerYAnimTRef.current = 1;
    lastFlipAtRef.current = -999;

    // power-ups
    ghostUntilRef.current = 0;
    cloneUntilRef.current = 0;

    // fundo/tema
    bgOffRef.current = 0;
    bgIdxRef.current = 0;
    bgPrevIdxRef.current = 0;
    bgFadeTRef.current = 1;

    // gate schedule
    nextGateThresholdRef.current = GATE_SCORE_INTERVAL;
    wantGateNextRef.current = false;
    gateStartsTopRef.current = true;

    // pós-gate
    postGateSafeDistRef.current = 0;
    nextHydrantMustBeFakeRef.current = false;

    setGameOver(false);
    onStatsChange?.({ score: 0, speed: SPEED_START });
    restartMusic();
  };

  // ===== INPUT: inverter gravidade =====
  const flipGravity = useCallback(() => {
    if (stoppedRef.current) return;
    if (lockedRef.current) return;
    wantFlipRef.current = true; // só marca pedido; quem decide é o step()
  }, []);

  /** ===== carregar BG (imagem/vídeo) e sprites ===== */
  useEffect(() => {
    if (!selectedCharacter) return;

    let disposed = false;
    const toLoad: (HTMLImageElement | HTMLVideoElement)[] = [];

    function loadImage(src: string) {
      const img = new Image();
      img.src = src;
      toLoad.push(img);
      return img;
    }
    function createVideo(src: string, loop = true) {
      const v = document.createElement("video");
      v.src = src;
      v.loop = loop;
      v.muted = true;
      (v as any).playsInline = true;
      v.preload = "auto";
      toLoad.push(v);
      return v;
    }

    // BGs
    const bgMedia = BG_ITEMS.map((item) =>
      item.type === "image" ? loadImage(item.src) : createVideo(item.src, item.loop ?? true)
    );
    bgMediaRef.current = bgMedia;

    // Sprites
    const others: HTMLImageElement[] = [];
    function make(src: string) {
      const img = new Image();
      img.src = src;
      others.push(img);
      return img;
    }
    playerImgRef.current    = make(selectedCharacter.src);
    hydrantGreenRef.current = make(HYDRANT_GREEN_SRC);
    hydrantRedRef.current   = make(HYDRANT_RED_SRC);
    hydrantBlueRef.current  = make(HYDRANT_BLUE_SRC);

    let loaded = 0;
    const done = () => {
      loaded += 1;
      if (!disposed && loaded === toLoad.length + others.length) setAssetsReady(true);
    };

    [...bgMedia, ...others].forEach((m) => {
      if (m instanceof HTMLImageElement) {
        if (m.complete) done();
        else {
          m.addEventListener("load", done);
          m.addEventListener("error", done);
        }
      } else {
        const onMeta = () => { m.removeEventListener("loadedmetadata", onMeta); done(); };
        m.addEventListener("loadedmetadata", onMeta);
        m.addEventListener("error", done);
      }
    });

    return () => {
      disposed = true;
      [...bgMedia, ...others].forEach((m) => {
        if (m instanceof HTMLImageElement) {
          m.removeEventListener("load", done);
          m.removeEventListener("error", done);
        } else {
          try { m.pause(); } catch {}
        }
      });
    };
  }, [selectedCharacter]);

  /** ===== carregar áudio ===== */
  useEffect(() => {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext | null = Ctx ? new Ctx() : null;
    if (ctx) audioCtxRef.current = ctx;

    explorationMusicRef.current = new Audio(MUSIC.exploration);
    battleMusicRef.current      = new Audio(MUSIC.battle);
    bossMusicRef.current        = new Audio(MUSIC.boss);

    [explorationMusicRef.current, battleMusicRef.current, bossMusicRef.current].forEach((a) => {
      if (!a) return;
      a.loop = true;
      a.volume = 0;
      try {
        if (ctx) {
          const source = (ctx as any).createMediaElementSource(a);
          source.connect(ctx.destination);
        }
      } catch {}
    });

    const tryAutoStart = async () => {
      try {
        if (ctx && ctx.state === "suspended") await ctx.resume();
        audioUnlockedRef.current = true;
        crossfadeTo("exploration");

        const media = bgMediaRef.current;
        if (media) {
          const cur = media[bgIdxRef.current];
          if (cur instanceof HTMLVideoElement) {
            try { cur.currentTime = 0; await cur.play(); } catch {}
          }
        }
      } catch {}
    };

    tryAutoStart();

    const unlockAudio = async () => {
      try {
        if (ctx && ctx.state === "suspended") await ctx.resume();
      } catch {}
      audioUnlockedRef.current = true;
      crossfadeTo("exploration");
      const media = bgMediaRef.current;
      if (media) {
        const cur = media[bgIdxRef.current];
        if (cur instanceof HTMLVideoElement) {
          try { cur.currentTime = 0; await cur.play(); } catch {}
        }
      }
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };

    // pointerdown/keydown apenas para destravar áudio
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      [explorationMusicRef.current, battleMusicRef.current, bossMusicRef.current].forEach((a) => a?.pause());
      try { ctx?.close(); } catch {}
      fadeRafRef.current.forEach((id) => cancelAnimationFrame(id));
      fadeRafRef.current.clear();
    };
  }, []);

  // util: fade
  function fadeAudio(el: HTMLAudioElement, to: number, secs: number) {
    to = Math.max(0, Math.min(1, to));
    let from = Math.max(0, Math.min(1, el.volume || 0));
    const start = performance.now();
    const dur = Math.max(0, secs * 1000);

    const prev = fadeRafRef.current.get(el);
    if (prev) cancelAnimationFrame(prev);

    const tick = (now: number) => {
      const t = dur ? Math.min(1, (now - start) / dur) : 1;
      const v = from + (to - from) * t;
      el.volume = Math.max(0, Math.min(1, v));
      if (t < 1) {
        const id = requestAnimationFrame(tick);
        fadeRafRef.current.set(el, id);
      } else {
        el.volume = to;
        fadeRafRef.current.delete(el);
      }
    };

    const id = requestAnimationFrame(tick);
    fadeRafRef.current.set(el, id);
  }

  function crossfadeTo(kind: MusicKind) {
    if (!audioUnlockedRef.current) return;

    const map: Record<MusicKind, HTMLAudioElement | null> = {
      exploration: explorationMusicRef.current,
      battle:      battleMusicRef.current,
      boss:        bossMusicRef.current,
    };

    const target = map[kind];
    if (!target) return;

    (Object.keys(map) as MusicKind[]).forEach((k) => {
      const el = map[k];
      if (!el) return;
      if (k === kind) return;
      if (!el.paused) fadeAudio(el, 0, MUSIC_FADE_SECS);
      setTimeout(() => el.pause(), MUSIC_FADE_SECS * 1000 + 50);
    });

    if (target.paused) {
      target.currentTime = 0;
      target.play().catch(() => {});
    }
    fadeAudio(target, MUSIC_DEFAULT_VOL, MUSIC_FADE_SECS);
    currentMusicRef.current = kind;
  }

  function restartMusic() {
    try { audioCtxRef.current?.resume(); } catch {}
    const fades = fadeRafRef.current;
    fades.forEach((id) => cancelAnimationFrame(id));
    fades.clear();

    const els = [explorationMusicRef.current, battleMusicRef.current, bossMusicRef.current];
    for (const el of els) {
      if (!el) continue;
      try { el.pause(); } catch {}
      el.currentTime = 0;
      el.volume = 0;
    }
    currentMusicRef.current = null;
    crossfadeTo("exploration");
  }

  function evaluateMusicByScore(score: number) {
    let desired: MusicKind = "exploration";
    if (score > MUSIC_EXPLORATION_MAX && score <= MUSIC_BATTLE_MAX) desired = "battle";
    else if (score > MUSIC_BATTLE_MAX) desired = "boss";
    if (desired !== currentMusicRef.current) crossfadeTo(desired);
  }

  // ===== spawn do Gate (usa PLAYER_H) =====
  function spawnGate(startAtTop: boolean): Gate {
    return {
      kind: "gate",
      x: WIDTH + 60,
      width: GATE_WIDTH,
      holeH: PLAYER_H, // buraco exatamente do tamanho do player
      t: startAtTop ? 0 : 1, // FIXO: topo (0) ou base (1)
      passed: false,
    };
  }

  // loop principal (só roda se o jogo estiver iniciado e assets prontos)
  useEffect(() => {
    if (!gameStarted || !assetsReady) return;

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
      }
      draw(ctx);

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsReady, gameStarted]);

  /** ===== POWER-UPS helpers ===== */
  function nowSec() { return performance.now() / 1000; }
  function activatePowerUp(kind: PowerUpKind) {
    const end = nowSec() + PU_DURATION[kind];
    if (kind === "ghost")  ghostUntilRef.current  = Math.max(ghostUntilRef.current, end);
    if (kind === "clone")  cloneUntilRef.current  = Math.max(cloneUntilRef.current, end);
  }
  function isGhost()   { return nowSec() < ghostUntilRef.current; }
  function hasClone()  { return nowSec() < cloneUntilRef.current; }

  // lógica por frame
  const step = (dt: number) => {
    if (lockedRef.current) return;
    const dx = speedRef.current * dt;

    // ===== PROCESSA PEDIDO DE FLIP =====
    if (wantFlipRef.current) {
      wantFlipRef.current = false; // consome o pedido
      const now = nowSec();

      if (now - justFlippedAtRef.current >= DUP_FLIP_GUARD_SECS) {
        const tweenProg = playerYAnimTRef.current; // 0..1
        if (tweenProg >= MIN_TWEEN_TO_REFLIP && gravityFlipCooldownRef.current <= 0) {
          gravityInvertedRef.current = !gravityInvertedRef.current;
          playerYAnimRef.current = gravityInvertedRef.current ? 1 : 0;
          playerYAnimTRef.current = 0;
          gravityFlipCooldownRef.current = FLIP_COOLDOWN;
          lastFlipAtRef.current = now;
          justFlippedAtRef.current = now;
        }
      }
    }

    // cooldown do flip
    if (gravityFlipCooldownRef.current > 0) {
      gravityFlipCooldownRef.current = Math.max(0, gravityFlipCooldownRef.current - dt);
    }

    // liberar flip ao acabar GHOST (UX)
    const ghostActive = isGhost();
    if (wasGhostRef.current && !ghostActive) {
      gravityFlipCooldownRef.current = 0;
    }
    wasGhostRef.current = ghostActive;

    // tween entre chão (0) e teto (1)
    if (playerYAnimTRef.current < 1) {
      playerYAnimTRef.current = Math.min(1, playerYAnimTRef.current + dt / FLIP_TWEEN_SECS);
    }

    // parallax
    bgOffRef.current += dx * BG_SPEED_FACTOR;

    // ===== atualiza distância segura pós-gate =====
    if (postGateSafeDistRef.current > 0) {
      postGateSafeDistRef.current = Math.max(0, postGateSafeDistRef.current - dx);
    }

    // ===== obstáculos & gate =====
    const obs = obstaclesRef.current;
    for (const o of obs) {
      o.x -= dx;

      // gate não anima (t fixo)
      if ((o as Gate).kind !== "gate") {
        const h = o as Obstacle;
        if (h.t == null) h.t = 0;
        h.t += dt;
      }
    }

    // ===== COLISÕES & PONTUAÇÃO =====
    const TOP_LINE_Y = CEILING_Y + PLAYER_H;

    const anim = playerYAnimRef.current; // alvo
    const tAnim = playerYAnimTRef.current; // progresso
    const ease = (x: number) => 1 - Math.pow(1 - x, 2);
    const blend = ease(tAnim) * (anim) + (1 - ease(tAnim)) * (1 - anim);
    const playerLaneIsTop = blend > 0.5;
    const player_draw_y = playerLaneIsTop ? TOP_LINE_Y : (GROUND_Y - PLAYER_H);

    for (const o of obs) {
      // GATE
      if ((o as Gate).kind === "gate") {
        const g = o as Gate;

        // bounding do gate entre as linhas
        const gateX = g.x;
        const gateY = TOP_LINE_Y;
        const gateW = g.width;
        const gateH = GROUND_Y - TOP_LINE_Y;

        // buraco fixo: 0=TOP_LINE_Y, 1=GROUND_Y - holeH
        const holeStart = TOP_LINE_Y;
        const holeEnd = GROUND_Y - g.holeH;
        const holeY = holeStart + (holeEnd - holeStart) * g.t;
        const holeH = g.holeH;

        // bounding do player
        const px = PLAYER_X;
        const py = player_draw_y;
        const pw = PLAYER_W;
        const ph = PLAYER_H;

        const overlapX = gateX < px + pw && gateX + gateW > px;
        const insideHoleY = (py >= holeY) && (py + ph <= holeY + holeH);

        if (overlapX && !isGhost()) {
          // colide se NÃO está totalmente dentro do buraco
          if (!insideHoleY) {
            if (!stoppedRef.current) {
              stoppedRef.current = true;
              setGameOver(true);
              if (scoreRef.current > highScore) setHighScore(scoreRef.current);
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
        }

        // pontua quando passar a parede
        if (!g.passed && g.x + g.width < PLAYER_X) {
          g.passed = true;
          let gain = 1 + (hasClone() ? 1 : 0);
          if (Math.abs(nowSec() - lastFlipAtRef.current) <= FLIP_WINDOW) gain += 1;
          scoreRef.current += gain;
          speedRef.current = Math.min(SPEED_MAX, speedRef.current + SPEED_ADD);
          evaluateMusicByScore(scoreRef.current);

          // marcar o próximo gate por score (se atingiu o threshold)
          if (scoreRef.current >= nextGateThresholdRef.current) {
            wantGateNextRef.current = true;                    // o próximo spawn vira gate
            nextGateThresholdRef.current += GATE_SCORE_INTERVAL;
          }
        }
        continue;
      }

      // Hidrantes
      const h = o as Obstacle;

      // colisão com hidrante
      const sameLane =
        (h.lane === "bottom" && !playerLaneIsTop) ||
        (h.lane === "top" && playerLaneIsTop);
      const overlapX = h.x < PLAYER_X + PLAYER_W && h.x + HYDRANT_W > PLAYER_X;
      if (!h.fake && !isGhost() && sameLane && overlapX) {
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          setGameOver(true);
          if (scoreRef.current > highScore) setHighScore(scoreRef.current);
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

      // pontua quando o hidrante passou a posição do player
      if (!h.passed && h.x + HYDRANT_W < PLAYER_X) {
        h.passed = true;
        const dodged = (playerLaneIsTop ? "top" : "bottom") !== h.lane;
        if (dodged || isGhost() || h.fake) {
          let gain = 1 + (hasClone() ? 1 : 0);
          if (Math.abs(nowSec() - lastFlipAtRef.current) <= FLIP_WINDOW) gain += 1;
          scoreRef.current += gain;
          speedRef.current = Math.min(SPEED_MAX, speedRef.current + SPEED_ADD);
          evaluateMusicByScore(scoreRef.current);

          // marcar próximo gate se bateu o threshold
          if (scoreRef.current >= nextGateThresholdRef.current) {
            wantGateNextRef.current = true;
            nextGateThresholdRef.current += GATE_SCORE_INTERVAL;
          }
        }
      }
    }

    // remove fora da tela
    while (obs.length && (obs[0] as any).x + (("kind" in obs[0] && (obs[0] as Gate).kind === "gate") ? (obs[0] as Gate).width : HYDRANT_W) < -100) {
      obs.shift();
    }

    // === SPAWN: gate substitui o hidrante quando marcado ===
    nextSpawnDistRef.current -= dx;
    if (nextSpawnDistRef.current <= 0) {
      // se o próximo spawn deve ser gate, e já saímos da zona de segurança pós-gate
      if (wantGateNextRef.current && postGateSafeDistRef.current <= 0) {
        const gate = spawnGate(gateStartsTopRef.current);
        gateStartsTopRef.current = !gateStartsTopRef.current; // alterna topo/base para o próximo
        obstaclesRef.current.push(gate);

        // Proteções pós-gate
        postGateSafeDistRef.current = POST_GATE_SAFE_DIST; // distância sem hidrantes
        nextHydrantMustBeFakeRef.current = true;           // e o primeiro hidrante será FAKE

        // pickups: não gerar junto do gate
        nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
        wantGateNextRef.current = false;
      } else {
        // se ainda estamos na distância segura pós-gate, apenas adia um pouco
        if (postGateSafeDistRef.current > 0 && !wantGateNextRef.current) {
          nextSpawnDistRef.current = Math.min(120, postGateSafeDistRef.current);
        } else {
          // hidrante normal
          const h = spawnObstacle();
          if (nextHydrantMustBeFakeRef.current) {
            h.fake = true; // primeiro após gate é FAKE
            nextHydrantMustBeFakeRef.current = false;
          }
          obstaclesRef.current.push(h);

          const pu = spawnPickup();
          if (pu) pickupsRef.current.push(pu);
          nextSpawnDistRef.current = rand(SPAWN_MIN, SPAWN_MAX);
        }
      }
    }

    // === atualiza pickups ===
    const ps = pickupsRef.current;
    for (const p of ps) {
      p.x -= dx;

      const anim2 = playerYAnimRef.current;
      const tAnim2 = playerYAnimTRef.current;
      const ease2 = (x: number) => 1 - Math.pow(1 - x, 2);
      const blend2 = ease2(tAnim2) * (anim2) + (1 - ease2(tAnim2)) * (1 - anim2);
      const playerLaneIsTop2 = blend2 > 0.5;
      const playerY = playerLaneIsTop2 ? TOP_LINE_Y : (GROUND_Y - PLAYER_H);

      const pY = p.lane === "bottom" ? GROUND_Y - PICKUP_H : TOP_LINE_Y;
      const overlapX2 = p.x < PLAYER_X + PLAYER_W && p.x + PICKUP_W > PLAYER_X;
      const overlapY2 = Math.abs(pY - playerY) < 24;

      if (!p.taken && overlapX2 && overlapY2) {
        p.taken = true;
        activatePowerUp(p.kind);
      }
    }
    pickupsRef.current = ps.filter((p) => p.x + PICKUP_W > -60 && !p.taken);

    // ===== PROGRESSÃO DE TEMA + CROSSFADE =====
    const totalBgs = bgMediaRef.current?.length ?? 1;
    const desiredIdx = Math.floor(scoreRef.current / THEME_INTERVAL);
    const targetIdx = totalBgs > 0 ? desiredIdx % totalBgs : 0;

    if (targetIdx !== bgIdxRef.current) {
      const prev = bgIdxRef.current;
      bgPrevIdxRef.current = prev;
      bgIdxRef.current = targetIdx;
      bgFadeTRef.current = 0; // começa o fade

      // vídeos: pausa o anterior (após o fade) e toca o novo
      const media = bgMediaRef.current;
      if (media && media[prev] instanceof HTMLVideoElement) {
        const v = media[prev] as HTMLVideoElement;
        setTimeout(() => { try { v.pause(); } catch {} }, BG_FADE_SECS * 1000 + 60);
      }
      if (media && media[targetIdx] instanceof HTMLVideoElement) {
        const v = media[targetIdx] as HTMLVideoElement;
        try {
          v.currentTime = 0;
          v.play();
        } catch {}
      }
    }

    if (bgFadeTRef.current < 1) {
      bgFadeTRef.current = Math.min(1, bgFadeTRef.current + dt / BG_FADE_SECS);
    }

    onStatsChange?.({
      score: scoreRef.current,
      speed: speedRef.current,
    });
  };

  // render
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.save();

    // toque visual: leve inclinação quando invertido
    const tilt = gravityInvertedRef.current ? -0.03 : 0; // ~1.7°
    ctx.translate(WIDTH / 2, HEIGHT / 2);
    ctx.rotate(tilt);
    ctx.translate(-WIDTH / 2, -HEIGHT / 2);

    drawBackground(ctx);

    // linhas guia (sutileza)
    const TOP_LINE_Y = CEILING_Y + PLAYER_H;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    line(ctx, 0, TOP_LINE_Y, WIDTH, TOP_LINE_Y);
    line(ctx, 0, GROUND_Y, WIDTH, GROUND_Y);

    // player com tween
    const anim = playerYAnimRef.current;
    const tAnim = playerYAnimTRef.current;
    const ease = (x: number) => 1 - Math.pow(1 - x, 2);
    const blend = ease(tAnim) * (anim) + (1 - ease(tAnim)) * (1 - anim);

    const playerLaneIsTop = blend > 0.5;
    const player_base_y = playerLaneIsTop ? TOP_LINE_Y : GROUND_Y;
    const player_draw_y = playerLaneIsTop ? player_base_y : player_base_y - PLAYER_H;

    const ghost = isGhost();
    if (ghost) { ctx.save(); ctx.globalAlpha = 0.5; }
    drawFlippable(
      ctx,
      playerImgRef.current,
      PLAYER_X,
      player_draw_y,
      PLAYER_W,
      PLAYER_H,
      playerLaneIsTop,
      "#ffd166"
    );
    if (ghost) ctx.restore();

    // clone na “pista” oposta
    if (hasClone()) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      const cloneIsTop = !playerLaneIsTop;
      const clone_base_y = cloneIsTop ? TOP_LINE_Y : GROUND_Y;
      const clone_draw_y = cloneIsTop ? clone_base_y : clone_base_y - PLAYER_H;
      drawFlippable(
        ctx,
        playerImgRef.current,
        PLAYER_X - 24,
        clone_draw_y,
        PLAYER_W,
        PLAYER_H,
        cloneIsTop,
        "#c0ffee"
      );
      ctx.restore();
    }

    // desenhar obstáculos e gates
    for (const o of obstaclesRef.current) {
      if ((o as Gate).kind === "gate") {
        const g = o as Gate;
        // coluna do gate entre as linhas (sem passar delas)
        const gateX = g.x;
        const gateY = TOP_LINE_Y;
        const gateW = g.width;
        const gateH = GROUND_Y - TOP_LINE_Y;

        // fundo do gate (suave, sem “quadrado feio”)
        ctx.save();
        const grad = ctx.createLinearGradient(0, gateY, 0, gateY + gateH);
        grad.addColorStop(0, "rgba(255,255,255,0.10)");
        grad.addColorStop(1, "rgba(255,255,255,0.06)");
        ctx.fillStyle = grad;
        ctx.fillRect(gateX, gateY, gateW, gateH);

        // “borda” leve
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gateX + 0.5, gateY + 0.5, gateW - 1, gateH - 1);

        // buraco fixo (clear)
        const holeStart = TOP_LINE_Y;
        const holeEnd = GROUND_Y - g.holeH;
        const holeY = holeStart + (holeEnd - holeStart) * g.t;
        ctx.clearRect(gateX + 2, holeY, gateW - 4, g.holeH);

        ctx.restore();
        continue;
      }

      // HIDRANTES
      const h = o as Obstacle;
      const isOTop = h.lane === "top";
      const o_base_y = isOTop ? TOP_LINE_Y : GROUND_Y;
      const o_draw_y = isOTop ? o_base_y : o_base_y - HYDRANT_H;

      const img =
        h.color === "green"
          ? hydrantGreenRef.current
          : h.color === "red"
          ? hydrantRedRef.current
          : hydrantBlueRef.current;

      const fallback =
        h.color === "green" ? "#00d084" : h.color === "red" ? "#ef476f" : "#3b82f6";

      let yOffset = 0, angle = 0;
      if (h.t != null) {
        switch (h.behavior) {
          case "wiggle": yOffset = Math.sin(h.t * 6) * 6; break;
          case "fall":   yOffset = Math.max(0, 16 - h.t * 24); break;
          case "slide":  yOffset = Math.sin(h.t * 2) > 0 ? -10 : 10; break;
          case "spin":   angle = (h.t * 6) % (Math.PI * 2); break;
        }
      }

      ctx.save();
      if (h.fake) ctx.globalAlpha = 0.6;

      if (angle !== 0) {
        const cx = h.x + HYDRANT_W / 2;
        const cy = o_draw_y + HYDRANT_H / 2;
        ctx.translate(cx, cy);
        const scaleY = isOTop ? -1 : 1;
        ctx.scale(1, scaleY);
        ctx.rotate(angle);
        drawImageOrRect(ctx, img, -HYDRANT_W / 2, -HYDRANT_H / 2 + yOffset, HYDRANT_W, HYDRANT_H, fallback);
      } else {
        drawFlippable(ctx, img, h.x, o_draw_y + yOffset, HYDRANT_W, HYDRANT_H, isOTop, fallback);
      }
      ctx.restore();
    }

    // HUD
    ctx.fillStyle = "black";
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas";
    ctx.fillText(`Score: ${scoreRef.current}`, 16, 24);
    ctx.fillText(`Vel: ${Math.round(speedRef.current)} px/s`, 16, 42);
    ctx.fillText(`High: ${highScore}`, 16, 60);

    ctx.restore(); // fim do tilt
  };

  // fundo com crossfade e tile horizontal (parallax) — suporta IMG e VÍDEO
  const drawBackground = (ctx: CanvasRenderingContext2D) => {
    const bgs = bgMediaRef.current;
    if (!bgs || bgs.length === 0) {
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      return;
    }

    const idxA = bgPrevIdxRef.current;
    theLoop: {
      const idxB = bgIdxRef.current;
      const mA = bgs[idxA];
      const mB = bgs[idxB];
      const t = bgFadeTRef.current; // 0..1

      const drawCover = (el: HTMLImageElement | HTMLVideoElement, alpha: number) => {
        const iw = (el as any).videoWidth || (el as any).naturalWidth || (el as any).width;
        const ih = (el as any).videoHeight || (el as any).naturalHeight || (el as any).height;
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

        dx -= (bgOffRef.current * BG_SPEED_FACTOR) % drawW;

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.drawImage(el as any, 0, 0, iw, ih, dx, dy, drawW, drawH);

        // tile horizontal
        if (dx > 0) {
          ctx.drawImage(el as any, 0, 0, iw, ih, dx - drawW, dy, drawW, drawH);
        } else if (dx + drawW < WIDTH) {
          ctx.drawImage(el as any, 0, 0, iw, ih, dx + drawW, dy, drawW, drawH);
        }
        ctx.restore();
      };

      if (mA && t < 1) drawCover(mA, 1 - t);
      if (mB) drawCover(mB, t);
      else {
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    }
  };

  // inputs globais (só ativos após início do jogo)
  useEffect(() => {
    if (!gameStarted) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (lockedRef.current) { onRequireLogin?.(); return; }
        flipGravity();
      }
    };
    // pointerup evita duplo evento em mobile
    const onPointerUp = () => {
      if (lockedRef.current) { onRequireLogin?.(); return; }
      flipGravity();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [flipGravity, onRequireLogin, gameStarted]);

  /** ======== FULLSCREEN + LANDSCAPE ======== */
  const enterFullscreenAndLandscape = async () => {
    const cont = containerRef.current as any;
    if (!cont) return;
    try {
      if (cont.requestFullscreen) await cont.requestFullscreen();
      else if (cont.webkitRequestFullscreen) await cont.webkitRequestFullscreen();
    } catch {}

    try {
      if ((screen as any).orientation && (screen.orientation as any).lock) {
        await (screen.orientation as any).lock("landscape");
      }
    } catch {}
  };

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {}
  };

  // iniciar o jogo com o personagem selecionado
  const startGame = (char?: Character) => {
    if (char) setSelectedCharacter(char);
    resetStateRefs();
    setShowCharSelect(false);
    setGameStarted(true);
  };

  // reiniciar (não volta à seleção, usa o personagem atual)
  const restartGame = () => {
    resetStateRefs();
    setGameStarted(true);
    setShowCharSelect(false);
    onRestartRequest?.();
  };

  // abrir seleção de personagem (só antes de iniciar ou após game over)
  const openCharSelect = () => {
    if (!gameStarted || gameOver) setShowCharSelect(true);
  };

  // expõe openCharSelect para o pai
  useImperativeHandle(ref, () => ({
    openCharSelect,
  }), [gameOver, gameStarted]);

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-4xl mx-auto"
      style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
    >
      {/* Tela de seleção de personagem */}
      {showCharSelect && (
  <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-md rounded-2xl">
    <div className="absolute inset-0 flex items-center justify-center p-2">
      <div
        className={[
          "w-full border border-white/10 bg-zinc-900/70 shadow-2xl rounded-2xl",
          // em landscape baixo: usar tela cheia (sem max-w) pra ganhar espaço
          isShortLandscape ? "max-w-none h-[100svh] rounded-none" : "max-w-[560px]"
        ].join(" ")}
      >
        {/* Header compacto */}
          <div
            className={[
              "sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-zinc-900/80 backdrop-blur",
              isShortLandscape ? "px-3 py-2" : "px-4 py-3"
            ].join(" ")}
          >
            <h2 className={["text-white font-semibold", isShortLandscape ? "text-base" : "text-lg"].join(" ")}>
              Select character
            </h2>
            <button
              onClick={() => setShowCharSelect(false)}
              className={[
                "rounded-xl text-white border border-white/10 bg-white/10 hover:bg-white/20",
                isShortLandscape ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
              ].join(" ")}
            >
              ✕
            </button>
          </div>

          {/* Corpo: ocupa a altura útil, com scroll */}
          <div
            className={[
              "overflow-y-auto",
              // em portrait/normal, usa padding padrão; em landscape baixo, tudo mais compacto
              isShortLandscape ? "px-2 pt-2 pb-2 max-h-[calc(100svh-92px)]" : "px-3 pt-3 pb-2 max-h-[calc(100svh-220px)]"
            ].join(" ")}
          >
            <div
              className={[
                "grid gap-2",
                // em landscape baixo, mais colunas e cartões menores
                isShortLandscape ? "grid-cols-4" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
              ].join(" ")}
            >
              {CHARACTERS.map((char) => {
                const isSel = selectedCharacter?.src === char.src;
                return (
                  <button
                    key={char.src}
                    onClick={() => setSelectedCharacter(char)}
                    className={[
                      "flex items-center w-full rounded-xl border transition",
                      isSel ? "bg-white/20 border-white/40" : "bg-white/10 border-white/15 hover:bg-white/15",
                      // compacto: menos padding e gap
                      isShortLandscape ? "p-2 gap-2" : "p-3 gap-3"
                    ].join(" ")}
                  >
                    <img
                      src={char.src}
                      alt={char.name}
                      className={[
                        "rounded-lg object-contain ring-1 ring-white/10 bg-black/20",
                        isShortLandscape ? "h-10 w-10" : "h-14 w-14"
                      ].join(" ")}
                    />
                    <div className="flex-1 text-left">
                      <div className={["text-white font-medium", isShortLandscape ? "text-sm" : "text-base"].join(" ")}>
                        {char.name}
                      </div>
                      {isSel && (
                        <div className={["text-emerald-300", isShortLandscape ? "text-[10px]" : "text-xs"].join(" ")}>
                          Selecionado
                        </div>
                      )}
                    </div>
                    {isSel && <span className={isShortLandscape ? "text-emerald-300 text-base" : "text-emerald-300 text-lg"}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rodapé compacto */}
          <div
            className={[
              "sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-white/10 bg-zinc-900/80 backdrop-blur",
              isShortLandscape ? "px-3 py-2" : "px-4 py-3"
            ].join(" ")}
          >
            <button
              onClick={() => setShowCharSelect(false)}
              className={[
                "rounded-xl bg-white/10 text-white border border-white/10 hover:bg-white/20",
                isShortLandscape ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
              ].join(" ")}
            >
              Cancel
            </button>
            <button
              onClick={() => startGame()}
              className={[
                "rounded-xl bg-emerald-600 text-white hover:opacity-90",
                isShortLandscape ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
              ].join(" ")}
            >
              Play
            </button>
          </div>
        </div>
      </div>
    </div>
  )}

      {/* Canvas */}
      {selectedCharacter && (
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className={`w-full h-auto rounded-2xl border border-white/10 ${gameOver ? "opacity-90" : "opacity-100"} ${showCharSelect ? "hidden" : ""}`}
          style={{ background: "rgba(0,0,0,0.5)" }}
        />
      )}

      {/* Overlay de login quando travado */}
      {locked && gameStarted && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequireLogin?.();
            }}
            className="pointer-events-auto px-5 py-3 rounded-2xl bg-white/15 text-white text-base backdrop-blur border border-white/20 hover:bg-white/25 shadow-lg"
            title="Entrar para jogar"
          >
            You need to be logged in to play
          </button>
        </div>
      )}

      {/* Game Over */}
      {gameOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <button
            onClick={restartGame}
            className="pointer-events-auto px-5 py-3 rounded-2xl bg-white/15 text-white text-base backdrop-blur border border-white/20 hover:bg-white/25 shadow-lg"
            title="Jogar novamente"
          >
            Play again
          </button>
        </div>
      )}

      {/* Toolbar (top-right) */}
      {gameStarted && !showCharSelect && (
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <button
            onClick={enterFullscreenAndLandscape}
            className="px-3 py-2 rounded-xl bg-black/50 text-white text-sm backdrop-blur border border-white/10 hover:bg-black/70"
            title="Tela cheia"
          >
            ⛶
          </button>
          <button
            onClick={() => {
              if (!audioUnlockedRef.current) {
                try { audioCtxRef.current?.resume(); } catch {}
                audioUnlockedRef.current = true;
                crossfadeTo("exploration");
                const media = bgMediaRef.current;
                if (media) {
                  const cur = media[bgIdxRef.current];
                  if (cur instanceof HTMLVideoElement) {
                    try { cur.currentTime = 0; cur.play(); } catch {}
                  }
                }
              }
            }}
            className="px-3 py-2 rounded-xl bg-black/50 text-white text-sm backdrop-blur border border-white/10 hover:bg-black/70"
            title="Ativar som"
          >
            🔊
          </button>
          <button
            onClick={exitFullscreen}
            className="px-3 py-2 rounded-xl bg-black/50 text-white text-sm backdrop-blur border border-white/10 hover:bg-black/70"
            title="Sair da tela cheia"
          >
            ↩︎
          </button>
        </div>
      )}
    </div>
  );
}

// ✅ export seguro para evitar erro do SWC
const GameCanvasWithRef = forwardRef<GameCanvasHandle, GameCanvasProps>(GameCanvas);
export default GameCanvasWithRef;
