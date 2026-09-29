/* ------------------------------------------------------------------
   NEON DODGE — THE DIRECTOR
   An in-game adaptive "agent" that keeps improving the experience.

   It watches how you actually play (near-misses, hits, combos, movement,
   how long your runs last) and continuously reshapes the game so it never
   goes stale or unfair:

     • DIFFICULTY   flow-tuned pressure so you're always near the edge
     • VARIETY      rotates enemy recipes / unlocks new foes to kill repetition
     • RESCUE       eases up + sends help when you're clearly struggling
     • HYPE         ramps intensity + rewards when you're dominating
     • COACHING     short, contextual callouts
     • LEARNING     a persistent player profile (localStorage) so it starts
                    each session already tuned to *you*

   Endless mode only — daily runs stay strictly seeded/identical for everyone,
   so the Director observes but never alters daily layouts.
------------------------------------------------------------------- */
import { settings, saveSettings } from './settings.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Enemy types the Director can deploy, with the moment they unlock so the
   roster grows across a run (and across a player's career). */
export const ENEMY_UNLOCKS = [
  { type: 'meteor',   level: 1, time: 0 },
  { type: 'drone',    level: 1, time: 6 },
  { type: 'hunter',   level: 2, time: 24 },
  { type: 'splitter', level: 3, time: 46 },
  { type: 'weaver',   level: 4, time: 70 },
];

export class Director {
  constructor(hooks = {}) {
    this.hooks = hooks;            // { coach(msg,tone), toast(msg) }
    this.loadProfile();
    this.resetRun();
  }

  /* -------------------------------------------------- persistent brain */
  loadProfile() {
    const p = (settings.director && typeof settings.director === 'object') ? settings.director : {};
    this.profile = {
      skill: clamp(p.skill ?? 0.4, 0, 1),        // 0 rookie .. 1 ace (EMA over runs)
      runs: p.runs ?? 0,
      avgRunTime: p.avgRunTime ?? 18,            // seconds, EMA
      grazeStyle: clamp(p.grazeStyle ?? 0.5, 0, 1), // 0 collector .. 1 daredevil
      bestFlow: p.bestFlow ?? 0,                 // longest clean flow streak (s)
    };
  }

  saveProfile() {
    settings.director = this.profile;
    saveSettings();
  }

  /* ------------------------------------------------------- per-run state */
  resetRun() {
    this.t = 0;
    this.mode = 'endless';
    this.active = false;

    this.hits = [];                // game-times of recent hits
    this.grazes = [];             // game-times of recent grazes
    this.gems = [];               // game-times of recent gem pickups
    this.lastHit = -999;
    this.lastGraze = -999;

    this.flow = 'warmup';          // warmup | flow | struggle | dominating
    this.intensity = 1;            // multiplies spawn pressure (endless)
    this.targetIntensity = 1;

    this.rescueCD = 0;             // rescue cooldown (s)
    this.hypeCD = 0;
    this.coachCD = 7;
    this.eventCD = 20;             // time to next variety "surge"

    this.rescueReady = false;      // consumed by the power-up spawner
    this.wantGemShower = false;    // consumed by the game

    this.spawnHistory = [];        // recent hazard types (anti-repetition)
    this.lastRecipe = null;
    this.cleanSince = 0;           // last time a hit happened (for flow streak)
    this.calm = 0;                 // seconds without near-death pressure
  }

  onRunStart(mode) {
    this.resetRun();
    this.mode = mode;
    this.active = mode === 'endless';
    // start each run already biased to the player's learned skill
    this.intensity = clamp(0.86 + this.profile.skill * 0.4, 0.8, 1.35);
    this.targetIntensity = this.intensity;
    if (this.active && this.profile.runs >= 1) {
      const s = this.profile.skill;
      const msg = s > 0.66 ? 'DIRECTOR: TUNED FOR AN ACE — GO WILD'
        : s < 0.34 ? 'DIRECTOR: EASING YOU IN'
        : 'DIRECTOR: DIALED TO YOUR PACE';
      this._later = { msg, tone: 'info', at: 1.4 };
    }
  }

  /* --------------------------------------------------------- observation */
  onGraze() {
    this.grazes.push(this.t);
    this.lastGraze = this.t;
  }
  onGem() { this.gems.push(this.t); }
  onHit(livesLeft) {
    this.hits.push(this.t);
    this.lastHit = this.t;
    this.cleanSince = this.t;
    this.calm = 0;
    // instant compassion: after a hit, hold fire briefly
    this.targetIntensity = Math.min(this.targetIntensity, 0.82);
    if (livesLeft <= 1) this.rescueCD = Math.min(this.rescueCD, 2.5);
  }

  recent(arr, window) {
    const cut = this.t - window;
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] >= cut) n++; else break; }
    return n;
  }

  /* ------------------------------------------------------------- update */
  update(dt, game) {
    this.t = game.time;
    // trim history so it never grows unbounded
    if (this.hits.length > 40) this.hits.splice(0, this.hits.length - 40);
    if (this.grazes.length > 80) this.grazes.splice(0, this.grazes.length - 80);
    if (this.gems.length > 60) this.gems.splice(0, this.gems.length - 60);

    if (this._later && this.t >= this._later.at) {
      this.hooks.coach && this.hooks.coach(this._later.msg, this._later.tone);
      this._later = null;
    }

    this.rescueCD = Math.max(0, this.rescueCD - dt);
    this.hypeCD = Math.max(0, this.hypeCD - dt);
    this.coachCD = Math.max(0, this.coachCD - dt);
    this.eventCD = Math.max(0, this.eventCD - dt);

    if (!this.active) return;      // daily: observe-only, never steer

    const recentHits = this.recent(this.hits, 14);
    const sinceHit = this.t - this.lastHit;
    const grazing = this.recent(this.grazes, 6);

    // --- classify the player's current flow state --------------------
    let flow;
    if (this.t < 8) flow = 'warmup';
    else if (game.lives <= 1 || recentHits >= 2) flow = 'struggle';
    else if (game.combo >= 18 && sinceHit > 16) flow = 'dominating';
    else flow = 'flow';
    if (flow !== this.flow) this.onFlowChange(flow, game);
    this.flow = flow;

    // --- pick a target intensity for this state ---------------------
    const skill = this.profile.skill;
    let target;
    if (flow === 'warmup') target = 0.9;
    else if (flow === 'struggle') target = 0.74;
    else if (flow === 'dominating') target = clamp(1.12 + skill * 0.32, 1.1, 1.5);
    else target = clamp(0.98 + skill * 0.22 + Math.min(0.18, this.calm * 0.01), 0.9, 1.35);

    // graze-happy daredevils get a touch more to skim past
    if (this.profile.grazeStyle > 0.6 && flow === 'flow') target += 0.06;

    this.targetIntensity += (target - this.targetIntensity) * Math.min(1, dt * 0.5);
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 0.7);
    game.pressure = this.intensity;

    // calm timer feeds a slow, fair ramp during long clean stretches
    if (flow === 'flow' || flow === 'dominating') this.calm += dt; else this.calm = 0;

    // --- RESCUE: struggling + low lives -> send a shield & breathe ---
    if (flow === 'struggle' && game.lives <= 1 && this.rescueCD <= 0 && !this.rescueReady) {
      this.rescueReady = true;              // spawner will drop a shield next
      this.rescueCD = 26;
      this.hooks.coach && this.hooks.coach('DIRECTOR: SHIELD INBOUND — HANG ON', 'save');
    }

    // --- HYPE: dominating -> gem shower + praise --------------------
    if (flow === 'dominating' && this.hypeCD <= 0) {
      this.wantGemShower = true;
      this.hypeCD = 16;
      this.hooks.coach && this.hooks.coach('DIRECTOR: YOU\u2019RE ON FIRE \u2014 CATCH THESE', 'hype');
    }

    // --- VARIETY: periodic themed surge so it never feels repetitive -
    if (this.eventCD <= 0 && flow !== 'struggle' && this.t > 16) {
      this.eventCD = clamp(22 - skill * 6, 14, 24);
      this.triggerSurge(game);
    }

    // --- COACHING: occasional contextual callouts -------------------
    if (this.coachCD <= 0) this.maybeCoach(game, grazing, sinceHit);
  }

  onFlowChange(flow, game) {
    if (flow === 'dominating') { this.coachCD = Math.min(this.coachCD, 1.5); }
    if (flow === 'flow' && this.flow === 'struggle') {
      this.hooks.coach && this.hooks.coach('DIRECTOR: NICE RECOVERY', 'info');
      this.coachCD = 6;
    }
  }

  maybeCoach(game, grazing, sinceHit) {
    this.coachCD = 9 + Math.random() * 5;
    if (this.flow === 'struggle') return;   // rescue line already covers it
    const lines = [];
    if (grazing === 0 && this.t > 14) lines.push('DIRECTOR: SKIM HAZARDS TO BUILD COMBO');
    if (game.combo >= 10 && game.combo < 15) lines.push('DIRECTOR: KEEP IT UP \u2014 FEVER AT 15');
    if (sinceHit > 30) lines.push('DIRECTOR: FLAWLESS \u2014 CRANKING IT UP');
    if (this.profile.grazeStyle < 0.35) lines.push('DIRECTOR: GET CLOSE FOR BIGGER SCORE');
    if (!lines.length) return;
    this.hooks.coach && this.hooks.coach(lines[(Math.random() * lines.length) | 0], 'info');
  }

  /* A surge = a short burst of a fresh recipe, chosen to differ from the
     last one so consecutive stretches never feel the same. */
  triggerSurge(game) {
    const pool = this.unlockedTypes(game).filter((t) => t !== 'meteor');
    const recipes = ['stream', 'wall', 'pincer', 'swarm'];
    let recipe;
    let guard = 0;
    do { recipe = recipes[(Math.random() * recipes.length) | 0]; }
    while (recipe === this.lastRecipe && guard++ < 4);
    this.lastRecipe = recipe;
    game.runSurge(recipe, pool);
  }

  /* ------------------------------------------------- enemy selection */
  unlockedTypes(game) {
    const out = [];
    for (const u of ENEMY_UNLOCKS) {
      if (game.level >= u.level || game.time >= u.time) out.push(u.type);
    }
    return out.length ? out : ['meteor'];
  }

  /* Weighted, anti-repetition hazard pick (endless). Types that have shown
     up a lot recently get their weight cut so the mix keeps shifting. */
  chooseType(game) {
    const types = this.unlockedTypes(game);
    const d = game.difficulty();
    const base = {
      meteor: 1.0,
      drone: 0.55 + d * 0.35,
      hunter: 0.4 + d * 0.35,
      splitter: 0.3 + d * 0.3,
      weaver: 0.35 + d * 0.3,
    };
    // fewer meteors as the run matures -> more variety later
    base.meteor = clamp(1.1 - d * 0.55, 0.4, 1.1);

    const hist = this.spawnHistory;
    const recentCount = (t) => hist.reduce((n, x) => n + (x === t ? 1 : 0), 0);
    let total = 0; const weights = [];
    for (const t of types) {
      let w = base[t] ?? 0.4;
      w /= 1 + recentCount(t) * 0.9;   // penalise repeats -> variety
      weights.push(w); total += w;
    }
    let r = Math.random() * total, chosen = types[0];
    for (let i = 0; i < types.length; i++) { r -= weights[i]; if (r <= 0) { chosen = types[i]; break; } }
    this.spawnHistory.push(chosen);
    if (this.spawnHistory.length > 6) this.spawnHistory.shift();
    return chosen;
  }

  /* --------------------------------------------------------- run wrap */
  onRunEnd(stats) {
    // Learn from this run. Compare survival to the player's rolling average
    // and nudge the skill estimate; longer/cleaner runs -> higher skill.
    const t = stats.time || 0;
    const prevAvg = this.profile.avgRunTime || 18;
    this.profile.avgRunTime = prevAvg * 0.7 + t * 0.3;

    const performance = clamp((t - 10) / 70, 0, 1);         // 10s..80s -> 0..1
    const comboFactor = clamp((stats.bestCombo || 0) / 30, 0, 0.4);
    const sample = clamp(performance * 0.8 + comboFactor, 0, 1);
    this.profile.skill = clamp(this.profile.skill * 0.72 + sample * 0.28, 0.05, 1);

    // are they a daredevil (grazes) or a collector (gems)?
    const g = (stats.grazes || 0) + 1, gm = (stats.gems || 0) + 1;
    const style = clamp(g / (g + gm * 1.4), 0, 1);
    this.profile.grazeStyle = this.profile.grazeStyle * 0.75 + style * 0.25;

    this.profile.runs = (this.profile.runs || 0) + 1;
    this.saveProfile();
    return { skill: this.profile.skill, runs: this.profile.runs };
  }

  /* Human-readable one-liner for the game-over screen. */
  summary() {
    const s = this.profile.skill;
    const tier = s > 0.75 ? 'ACE' : s > 0.55 ? 'SHARP' : s > 0.35 ? 'STEADY' : 'ROOKIE';
    return { tier, skill: s, runs: this.profile.runs };
  }
}
