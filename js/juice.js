/* ------------------------------------------------------------------
   The JUICE layer: screen shake, hitstop, slow-mo, chromatic aberration,
   flashes, zoom punch, particles, shockwave rings, pop-up text, haptics.
   Animation of pop-ups and UI springs is handled by anime.js.
   https://github.com/juliangarnier/anime  (MIT)
------------------------------------------------------------------- */
import { settings } from './settings.js';
import { drawText, textWidth } from './pixelfont.js';

const anime = typeof window !== 'undefined' ? window.anime : null;
const J = () => (settings.juice == null ? 1 : settings.juice);   // juice intensity
// quality tiers set by the adaptive governor: 0 = full, 1 = reduced, 2 = low-end
const BUDGET = [1, 0.55, 0.3];
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ------------------------------------------------------------ haptics */
export function vibrate(pattern) {
  if (!settings.haptics) return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}
export const HAPTIC = {
  graze: 8,
  gem: [12, 18, 12],
  hit: [55, 30, 90],
  death: [120, 60, 120, 60, 260],
  level: [25, 40, 25, 40, 60],
  ui: 10,
  start: [15, 30, 15],
};

export class FX {
  constructor(w = 200, h = 432) {
    this.W = w; this.H = h;
    this.particles = [];
    this.pool = [];        // recycled particle objects (no GC churn)
    this.rings = [];
    this.popups = [];
    this.trails = [];
    this.quality = 0;      // raised by the performance governor on slow devices

    this.trauma = 0;      // 0..1 -> shake
    this.shakeT = 0;
    this.flashA = 0;      // 0..1
    this.flashColor = '#ffffff';
    this.chroma = 0;      // 0..1
    this.zoom = 1;        // scale kick
    this.hitstop = 0;     // seconds of frozen world
    this.impact = 0;      // solid-frame flash (classic impact frame)
    this.timeScale = 1;
    this.timeTarget = 1;
    this.timeRate = 4;
    this.danger = 0;      // red edge glow
    this.hue = 0;
  }

  /* ------------------------------------------------------- screen fx */
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount * Math.min(1.6, J())); }
  flash(color = '#ffffff', alpha = 0.6) {
    if (settings.reduceFlash) alpha = Math.min(alpha, 0.16);   // photosensitivity guard
    alpha *= Math.min(1.2, J());
    if (alpha > this.flashA || this.flashA < 0.05) { this.flashColor = color; this.flashA = Math.min(1, alpha); }
    else { this.flashColor = color; this.flashA = Math.min(1, this.flashA + alpha * 0.6); }
  }
  rgbSplit(a = 1) { this.chroma = Math.min(1.6, this.chroma + a * Math.min(1.4, J())); }
  punch(amount = 0.06) { this.zoom = 1 + amount * Math.min(1.5, J()); }
  freeze(seconds = 0.08) { this.hitstop = Math.max(this.hitstop, seconds); }
  slowmo(scale = 0.18, rate = 3) { this.timeScale = scale; this.timeTarget = 1; this.timeRate = rate; }
  speedUp(scale = 1.35, rate = 6) { this.timeScale = scale; this.timeTarget = 1; this.timeRate = rate; }
  setDanger(v) { this.danger = v; }

  /* -------------------------------------------------------- emitters */
  /** Take a particle from the pool (or make one) and push it into the active list. */
  emit(x, y, vx, vy, life, s, c, gravity = 0, drag = 0.86, glow = true) {
    if (this.particles.length > 900) return null;
    const p = this.pool.pop() || {};
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = life; p.s = s < 1 ? 1 : Math.round(s);
    p.c = c; p.gravity = gravity; p.drag = drag; p.glow = glow;
    this.particles.push(p);
    return p;
  }

  burst({ x, y, count = 12, colors = ['#fff'], speed = [40, 160], angle = [0, TAU],
          size = [1, 3], life = [0.25, 0.6], gravity = 0, drag = 0.86, glow = true, spread = 0 }) {
    count = Math.max(1, Math.round(count * J() * BUDGET[this.quality]));
    for (let i = 0; i < count; i++) {
      const a = typeof angle === 'number' ? angle + rnd(-spread, spread) : rnd(angle[0], angle[1]);
      const sp = rnd(speed[0], speed[1]);
      const l = rnd(life[0], life[1]);
      this.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, l,
        rnd(size[0], size[1]), pick(colors), gravity, drag, glow);
    }
  }

  sparks(x, y, count, colors) {
    this.burst({ x, y, count, colors, speed: [80, 260], size: [1, 2], life: [0.2, 0.45], drag: 0.82, gravity: 60 });
  }

  ring({ x, y, r0 = 2, r1 = 40, life = 0.4, color = '#fff', width = 2 }) {
    this.rings.push({ x, y, r0, r1, life, max: life, color, width });
  }

  popup({ x, y, text, color = '#fff', scale = 2, life = 0.9, vy = -26, shadow = '#000' }) {
    const p = { x, y, text: String(text), color, scale: 0, base: scale, life, max: life, vy, shadow };
    if (anime) {
      anime({
        targets: p,
        scale: [0, scale],
        duration: 520,
        easing: 'easeOutElastic(1, 0.45)',
      });
    } else {
      p.scale = scale;
    }
    this.popups.push(p);
    if (this.popups.length > 24) this.popups.shift();
    return p;
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.popups.length = 0;
    this.trails.length = 0;
    this.trauma = this.flashA = this.chroma = 0;
    this.zoom = 1; this.timeScale = 1; this.timeTarget = 1; this.hitstop = 0; this.impact = 0;
  }

  /* ---------------------------------------------------------- update */
  update(dt) {
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.impact = Math.max(0, this.impact - dt);
    this.flashA = Math.max(0, this.flashA - dt * 3.2);
    this.chroma = Math.max(0, this.chroma - dt * 3.4);
    this.zoom += (1 - this.zoom) * Math.min(1, dt * 9);
    this.timeScale += (this.timeTarget - this.timeScale) * Math.min(1, dt * this.timeRate);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        if (this.pool.length < 500) this.pool.push(p);   // recycle
        continue;
      }
      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= Math.pow(0.86, dt * 60);
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life -= dt;
      if (t.life <= 0) this.trails.splice(i, 1);
    }
  }

  /* ------------------------------------------------ shake transform */
  offset() {
    if (!settings.shake) return { x: 0, y: 0, rot: 0 };
    const s = this.trauma * this.trauma;
    if (s < 0.001) return { x: 0, y: 0, rot: 0 };
    const t = this.shakeT;
    const amp = 7 * Math.min(1.7, J());
    return {
      x: (Math.sin(t * 51.3) + Math.sin(t * 27.1) * 0.6) * amp * s,
      y: (Math.sin(t * 43.7) + Math.sin(t * 19.3) * 0.6) * amp * s,
      rot: Math.sin(t * 33.1) * 0.03 * s * Math.min(1.6, J()),
    };
  }

  /* ------------------------------------------- world-space drawing */
  draw(ctx) {
    // rings
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 3));
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.stroke();
    }
    // particles
    for (const p of this.particles) {
      const a = Math.min(1, p.life / p.max);
      const x = Math.round(p.x), y = Math.round(p.y);
      ctx.globalAlpha = a;
      if (p.glow) {
        ctx.globalAlpha = a * 0.28;
        ctx.fillStyle = p.c;
        ctx.fillRect(x - p.s, y - p.s, p.s * 3, p.s * 3);
        ctx.globalAlpha = a;
      }
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // pop-up text
    for (const p of this.popups) {
      const a = Math.min(1, p.life / (p.max * 0.6));
      ctx.globalAlpha = a;
      const sc = Math.max(1, Math.round(p.scale));
      drawText(ctx, p.text, Math.round(p.x), Math.round(p.y), sc, p.color, 'center', p.shadow);
      ctx.globalAlpha = 1;
    }
  }
}
