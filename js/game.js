/* ------------------------------------------------------------------
   NEON DODGE - core game
   Fixed internal resolution (432px tall) upscaled with nearest-neighbour
   so every pixel stays a pixel.
------------------------------------------------------------------- */
import { FX, vibrate, HAPTIC } from './juice.js';
import { SFX, Music } from './audio.js';
import { settings } from './settings.js';
import { drawText } from './pixelfont.js';
import { seedRng, srnd, srange, spick, dailySeed } from './rng.js';

export const VH = 432;              // internal height in pixels
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

const P_R = 6.5;                    // player collision radius
const GEM_R = 6;
const SPARK_COLORS = ['#38f5ff', '#ffffff', '#ff2e88', '#ffd23f'];
export const POWER = {
  shield: { color: '#38f5ff', label: 'SHIELD', dur: 0 },
  magnet: { color: '#ffd23f', label: 'MAGNET', dur: 7 },
  slow: { color: '#b45cff', label: 'SLOW-MO', dur: 5.5 },
};
const MAGNET_R = 92;
const STEP = 1 / 60;        // fixed simulation step (docs/02: consistency across hardware)
const MAX_STEPS = 5;        // never simulate more than this per frame (no spiral of death)
const MAX_FRAME = 0.25;
const SLOW_WARP = 0.55;

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scene = document.createElement('canvas');
    this.sctx = this.scene.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tctx = this.tmp.getContext('2d');
    this.hooks = hooks;
    this.fx = new FX(200, VH);
    this.sprites = {};
    this.W = 200; this.H = VH;
    this.input = { x: null, y: null, active: false, kx: 0, ky: 0 };
    this.state = 'menu';
    this.fever = false;
    this.feverT = 0;
    this.showFps = false;
    this._fps = 60;
    this.quality = 0;      // 0 full · 1 reduced · 2 low-end (adaptive governor)
    this.hue = 305; this.hueTarget = 305;
    this.vignette = null;
    this.resetRun();
    this.resize();
  }

  /* ------------------------------------------------------------ setup */
  setSprites(s) { this.sprites = s; }

  resize() {
    const cssW = window.innerWidth || 400;
    const cssH = window.innerHeight || 800;
    const ar = Math.min(cssW / cssH, 0.78);
    this.W = Math.max(168, Math.round(VH * ar));
    this.H = VH;
    for (const c of [this.canvas, this.scene, this.tmp]) { c.width = this.W; c.height = this.H; }
    for (const c of [this.ctx, this.sctx, this.tctx]) c.imageSmoothingEnabled = false;
    let h = cssH, w = (h * this.W) / this.H;
    if (w > cssW) { w = cssW; h = (w * this.H) / this.W; }
    this.canvas.style.width = Math.round(w) + 'px';
    this.canvas.style.height = Math.round(h) + 'px';
    this.fx.W = this.W; this.fx.H = this.H;

    const g = this.ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.28, this.W / 2, this.H / 2, this.H * 0.72);
    g.addColorStop(0, 'rgba(255,40,90,0)');
    g.addColorStop(1, 'rgba(255,40,90,0.55)');
    this.vignette = g;
  }

  resetRun() {
    this.time = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.lives = 3;
    this.level = 1;
    this.grazes = 0;
    this.gems = 0;
    this.hazards = [];
    this.pickups = [];
    this.pending = [];
    this.spawnTimer = 1.25;
    this.gemTimer = 1.6;
    this.powerTimer = 12;
    this.beams = [];
    this.beamTimer = 16;
    this.seed = 0;
    this.mode = 'endless';
    this.spawnLog = [];
    this.acc = 0;
    this.pressure = 1;
    this.hitTimes = [];
    this.measuredFps = 60;
    this.hueTarget = 305;
    this.deathT = 0;
    this.fever = false; this.feverT = 0;
    Music.setFever(false);
    Music.setSlow(false);
    Music.setIntensity(1);
    this._mtier = 1;
    this.starY = 0; this.skyX = 0;
    this.pulse = 0;
    this.player = {
      x: this.W / 2, y: VH * 0.75, px: this.W / 2, py: VH * 0.75,
      vx: 0, vy: 0, tilt: 0, sx: 1, sy: 1, invuln: 0, alive: true, trailT: 0,
      shield: false, magnetT: 0, slowT: 0,
    };
    this.fx.clear();
  }

  /* ------------------------------------------------------- lifecycle */
  startRun() {
    this.resetRun();
    this.mode = settings.mode === 'daily' ? 'daily' : 'endless';
    this.seed = this.mode === 'daily' ? dailySeed() : (Math.random() * 4294967296) >>> 0;
    seedRng(this.seed);
    this.state = 'play';
    this.player.x = this.W / 2;
    this.player.y = this.H * 0.78;
    Music.setLevel(0);
    Music.setIntensity(1);
    this._mtier = 1;
    Music.start();
    SFX.start();
    vibrate(HAPTIC.start);
    this.fx.flash('#ffffff', 0.35);
    this.fx.shake(0.35);
    this.emitHud(true);
  }

  toMenu() {
    this.state = 'menu';
    Music.stop();
    this.resetRun();
  }

  pause() {
    if (this.state !== 'play') return false;
    this.state = 'paused';
    this.input.active = false;
    Music.stop();
    return true;
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    if (settings.music) Music.start();
  }

  die() {
    if (this.state !== 'play') return;
    this.state = 'dying';
    this.deathT = 0;
    this.player.alive = false;
    Music.stop();
    SFX.explode();
    vibrate(HAPTIC.death);
    const p = this.player;
    this.fx.slowmo(0.16, 2.0);
    this.fx.freeze(0.16);
    this.fx.shake(1);
    this.fx.rgbSplit(1.6);
    this.fx.flash('#ffffff', 1);
    this.fx.punch(0.12);
    this.fx.burst({ x: p.x, y: p.y, count: 90, colors: ['#ffffff', '#38f5ff', '#ff2e88', '#ffd23f', '#ff8a3d'], speed: [60, 420], size: [1, 4], life: [0.35, 1.1], gravity: 220, drag: 0.9 });
    this.fx.ring({ x: p.x, y: p.y, r0: 4, r1: 120, life: 0.7, color: '#ffffff', width: 3 });
    this.fx.ring({ x: p.x, y: p.y, r0: 2, r1: 80, life: 0.9, color: '#ff2e88', width: 2 });
    // blow away nearby hazards
    for (const h of this.hazards) {
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d < 150) {
        h.vy += 260; h.vx += (h.x - p.x) * 3;
        this.fx.burst({ x: h.x, y: h.y, count: 14, colors: ['#ff8a3d', '#ffd23f', '#ffffff'], speed: [80, 300], life: [0.3, 0.8], gravity: 120 });
      }
    }
    this.hazards = this.hazards.filter(() => srnd() > 0.35);
  }

  gameOver() {
    Music.setIntensity(0);
    this.state = 'over';
    SFX.gameOver();
    const key = this.mode || 'endless';
    if (!settings.bests) settings.bests = { endless: 0, daily: 0 };
    const isBest = this.score > (settings.bests[key] || 0);
    if (isBest) settings.bests[key] = Math.floor(this.score);
    settings.runs = (settings.runs || 0) + 1;
    if (this.hooks.onGameOver) {
      this.hooks.onGameOver({
        score: Math.floor(this.score),
        best: settings.bests[this.mode || 'endless'] || 0,
        mode: this.mode || 'endless',
        seed: this.seed,
        isBest,
        grazes: this.grazes,
        gems: this.gems,
        bestCombo: this.bestCombo,
        time: this.time,
        level: this.level,
      });
    }
  }

  /* ---------------------------------------------------------- update */
  frame(rawDt) {
    rawDt = Math.min(rawDt, MAX_FRAME);
    this.fx.impact = Math.max(0, this.fx.impact - rawDt);   // impact frames use real time
    const inst = 1 / Math.max(rawDt, 1e-4);
    this._fps = this._fps * 0.92 + inst * 0.08;
    this.governor(rawDt);

    if (this.fx.hitstop > 0) {
      this.fx.hitstop -= rawDt;
      this.fx.update(rawDt * 0.14);          // particles creep during freeze
      this.acc = 0;
    } else {
      // fixed-timestep accumulator: identical simulation on 60/90/120 Hz screens
      this.acc = (this.acc || 0) + rawDt * this.fx.timeScale;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.update(STEP);
        this.fx.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;  // drop the backlog instead of lagging
    }
    this.hue += ((this.hueTarget - this.hue + 540) % 360 - 180) * Math.min(1, rawDt * 2.2);
    if (this.hue < 0) this.hue += 360;
    this.render();
  }

  /* Mobile optimisation (docs/10): watch real fps and shed effects automatically. */
  governor(rawDt) {
    this._win = (this._win || 0) + rawDt;
    this._winFrames = (this._winFrames || 0) + 1;
    if (this._win < 1) return;
    const fps = this._winFrames / this._win;
    this._win = 0; this._winFrames = 0;
    this.measuredFps = Math.round(fps);
    if (fps < 38) this.setQuality(2);
    else if (fps < 52) this.setQuality(Math.max(this.quality || 0, 1));
    else if (fps > 58) {
      this._good = (this._good || 0) + 1;
      if (this._good > 8 && this.quality > 0) { this._good = 0; this.setQuality(this.quality - 1); }
    } else this._good = 0;
  }

  setQuality(q) {
    q = Math.max(0, Math.min(2, Math.round(q) || 0));   // NaN/anything -> 0
    if (q === this.quality) return;
    this.quality = q;
    this.fx.quality = q;
  }

  /* Adaptive difficulty (docs/04) - endless only; daily runs stay strictly seeded. */
  updatePressure(dt) {
    if (this.mode === 'daily' || this.time < 10) return;
    const recent = this.hitTimes.filter((t) => t > this.time - 18).length;
    const target = recent === 0 ? 1.08 : recent === 1 ? 1.0 : 0.85;
    this.pressure += (target - this.pressure) * Math.min(1, dt * 0.35);
  }

  update(dt) {
    if (this.state === 'paused') return;
    this.time += dt;
    this.starY = (this.starY + (26 + this.level * 5) * dt) % 128;
    this.skyX = (this.skyX + (7 + this.level * 2) * dt) % 256;
    this.pulse = Math.max(0, this.pulse - dt * 3.4);

    if (this.state === 'play') {
      this.updatePlayer(dt);
      this.updateSpawning(dt);
      this.updateEntities(dt);
      this.updateScore(dt);
      this.updateFever(dt);
      this.updateBeams(dt);
    } else if (this.state === 'dying') {
      this.updateBeams(dt);
      this.updateEntities(dt, true);
      this.deathT += Math.max(dt, 1 / 240);
      if (this.deathT > 1.5) this.gameOver();
    } else if (this.state === 'menu') {
      this.updateEntities(dt, true);
    }
    this.emitHud();
  }

  emitHud(force) {
    if (!this.hooks.onHud) return;
    const s = {
      score: Math.floor(this.score),
      combo: this.combo,
      mult: this.mult(),
      lives: this.lives,
      level: this.level,
      fever: this.fever,
    };
    const key = `${s.score}|${s.combo}|${s.lives}|${s.level}|${s.fever}`;
    if (force || key !== this._hudKey) { this._hudKey = key; this.hooks.onHud(s); }
  }

  mult() { return (1 + Math.min(this.combo, 40) * 0.07) * (this.fever ? 2 : 1); }

  /* Music layers stack up with level + combo; fever runs the full stack. */
  musicTier() {
    if (this.fever) return 3;
    if (this.level >= 5 || this.combo >= 15) return 3;
    if (this.level >= 3 || this.combo >= 6) return 2;
    return 1;
  }

  /* ---------------------------------------------------------- player */
  updatePlayer(dt) {
    const p = this.player;
    p.px = p.x; p.py = p.y;
    const minY = this.H * 0.40, maxY = this.H - 22;
    let tx = p.x, ty = p.y;

    if (this.input.kx || this.input.ky) {
      tx = clamp(p.x + this.input.kx * 260 * dt, 10, this.W - 10);
      ty = clamp(p.y + this.input.ky * 260 * dt, minY, maxY);
      this.input.x = tx; this.input.y = ty;
    }
    if (this.input.active && this.input.x != null) {
      tx = clamp(this.input.x, 10, this.W - 10);
      ty = clamp(this.input.y, minY, maxY);
    }
    const k = 1 - Math.exp(-17 * dt);
    p.x += (tx - p.x) * k;
    p.y += (ty - p.y) * k;
    p.vx = (p.x - p.px) / Math.max(dt, 1e-4);
    p.vy = (p.y - p.py) / Math.max(dt, 1e-4);

    const targetTilt = clamp(p.vx * 0.010, -0.45, 0.45);
    p.tilt += (targetTilt - p.tilt) * Math.min(1, dt * 12);
    const speed = Math.min(1, Math.hypot(p.vx, p.vy) / 320);
    p.sx += (1 + speed * 0.30 - Math.abs(p.tilt) * 0.25 - (p.sx)) * Math.min(1, dt * 14);
    p.sy += ((1 / Math.max(0.6, p.sx)) - p.sy) * Math.min(1, dt * 14);

    if (p.invuln > 0) p.invuln -= dt;
    if (p.magnetT > 0) p.magnetT = Math.max(0, p.magnetT - dt);
    if (p.slowT > 0) {
      p.slowT = Math.max(0, p.slowT - dt);
      if (p.slowT === 0) Music.setSlow(false);
    }

    // thruster
    p.trailT -= dt;
    if (p.trailT <= 0 && this.state === 'play') {
      p.trailT = 0.022;
      const back = p.y + 9;
      this.fx.emit(p.x + rnd(-3, 3), back, -p.vx * 0.12 + rnd(-18, 18), rnd(60, 150),
        0.3, Math.random() < 0.35 ? 2 : 1,
        Math.random() < 0.5 ? '#ff8a3d' : '#38f5ff', 0, 0.9, true);
    }
    // after-image trail
    this.fx.trails.push({ x: p.x, y: p.y, rot: p.tilt, life: 0.16, max: 0.16 });
    if (this.fx.trails.length > 12) this.fx.trails.shift();
  }

  /* -------------------------------------------------------- spawning */
  difficulty() { return Math.min(1, Math.max(0, this.time - 3) / 75); }
  maxHazards() { return Math.min(22, 11 + this.level * 2); }

  schedule(delay, fn) { this.pending.push({ t: this.time + delay, fn }); }

  updateSpawning(dt) {
    const d = this.difficulty();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].t <= this.time) { this.pending[i].fn(); this.pending.splice(i, 1); }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = ((1.05 - 0.55 * d) * srange(0.82, 1.22)) / this.pressure;
      if (this.hazards.length < this.maxHazards()) this.spawnWave(d);
    }
    this.gemTimer -= dt;
    if (this.gemTimer <= 0) {
      this.gemTimer = srange(2.2, 3.8);
      this.spawnGemArc();
    }
    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      this.powerTimer = srange(13, 22);
      this.spawnPower();
    }
    if (this.level >= 2) {
      this.beamTimer -= dt;
      if (this.beamTimer <= 0) {
        this.beamTimer = srange(11, 19) / (1 + (this.level - 2) * 0.14);
        if (this.beams.length < 2) this.spawnBeam();
      }
    }
  }

  spawnWave(d) {
    const roll = srnd();
    if (roll < 0.15 && this.time > 20) return this.spawnWall(d);
    if (roll < 0.33 && this.time > 30) return this.spawnStream(d);
    const n = srnd() < 0.25 + d * 0.3 ? 2 : 1;
    for (let i = 0; i < n; i++) this.spawnHazard(srange(16, this.W - 16), d);
  }

  spawnHazard(x, d, opts = {}) {
    const isDrone = srnd() < 0.32 + d * 0.12;
    const speed = (86 + d * 120) * srange(0.85, 1.2) * (opts.speedMul || 1) * (0.92 + 0.08 * this.pressure);
    const h = {
      type: isDrone ? 'drone' : 'meteor',
      x, y: -22 - srange(0, 40),
      vy: speed,
      vx: isDrone ? 0 : srange(-26, 26),
      baseX: x,
      r: isDrone ? 7.5 : 8,
      rot: srange(0, Math.PI * 2),
      rotSpeed: srange(-3.2, 3.2),
      wob: srange(0, 6.28),
      wobFreq: srange(1.2, 2.6),
      wobAmp: isDrone ? srange(14, 42) : 0,
      size: isDrone ? 21 : 24,
      grazed: false,
      dead: false,
    };
    this.hazards.push(h);
    if (this.spawnLog.length < 300) this.spawnLog.push(`${h.type}:${Math.round(x)}:${Math.round(speed)}`);
    return h;
  }

  spawnWall(d) {
    const gap = srange(54, 74);
    const gapX = srange(gap / 2 + 14, this.W - gap / 2 - 14);
    for (let x = 16; x < this.W - 12; x += 27) {
      if (Math.abs(x - gapX) < gap / 2) continue;
      this.spawnHazard(x, d * 0.85, { speedMul: 0.86 });
    }
    this.fx.ring({ x: gapX, y: -10, r0: 2, r1: 26, life: 0.5, color: '#4dff9e', width: 1 });
  }

  spawnStream(d) {
    const x = srange(24, this.W - 24);
    const dir = srnd() < 0.5 ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      this.schedule(i * 0.16, () => this.spawnHazard(clamp(x + dir * i * 15, 14, this.W - 14), d * 0.9, { speedMul: 1.05 }));
    }
  }

  /* -------------------------------------------------------- laser beam */
  spawnBeam() {
    const x = srange(30, this.W - 30);
    const b = {
      x, x0: x, sweep: (srnd() < 0.5 ? -1 : 1) * srange(0, 46),
      phase: 'charge', t: 0, charge: 1.3, fire: 0.75, fade: 0.35, grazed: false,
    };
    this.beams.push(b);
    SFX.charge();
    this.fx.ring({ x, y: 10, r0: 2, r1: 26, life: 0.5, color: '#ff3355', width: 1 });
  }

  updateBeams(dt) {
    const p = this.player;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;

      if (b.phase === 'charge') {
        const k = b.t / b.charge;
        // sparks spiral into the emitter
        if (Math.random() < dt * 34) {
          const sx = b.x + rnd(-22, 22), sy = rnd(-4, 20);
          this.fx.emit(sx, sy, (b.x - sx) * 3.4, -rnd(20, 60), 0.3,
            Math.random() < 0.3 ? 2 : 1,
            Math.random() < 0.5 ? '#ff3355' : '#ffffff', 0, 0.94, true);
        }
        if (b.t >= b.charge) {
          b.phase = 'fire'; b.t = 0;
          SFX.beam();
          vibrate([22, 18, 22]);
          this.fx.shake(0.45);
          this.fx.flash('#ff3355', 0.32);
          this.fx.rgbSplit(0.5);
          this.fx.punch(0.03);
          this.fx.ring({ x: b.x, y: 10, r0: 3, r1: 44, life: 0.45, color: '#ffffff', width: 2 });
        }
        continue;
      }

      if (b.phase === 'fire') {
        b.x = b.x0 + b.sweep * (b.t / b.fire);
        this.fx.trauma = Math.max(this.fx.trauma, 0.14);          // continuous rumble
        if (Math.random() < dt * 46) {
          this.fx.emit(b.x + rnd(-5, 5), rnd(0, this.H), rnd(-40, 40), rnd(-60, 60), 0.28,
            Math.random() < 0.4 ? 2 : 1,
            Math.random() < 0.5 ? '#ff3355' : '#ffd23f', 0, 0.9, true);
        }
        if (this.state === 'play') {
          const dx = Math.abs(p.x - b.x);
          if (dx < 6 + P_R) {
            if (p.invuln <= 0) { this.takeHit({ x: b.x, y: p.y }); b.grazed = true; }
          } else if (!b.grazed && dx < 6 + P_R + 8) {
            b.grazed = true;
            this.onGraze({ x: b.x, y: p.y, r: 6 });
          }
        }
        if (b.t >= b.fire) { b.phase = 'fade'; b.t = 0; }
        continue;
      }

      if (b.t >= b.fade) this.beams.splice(i, 1);
    }
  }

  drawBeams(s, W, H) {
    for (const b of this.beams) {
      s.save();
      s.globalCompositeOperation = 'lighter';
      if (b.phase === 'charge') {
        const k = Math.min(1, b.t / b.charge);
        s.globalAlpha = 0.08 + 0.20 * k;
        s.fillStyle = '#ff3355';
        s.fillRect(Math.round(b.x) - 1, 0, 2, H);
        s.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(b.t * 26));
        s.beginPath();
        s.arc(b.x, 9, 2 + k * 5, 0, Math.PI * 2);
        s.fill();
      } else {
        const a = b.phase === 'fire' ? 1 : Math.max(0, 1 - b.t / b.fade);
        s.globalAlpha = 0.18 * a; s.fillStyle = '#ff8a3d'; s.fillRect(Math.round(b.x) - 11, 0, 22, H);
        s.globalAlpha = 0.42 * a; s.fillStyle = '#ff3355'; s.fillRect(Math.round(b.x) - 6, 0, 12, H);
        s.globalAlpha = 0.95 * a; s.fillStyle = '#ffffff'; s.fillRect(Math.round(b.x) - 2, 0, 4, H);
      }
      s.restore();
    }
  }

  spawnPower() {
    const kind = spick(Object.keys(POWER));
    const x = srange(24, this.W - 24);
    this.pickups.push({ x, y: -18, vy: 52 + this.level * 2, ph: rnd(0, 6.28), kind, r: 9 });
    this.fx.ring({ x, y: -10, r0: 2, r1: 22, life: 0.55, color: POWER[kind].color, width: 1 });
  }

  spawnGemArc() {
    const x0 = srange(26, this.W - 26);
    const n = 2 + ((srnd() * 3) | 0);
    for (let i = 0; i < n; i++) {
      this.schedule(i * 0.18, () => {
        this.pickups.push({
          x: clamp(x0 + Math.sin(i * 0.9) * 22, 12, this.W - 12),
          y: -16, vy: 60 + this.level * 2, ph: rnd(0, 6.28), taken: false, kind: 'gem',
        });
      });
    }
  }

  /* ------------------------------------------------------- entities */
  updateEntities(dt, frozenPlayer = false) {
    const p = this.player;

    const warp = p.slowT > 0 ? SLOW_WARP : 1;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.y += h.vy * warp * dt;
      h.x += h.vx * warp * dt;
      h.rot += h.rotSpeed * dt;
      h.wob += dt;
      if (h.type === 'drone') h.x = h.baseX + Math.sin(h.wob * h.wobFreq) * h.wobAmp;
      if (h.x < 8 || h.x > this.W - 8) h.vx *= -1;
      if (h.y > this.H + 34 || h.dead) { this.hazards.splice(i, 1); continue; }

      if (this.state === 'play' && !frozenPlayer) {
        const dx = h.x - p.x, dy = h.y - p.y;
        const dist = Math.hypot(dx, dy);
        const rr = h.r + P_R;
        if (dist < rr) {
          if (p.invuln <= 0) {
            this.hazards.splice(i, 1);
            // takeHit() shock-wave-clears nearby hazards too, so our index i goes stale -
            // keep iterating and hazards[i] can be undefined. Stop for this frame instead.
            this.takeHit(h);
            break;
          }
        } else if (!h.grazed && dist < rr + 9) {
          h.grazed = true;
          this.onGraze(h);
        }
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const g = this.pickups[i];
      g.ph += dt * 5;
      // magnet drags loot toward the ship
      if (p.magnetT > 0 && g.kind === 'gem' && this.state === 'play') {
        const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy);
        if (d < MAGNET_R && d > 0.5) {
          const pull = 340 * dt * (1 - d / MAGNET_R);
          g.x += (dx / d) * pull * 1.7;
          g.y += (dy / d) * pull;
        }
      }
      g.y += g.vy * dt;
      if (g.y > this.H + 20) { this.pickups.splice(i, 1); continue; }
      if (this.state === 'play' && !frozenPlayer) {
        const rr = (g.kind === 'gem' ? GEM_R : g.r) + P_R;
        if (Math.hypot(g.x - p.x, g.y - p.y) < rr) {
          this.pickups.splice(i, 1);
          if (g.kind === 'gem') this.onGem(g);
          else this.activatePower(g.kind);
        }
      }
    }
  }

  /* ---------------------------------------------------------- events */
  onGraze(h) {
    this.grazes++;
    this.combo++;
    this.comboTimer = 2.6;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const bonus = Math.round(6 * this.mult());
    this.score += bonus;
    SFX.graze(this.combo);
    vibrate(HAPTIC.graze);
    this.fx.freeze(0.022);
    this.fx.shake(0.075);
    this.fx.punch(0.012);
    this.fx.sparks(h.x, h.y, 6, SPARK_COLORS);
    this.fx.ring({ x: h.x, y: h.y, r0: h.r, r1: h.r + 16, life: 0.28, color: '#38f5ff', width: 1 });
    if (this.combo > 0 && this.combo % 10 === 0) {
      this.fx.popup({ x: this.player.x, y: this.player.y - 24, text: `GRAZE X${this.combo}`, color: '#38f5ff', scale: 2, life: 1.0 });
      this.fx.flash('#38f5ff', 0.22);
      this.fx.shake(0.25);
      vibrate([10, 20, 10, 20, 30]);
    } else if (Math.random() < 0.5) {
      this.fx.popup({ x: h.x, y: h.y - 12, text: `+${bonus}`, color: '#ffffff', scale: 1, life: 0.55 });
    }
  }

  onGem(g) {
    this.gems++;
    this.combo++;
    this.comboTimer = 2.6;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const gain = Math.round(25 * this.mult());
    this.score += gain;
    SFX.gem(this.combo);
    vibrate(HAPTIC.gem);
    this.fx.shake(0.16);
    this.fx.punch(0.022);
    this.fx.flash('#ffd23f', 0.18);
    this.fx.burst({ x: g.x, y: g.y, count: 22, colors: ['#ffd23f', '#ffffff', '#4dff9e'], speed: [60, 220], size: [1, 3], life: [0.25, 0.7], gravity: 120 });
    this.fx.ring({ x: g.x, y: g.y, r0: 3, r1: 34, life: 0.35, color: '#ffd23f', width: 2 });
    this.fx.popup({ x: g.x, y: g.y - 14, text: `+${gain}`, color: '#ffd23f', scale: 2, life: 0.8 });
  }

  activatePower(kind) {
    const p = this.player;
    const col = POWER[kind].color;
    this.score += 40;
    SFX.power(kind);
    vibrate([15, 25, 15, 25, 45]);
    this.fx.shake(0.3);
    this.fx.punch(0.03);
    this.fx.rgbSplit(0.4);
    this.fx.flash(col, 0.3);
    this.fx.burst({ x: p.x, y: p.y, count: 28, colors: [col, '#ffffff'], speed: [70, 260], size: [1, 3], life: [0.3, 0.8], gravity: 40 });
    this.fx.ring({ x: p.x, y: p.y, r0: 4, r1: 74, life: 0.5, color: col, width: 2 });
    if (kind === 'shield') p.shield = true;
    if (kind === 'magnet') p.magnetT = POWER.magnet.dur;
    if (kind === 'slow') { p.slowT = POWER.slow.dur; Music.setSlow(true); }
    this.fx.popup({ x: p.x, y: p.y - 28, text: POWER[kind].label, color: col, scale: 3, life: 1.1 });
  }

  shieldBreak(h) {
    const p = this.player;
    p.invuln = 1.2;
    this.score += 60;
    SFX.shieldBreak();
    vibrate([45, 25, 45]);
    this.fx.freeze(0.1);
    this.fx.impact = settings.reduceFlash ? 0 : 0.04;
    this.fx.shake(0.7);
    this.fx.rgbSplit(0.9);
    this.fx.flash('#38f5ff', 0.6);
    this.fx.punch(0.06);
    this.fx.burst({ x: p.x, y: p.y, count: 46, colors: ['#38f5ff', '#ffffff', '#4dff9e'], speed: [80, 330], size: [1, 3], life: [0.3, 0.9], gravity: 70 });
    this.fx.ring({ x: p.x, y: p.y, r0: 8, r1: 112, life: 0.55, color: '#38f5ff', width: 3 });
    this.fx.ring({ x: p.x, y: p.y, r0: 4, r1: 74, life: 0.4, color: '#ffffff', width: 2 });
    this.fx.popup({ x: p.x, y: p.y - 30, text: 'SAVED!', color: '#38f5ff', scale: 3, life: 1.1 });
  }

  takeHit(h) {
    const p = this.player;
    if (p.shield) { p.shield = false; this.shieldBreak(h); return; }
    this.hitTimes.push(this.time);
    this.lives--;
    this.combo = 0;
    p.invuln = 1.8;
    SFX.hit();
    vibrate(HAPTIC.hit);
    this.fx.freeze(0.13);
    this.fx.impact = settings.reduceFlash ? 0 : 0.05;   // 3-frame solid white impact
    this.fx.shake(0.95);
    this.fx.rgbSplit(1.3);
    this.fx.flash('#ff2244', 0.8);
    this.fx.punch(0.09);
    this.fx.burst({ x: p.x, y: p.y, count: 40, colors: ['#ffffff', '#ff3355', '#ffd23f'], speed: [70, 320], size: [1, 3], life: [0.25, 0.8], gravity: 180 });
    this.fx.ring({ x: p.x, y: p.y, r0: 4, r1: 90, life: 0.45, color: '#ff3355', width: 3 });
    this.fx.popup({ x: p.x, y: p.y - 26, text: 'OUCH!', color: '#ff3355', scale: 3, life: 0.9 });

    // shock-wave clears nearby hazards
    let cleared = 0;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const o = this.hazards[i];
      if (Math.hypot(o.x - p.x, o.y - p.y) < 78) {
        cleared++;
        this.fx.burst({ x: o.x, y: o.y, count: 16, colors: ['#ff8a3d', '#ffd23f', '#ffffff'], speed: [80, 260], life: [0.3, 0.7], gravity: 140 });
        this.hazards.splice(i, 1);
      }
    }
    if (cleared) {
      const bonus = cleared * 12;
      this.score += bonus;
      this.fx.ring({ x: p.x, y: p.y, r0: 6, r1: 78, life: 0.5, color: '#ffffff', width: 2 });
      this.fx.popup({ x: p.x, y: p.y + 12, text: `SHOCKWAVE +${bonus}`, color: '#4dff9e', scale: 2, life: 1.0 });
    }
    if (this.lives <= 0) this.die();
  }

  /* ----------------------------------------------------------- fever */
  updateFever(dt) {
    const on = this.combo >= 15;
    if (on !== this.fever) { this.fever = on; on ? this.enterFever() : this.exitFever(); }
    if (!this.fever) return;
    this.hueTarget = (this.hueTarget + dt * 90) % 360;          // rainbow drift
    this.pulse = Math.max(this.pulse, 0.55 + Math.sin(this.time * 14) * 0.35);
    this.feverT -= dt;
    if (this.feverT <= 0) {
      this.feverT = 0.045;
      const p = this.player;
      this.fx.burst({
        x: p.x + rnd(-6, 6), y: p.y + 8, count: 3,
        colors: [`hsl(${(this.hue + 180) % 360}, 100%, 66%)`, '#ffd23f', '#ff2e88'],
        speed: [40, 170], size: [1, 2], life: [0.2, 0.5], gravity: -30, drag: 0.9,
      });
    }
  }

  enterFever() {
    Music.setIntensity(3);
    Music.setFever(true);
    SFX.levelUp();
    vibrate([30, 20, 30, 20, 70]);
    this.fx.flash('#ffd23f', 0.5);
    this.fx.shake(0.55);
    this.fx.rgbSplit(0.7);
    this.fx.punch(0.05);
    this.fx.ring({ x: this.W / 2, y: this.H * 0.42, r0: 8, r1: 230, life: 0.7, color: '#ffd23f', width: 3 });
    this.fx.popup({ x: this.W / 2, y: this.H * 0.30, text: 'FEVER!', color: '#ffd23f', scale: 4, life: 1.6, vy: -14 });
  }

  exitFever() {
    Music.setFever(false);
    Music.setSlow(false);
    Music.setIntensity(1);
    this._mtier = 1;
    SFX.comboBreak();
    this.fx.flash('#38f5ff', 0.2);
  }

  updateScore(dt) {
    const tier = this.musicTier();
    if (tier !== this._mtier) { this._mtier = tier; Music.setIntensity(tier); }
    this.updatePressure(dt);
    this.score += dt * (7 + this.level * 3) * this.mult();
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.combo = 0;
        SFX.comboBreak();
      }
    }
    const lv = 1 + Math.floor(this.time / 22);
    if (lv !== this.level) this.levelUp(lv);
  }

  levelUp(lv) {
    this.level = lv;
    this.hueTarget = (this.hueTarget + 57) % 360;
    Music.setLevel(lv - 1);
    SFX.levelUp();
    vibrate(HAPTIC.level);
    this.fx.flash('#ffffff', 0.5);
    this.fx.shake(0.6);
    this.fx.rgbSplit(0.8);
    this.fx.punch(0.05);
    this.fx.ring({ x: this.W / 2, y: this.H * 0.4, r0: 6, r1: 200, life: 0.8, color: '#ffffff', width: 3 });
    this.fx.popup({ x: this.W / 2, y: this.H * 0.36, text: `LEVEL ${lv}`, color: '#ff2e88', scale: 3, life: 1.4 });
    this.fx.burst({ x: this.W / 2, y: this.H * 0.4, count: 60, colors: ['#38f5ff', '#ff2e88', '#ffd23f', '#ffffff'], speed: [80, 340], size: [1, 3], life: [0.4, 1.0], gravity: 40 });
    this.pulse = 1.4;
  }

  beat(strength) { this.pulse = Math.max(this.pulse, strength); }

  /* ---------------------------------------------------------- render */
  render() {
    const s = this.sctx, W = this.W, H = this.H;
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = 1;
    s.fillStyle = '#05050e';
    s.fillRect(0, 0, W, H);

    // starfield
    if (this.sprites.stars) {
      const t = 128;
      const off = this.starY % t;
      for (let y = -t + off; y < H; y += t) {
        for (let x = 0; x < W; x += t) s.drawImage(this.sprites.stars, x, y);
      }
    }
    // palette hue shift on the backdrop
    s.save();
    s.globalCompositeOperation = 'hue';
    s.globalAlpha = 0.55;
    s.fillStyle = `hsl(${this.hue}, 95%, 55%)`;
    s.fillRect(0, 0, W, H);
    s.restore();

    // beat pulse
    if (this.pulse > 0.01) {
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = Math.min(0.16, this.pulse * 0.12);
      s.fillStyle = `hsl(${this.hue}, 100%, 60%)`;
      s.fillRect(0, 0, W, H);
      s.restore();
    }

    // parallax skyline
    if (this.sprites.skyline) {
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = 0.8;
      const y = H - 74;
      const x0 = -this.skyX;
      s.drawImage(this.sprites.skyline, x0, y);
      s.drawImage(this.sprites.skyline, x0 + 256, y);
      if (W > 256) s.drawImage(this.sprites.skyline, x0 + 512, y);
      s.restore();
    }

    // horizon glow (pulses with the music)
    {
      const g = s.createLinearGradient(0, H - 110, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `hsla(${this.hue}, 100%, 62%, ${0.16 + this.pulse * 0.10})`);
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.fillStyle = g;
      s.fillRect(0, H - 110, W, 110);
      s.restore();
    }

    // fever wash
    if (this.fever) {
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = 0.05 + this.pulse * 0.05;
      s.fillStyle = `hsl(${this.hue}, 100%, 60%)`;
      s.fillRect(0, 0, W, H);
      s.restore();
    }

    // ---- gems
    for (const g of this.pickups) {
      const bob = Math.sin(g.ph) * 2;
      if (g.kind === 'gem') {
        this.glowSprite(s, this.sprites.gem, g.x, g.y + bob, 13, 0, '#ffd23f', 0.35);
      } else {
        const spr = this.sprites['pw_' + g.kind];
        const pulse = 1 + Math.sin(g.ph * 3) * 0.14;
        this.glowSprite(s, spr, g.x, g.y + bob, 17 * pulse, g.ph * 0.7, POWER[g.kind].color, 0.5);
      }
    }
    // slow-motion wash
    if (this.player.slowT > 0) {
      s.save();
      s.globalCompositeOperation = 'lighter';
      s.globalAlpha = 0.055;
      s.fillStyle = '#b45cff';
      s.fillRect(0, 0, W, H);
      s.restore();
    }

    // ---- hazards
    for (const h of this.hazards) {
      const spr = h.type === 'drone' ? this.sprites.drone : this.sprites.meteor;
      const wob = h.type === 'drone' ? Math.sin(h.wob * 6) * 0.15 : 0;
      this.glowSprite(s, spr, h.x, h.y, h.size, h.rot + wob, h.type === 'drone' ? '#ff2e88' : '#ff8a3d', 0.3);
      if (h.type === 'drone') {
        s.save();
        s.globalCompositeOperation = 'lighter';
        s.globalAlpha = 0.25 + Math.sin(h.wob * 8) * 0.15;
        s.strokeStyle = '#ff2e88'; s.lineWidth = 1;
        s.beginPath(); s.arc(h.x, h.y, h.r + 5, 0, Math.PI * 2); s.stroke();
        s.restore();
      }
    }
    this.drawBeams(s, W, H);

    // ---- player
    const p = this.player;
    if (p.alive) {
      const blink = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
      // after-images (skipped on the lowest quality tier)
      s.save();
      s.globalCompositeOperation = 'lighter';
      const trailSkip = this.quality === 2 ? 99 : this.quality;
      for (let i = 0; i < this.fx.trails.length; i++) {
        if (i % (trailSkip + 1) !== 0) continue;
        const t = this.fx.trails[i];
        const a = (i / this.fx.trails.length) * (t.life / t.max) * 0.4;
        s.globalAlpha = a;
        this.drawSprite(s, this.sprites.player, t.x, t.y + 3, 22, t.rot, 1, 1);
      }
      s.restore();
      if (!blink) this.glowSprite(s, this.sprites.player, p.x, p.y, 22, p.tilt, '#38f5ff', 0.55, p.sx, p.sy);
      if (p.shield) this.drawShield(s, p);
    }

    this.fx.draw(s);
    if (this.state === 'play' || this.state === 'dying') { this.drawLives(s); this.drawPowers(s); }
    if (this.showFps) {
      drawText(s, Math.round(this._fps) + 'FPS Q' + this.quality + ' P' + this.pressure.toFixed(2),
        4, H - 12, 1, '#4dff9e', 'left', '#000');
    }

    this.composite();
  }

  drawShield(ctx, p) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const t = this.time * 2.6;
    for (let i = 0; i < 8; i++) {
      const a = t + (i * Math.PI) / 4;
      ctx.globalAlpha = 0.45 + Math.sin(this.time * 9 + i) * 0.3;
      ctx.fillStyle = '#38f5ff';
      ctx.fillRect(Math.round(p.x + Math.cos(a) * 16) - 1, Math.round(p.y + Math.sin(a) * 16) - 1, 3, 3);
    }
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#38f5ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPowers(ctx) {
    const p = this.player;
    const bars = [];
    if (p.magnetT > 0) bars.push(['#ffd23f', p.magnetT / POWER.magnet.dur]);
    if (p.slowT > 0) bars.push(['#b45cff', p.slowT / POWER.slow.dur]);
    bars.forEach(([color, t], i) => {
      const x = 7, y = 27 + i * 9;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, 30, 5);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.round(30 * Math.max(0, Math.min(1, t))), 5);
    });
  }

  drawSprite(ctx, spr, x, y, size, rot = 0, sx = 1, sy = 1) {
    if (!spr) return;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (rot) ctx.rotate(rot);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.drawImage(spr, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  glowSprite(ctx, spr, x, y, size, rot, color, strength, sx = 1, sy = 1) {
    if (!spr) return;
    if (this.quality < 2) {                 // the bloom pass is the priciest extra draw
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = strength;
      this.drawSprite(ctx, spr, x, y, size * 1.5, rot, sx, sy);
      ctx.restore();
    }
    this.drawSprite(ctx, spr, x, y, size, rot, sx, sy);
  }

  drawLives(ctx) {
    const n = this.lives;
    for (let i = 0; i < 3; i++) {
      const x = 7 + i * 13, y = 8;
      const on = i < n;
      const c = on ? (n === 1 ? '#ff3355' : '#ff2e88') : 'rgba(255,255,255,0.16)';
      ctx.fillStyle = c;
      const s = 2;
      const put = (px, py) => ctx.fillRect(x + px * s, y + py * s, s, s);
      const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
      rows.forEach((row, r) => { for (let c2 = 0; c2 < 7; c2++) if (row[c2] === '1') put(c2, r); });
      if (on && n === 1) {
        ctx.globalAlpha = 0.4 + Math.sin(performance.now() / 90) * 0.35;
        rows.forEach((row, r) => { for (let c2 = 0; c2 < 7; c2++) if (row[c2] === '1') put(c2, r); });
        ctx.globalAlpha = 1;
      }
    }
  }

  composite() {
    const ctx = this.ctx, W = this.W, H = this.H, fx = this.fx;
    const off = fx.offset();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05050e';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2 + off.x, H / 2 + off.y);
    ctx.rotate(off.rot);
    ctx.scale(fx.zoom, fx.zoom);
    ctx.translate(-W / 2, -H / 2);

    const d = this.quality < 2 ? fx.chroma * 2.6 : 0;   // no RGB split on low-end
    if (d > 0.15) {
      this.splitCopy('#ff0000', -d, 0);
      this.splitCopy('#00ffff', d, 0);
    } else {
      ctx.drawImage(this.scene, 0, 0);
    }
    ctx.restore();

    // classic impact frame: a few solid white frames on a hit
    if (fx.impact > 0) {
      ctx.globalAlpha = Math.min(1, fx.impact / 0.03);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // full-screen flash
    if (fx.flashA > 0.004) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, fx.flashA);
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // danger vignette at 1 life
    if (this.lives === 1 && this.state === 'play' && this.vignette) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(this.time * 6) * 0.15;
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  splitCopy(color, dx, dy) {
    const t = this.tctx, ctx = this.ctx, W = this.W, H = this.H;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, W, H);
    t.drawImage(this.scene, 0, 0);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = color;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.tmp, dx, dy);
    ctx.globalCompositeOperation = 'source-over';
  }
}
