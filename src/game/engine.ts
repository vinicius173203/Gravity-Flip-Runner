export type EngineOpts = {
  onScore?: (s: number) => void;
  onGameOver?: (finalScore: number) => void;
};

type Rect = { x: number; y: number; w: number; h: number };

export class Engine {
  private raf = 0;
  private t0 = 0;
  private running = false;
  private score = 0;
  private speed = 3; // grows over time
  private gravity = 0.5;
  private flip = 1; // 1 = ground, -1 = ceiling

  private player: Rect & { vy: number } = { x: 60, y: 0, w: 28, h: 28, vy: 0 };
  private obstacles: Rect[] = [];
  private spawnTimer = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private w: number,
    private h: number,
    private opts: EngineOpts = {}
  ) {
    this.player.y = this.groundY() - this.player.h;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.t0) this.t0 = t;
      const dt = Math.min(32, t - this.t0);
      this.t0 = t;
      this.update(dt);
      this.draw();
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  triggerFlip() {
    this.flip *= -1;
    this.player.vy = -this.player.vy * 0.5; // small impulse inversion
  }

  private groundY() {
    return this.flip === 1 ? this.h - 40 : 40;
  }

  private update(dt: number) {
    // progression
    this.speed += 0.0008 * dt;
    this.score += this.speed * 0.05;
    this.opts.onScore?.(Math.floor(this.score));

    // player physics
    const target = this.groundY();
    const dir = target > this.player.y ? 1 : -1;
    this.player.vy += this.gravity * dir;
    this.player.y += this.player.vy;

    // clamp to ground/ceiling
    const top = target - this.player.h;
    if ((dir === 1 && this.player.y > top) || (dir === -1 && this.player.y < top)) {
      this.player.y = top;
      this.player.vy = 0;
    }

    // obstacles
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const h = 28 + Math.random() * 24;
      const y = top; // align roughly with player lane
      this.obstacles.push({ x: this.w + 40, y, w: 20 + Math.random() * 20, h });
      this.spawnTimer = 800 + Math.random() * 600;
    }
    this.obstacles.forEach((o) => (o.x -= this.speed));
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -10);

    // collision
    for (const o of this.obstacles) {
      if (this.aabb(this.player, o)) {
        this.gameOver();
        break;
      }
    }
  }

  private aabb(a: Rect, b: Rect) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  private draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    // bg
    ctx.fillStyle = "#0b0f1a"; ctx.fillRect(0, 0, w, h);
    // floor/ceiling line
    ctx.fillStyle = "#1f2a44"; ctx.fillRect(0, this.groundY(), w, 4);
    // player
    ctx.fillStyle = "#34d399"; ctx.fillRect(this.player.x, this.player.y, this.player.w, this.player.h);
    // obstacles
    ctx.fillStyle = "#f59e0b";
    for (const o of this.obstacles) ctx.fillRect(o.x, o.y, o.w, o.h);
    // score
    ctx.fillStyle = "#e5e7eb"; ctx.font = "16px monospace"; ctx.fillText(`Score: ${Math.floor(this.score)}`, 12, 22);
  }

  private gameOver() {
    this.stop();
    this.opts.onGameOver?.(Math.floor(this.score));
  }
}
