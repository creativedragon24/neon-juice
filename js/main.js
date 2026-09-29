/* ------------------------------------------------------------------
   Boot, input, UI wiring, PWA install.
   DOM/UI animation: anime.js   ·   celebration: canvas-confetti
------------------------------------------------------------------- */
import { Game, POWER } from './game.js';
import { settings, setSetting, saveSettings } from './settings.js';
import { Music, SFX, unlockAudio } from './audio.js';
import { vibrate, HAPTIC } from './juice.js';

const anime = window.anime;
const confetti = window.confetti;
const $ = (s) => document.querySelector(s);

const canvas = $('#game');
const game = new Game(canvas, { onHud, onGameOver, onCoach });
window.__game = game;              // handy for tinkering in devtools
Music.onBeat((s) => game.beat(s));

/* Device-aware control copy: laptops get the keyboard/mouse line,
   touch devices keep the one-finger wording. */
if (window.matchMedia && window.matchMedia('(any-pointer: fine)').matches) {
  const tag = document.querySelector('#menu .tag');
  if (tag) tag.innerHTML = 'mouse / WASD / drag &middot; shift = boost &middot; space = play';
  const h0 = document.querySelector('#hints .hint');
  if (h0) h0.textContent = 'DRAG, MOUSE OR WASD TO DODGE';
}

/* ------------------------------------------------------------ assets */
const FILES = {
  player: 'assets/player.png',
  meteor: 'assets/meteor.png',
  drone: 'assets/drone.png',
  gem: 'assets/gem.png',
  powerup: 'assets/powerup.png',
  stars: 'assets/bg_stars.png',
  skyline: 'assets/bg_skyline.png',
};

function tint(img, color, amount = 0.82) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = amount;
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

let booted = false;
const bootEl = $('#boot');
let loadedCount = 0;
const totalAssets = Object.keys(FILES).length;
bootEl.textContent = `LOADING 0/${totalAssets}`;

Promise.all(
  Object.entries(FILES).map(async ([k, f]) => {
    const img = await loadImage(f);
    loadedCount++;
    bootEl.textContent = `LOADING ${loadedCount}/${totalAssets}`;
    return [k, img];
  })
)
  .then((pairs) => {
    const sprites = Object.fromEntries(pairs);
    for (const k of Object.keys(POWER)) sprites['pw_' + k] = tint(sprites.powerup, POWER[k].color);
    // The Director's extra enemy roster: tinted variants of the base sprites so
    // new foes read as distinct without shipping more art.
    sprites.hunter = tint(sprites.drone, '#b45cff');
    sprites.weaver = tint(sprites.drone, '#38f5ff');
    sprites.splitter = tint(sprites.meteor, '#4dff9e');
    sprites.shard = tint(sprites.meteor, '#7dffb0');
    game.setSprites(sprites);
    booted = true;
    document.body.classList.add('ready');
    if (anime) {
      anime({
        targets: '#menu .stagger',
        translateY: [26, 0],
        opacity: [0, 1],
        scale: [0.86, 1],
        duration: 780,
        delay: anime.stagger(70, { start: 120 }),
        easing: 'easeOutElastic(1, .7)',
      });
      anime({ targets: '#menu .title span', rotate: [-6, 0], opacity: [0, 1], duration: 700, delay: anime.stagger(160), easing: 'easeOutBack' });
    }
  })
  .catch((e) => { console.error('asset load failed', e); $('#boot').textContent = 'asset error'; });

/* ------------------------------------------------------------- input */
function toWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * game.W,
    y: ((clientY - r.top) / r.height) * game.H,
  };
}
function onDown(e) {
  unlockAudio();
  const p = toWorld(e.clientX, e.clientY);
  game.input.active = true;
  game.input.x = p.x;
  game.input.y = p.y;
  if (e.pointerId != null && canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
}
function onMove(e) {
  // laptops/desktops: the mouse steers on hover, no click needed;
  // touch keeps press-and-drag so a resting thumb never moves the ship
  if (!game.input.active && e.pointerType !== 'mouse') return;
  if (e.pointerType === 'mouse') game.input.active = true;
  const p = toWorld(e.clientX, e.clientY);
  game.input.x = p.x;
  game.input.y = p.y;
}
function onUp(e) { if (e.pointerType !== 'mouse') game.input.active = false; }

canvas.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove, { passive: true });
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
window.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = {};
window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = e.key.toLowerCase();
  // keep arrows/space from scrolling the page while playing
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  if (k === 'shift') game.input.boost = true;
  keys[k] = true;
  updateKeys();
  if (k === ' ' || k === 'enter') {
    e.preventDefault();
    if (game.state === 'menu') startRun();
    else if (game.state === 'over') startRun(true);
  }
  if (k === 'r' && game.state === 'over') { e.preventDefault(); SFX.ui(); startRun(true); }
  if (k === 'm') toggle('sfx');
  if (k === 'f') { game.showFps = !game.showFps; SFX.ui(); }
  if (k === 'escape' || k === 'p') {
    SFX.ui();
    if (game.state === 'play') { if (game.pause()) show('#pause'); }
    else if (game.state === 'paused') { hide('#pause'); game.resume(); }
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'shift') game.input.boost = false;
  keys[k] = false;
  updateKeys();
});
function updateKeys() {
  const l = keys.arrowleft || keys.a ? 1 : 0;
  const r = keys.arrowright || keys.d ? 1 : 0;
  const u = keys.arrowup || keys.w ? 1 : 0;
  const d = keys.arrowdown || keys.s ? 1 : 0;
  game.input.kx = r - l;
  game.input.ky = d - u;
}

/* ---------------------------------------------------------------- HUD */
const elScore = $('#score');
const elBest = $('#best');
const elMult = $('#mult');
const elCombo = $('#combo-fill');
let lastCombo = 0;

function onHud(s) {
  elScore.textContent = s.score;
  elMult.textContent = 'x' + s.mult.toFixed(1);
  if (s.combo > lastCombo && anime) {
    anime.remove(elScore);
    anime({ targets: elScore, scale: [1.45, 1], duration: 520, easing: 'easeOutElastic(1, .5)' });
    anime.remove(elMult);
    anime({ targets: elMult, scale: [1.5, 1], duration: 520, easing: 'easeOutElastic(1, .5)' });
  }
  lastCombo = s.combo;
  elScore.style.color = s.combo > 0 ? `hsl(${(310 - s.combo * 4) % 360}, 100%, 68%)` : '';
  const fv = $('#fever');
  if (s.fever && fv.classList.contains('hidden')) {
    fv.classList.remove('hidden');
    if (anime) anime({ targets: fv, scale: [2, 1], duration: 700, easing: 'easeOutElastic(1, .4)' });
  } else if (!s.fever && !fv.classList.contains('hidden')) {
    fv.classList.add('hidden');
  }
}

/* --------------------------------------------------- Director coach line */
let coachT;
function onCoach(msg, tone = 'info') {
  const el = $('#coach');
  if (!el) return;
  el.textContent = msg;
  el.className = 'coach ' + tone;         // base + tone modifier
  el.classList.remove('hidden');
  if (anime) { anime.remove(el); anime({ targets: el, translateY: [-12, 0], opacity: [0, 1], scale: [0.92, 1], duration: 320, easing: 'easeOutBack' }); }
  clearTimeout(coachT);
  coachT = setTimeout(() => el.classList.add('hidden'), 2700);
}

/* ------------------------------------------------ retention: streaks */
const todayStr = () => new Date().toISOString().slice(0, 10);
function bumpStreak() {
  const today = todayStr();
  if (settings.lastPlayed === today) { if (!settings.streak) settings.streak = 1; return; }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  settings.streak = settings.lastPlayed === yesterday ? (settings.streak || 0) + 1 : 1;
  settings.lastPlayed = today;
  saveSettings();
}
function renderStreak() {
  const chip = $('#streak-chip');
  if (!chip) return;
  const n = settings.streak || 0;
  if (n >= 2) { chip.textContent = `\uD83D\uDD25 ${n}-DAY STREAK`; chip.classList.remove('hidden'); }
  else chip.classList.add('hidden');
}

/* --------------------------------------------- retention: achievements */
const ACHIEVEMENTS = [
  { id: 'first',    name: 'FIRST FLIGHT',   test: () => true },
  { id: 'combo25',  name: 'COMBO x25',      test: (st) => st.bestCombo >= 25 },
  { id: 'survive60',name: 'MINUTE MASTER',  test: (st) => st.time >= 60 },
  { id: 'level5',   name: 'DEEP DIVER',     test: (st) => st.level >= 5 },
  { id: 'gems25',   name: 'GEM HOARDER',    test: (st) => st.gems >= 25 },
  { id: 'graze50',  name: 'DAREDEVIL',      test: (st) => st.grazes >= 50 },
  { id: 'runs10',   name: 'REGULAR',        test: () => (settings.runs || 0) >= 10 },
  { id: 'streak3',  name: '3-DAY STREAK',   test: () => (settings.streak || 0) >= 3 },
];
function checkAchievements(st) {
  if (!Array.isArray(settings.achievements)) settings.achievements = [];
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (settings.achievements.includes(a.id)) continue;
    if (a.test(st)) { settings.achievements.push(a.id); earned.push(a); }
  }
  if (earned.length) {
    saveSettings();
    earned.forEach((a, i) => setTimeout(() => { toast(`\uD83C\uDFC6 UNLOCKED — ${a.name}`); SFX.levelUp && SFX.levelUp(); }, 900 + i * 1500));
    setTimeout(() => celebrate(), 900);
  }
}

/* A personalised "one more run" goal to pull the player back in. */
function nextGoal(st) {
  const best = st.best || 0;
  if (best && st.score < best) return `${best - st.score} PTS TO BEAT YOUR BEST`;
  if (st.level < 5) return `REACH LEVEL 5 (YOU HIT ${st.level})`;
  if (st.bestCombo < 25) return `LAND A x25 COMBO (BEST ${st.bestCombo})`;
  if (st.time < 90) return `SURVIVE 90S (YOU LASTED ${st.time.toFixed(0)}S)`;
  return 'CAN YOU SET A NEW RECORD?';
}

/* ------------------------------------------------------------- screens */
function show(sel) { $(sel).classList.remove('hidden'); }
function hide(sel) { $(sel).classList.add('hidden'); }

function popIn(sel) {
  if (!anime) return;
  anime.remove(sel);
  anime({ targets: sel, opacity: [0, 1], scale: [0.8, 1], duration: 620, easing: 'easeOutElastic(1, .6)' });
}

function showHints() {
  if (settings.seenTutorial) return;
  const el = $('#hints');
  const lines = [...el.querySelectorAll('.hint')];
  lines.forEach((l) => l.classList.add('hidden'));
  el.classList.remove('hidden');
  let i = 0;
  const next = () => {
    if (i > 0) lines[i - 1].classList.add('hidden');
    if (i >= lines.length) {
      el.classList.add('hidden');
      setSetting('seenTutorial', true);
      return;
    }
    lines[i].classList.remove('hidden');
    if (anime) {
      anime.remove(lines[i]);
      anime({ targets: lines[i], translateY: [16, 0], opacity: [0, 1], scale: [0.9, 1], duration: 520, easing: 'easeOutElastic(1, .7)' });
    }
    i++;
    setTimeout(next, 2300);
  };
  next();
}

function startRun(fast = false) {
  unlockAudio();
  bumpStreak();
  hide('#menu'); hide('#over'); hide('#pause');
  $('#hints').classList.add('hidden');
  $('#hud').classList.remove('dim');
  // "Play again" gets a snappy restart (no long 3-2-1) so the retry loop is tight.
  let n = fast ? 0 : 3;
  const el = $('#countdown');
  el.classList.remove('hidden');
  const step = () => {
    if (n > 0) {
      el.textContent = n;
      SFX.countdown(n);
      vibrate(12);
      if (anime) { anime.remove(el); anime({ targets: el, scale: [2.4, 1], opacity: [0.2, 1], duration: 520, easing: 'easeOutElastic(1, .45)' }); }
      n--;
      setTimeout(step, 520);
    } else {
      el.textContent = 'GO!';
      SFX.countdown(0);
      vibrate([15, 25, 15]);
      if (anime) { anime.remove(el); anime({ targets: el, scale: [3, 1], opacity: [1, 0], duration: 620, easing: 'easeOutQuint' }); }
      setTimeout(() => { el.classList.add('hidden'); el.textContent = ''; }, 620);
      game.startRun();
      showHints();
    }
  };
  step();
}

let lastEntry = null;

function renderBoards() {
  const mode = settings.mode === 'daily' ? 'daily' : 'endless';
  const list = (settings.scores || []).filter((e) => (e.m || 'endless') === mode);
  const html = list.length
    ? list.map((e, i) => `<div class="brow${lastEntry && e.d === lastEntry.d ? ' fresh' : ''}">` +
        `<span class="rk">${i + 1}</span><span class="sc">${e.s}</span>` +
        `<span class="meta">${e.t}S &middot; LV${e.l}</span></div>`).join('')
    : '<div class="brow empty">NO RUNS YET</div>';
  $('#board').innerHTML = html;
  $('#menu-board').innerHTML = html;
}

function pushScore(entry) {
  const list = (settings.scores || []).slice();
  list.push(entry);
  list.sort((a, b) => b.s - a.s);
  settings.scores = list.slice(0, 5);
  saveSettings();
  renderBoards();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  if (anime) { anime.remove(t); anime({ targets: t, translateY: [12, 0], opacity: [0, 1], duration: 320, easing: 'easeOutQuad' }); }
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 1900);
}

function onGameOver(st) {
  $('#hud').classList.add('dim');
  $('#final-score').textContent = '0';
  $('#st-time').textContent = st.time.toFixed(1) + 's';
  $('#st-graze').textContent = st.grazes;
  $('#st-gems').textContent = st.gems;
  $('#st-combo').textContent = st.bestCombo;
  $('#st-level').textContent = st.level;
  $('#menu-best').textContent = st.best;
  elBest.textContent = st.best;
  show('#over');
  popIn('#over .card');
  if (anime) {
    anime({
      targets: { v: 0 }, v: st.score, round: 1, duration: 1100, easing: 'easeOutExpo',
      update: (a) => { $('#final-score').textContent = a.animations[0].currentValue; },
    });
  } else {
    $('#final-score').textContent = st.score;
  }
  lastEntry = { s: st.score, t: +st.time.toFixed(1), l: st.level, d: Date.now(), m: st.mode };
  $('#seed-line').textContent = st.mode === 'daily'
    ? `DAILY ${new Date().toISOString().slice(0, 10)} \u00b7 SEED ${st.seed}`
    : `ENDLESS \u00b7 SEED ${st.seed}`;
  pushScore(lastEntry);

  // Director read-out: shows the agent's learned take on the player
  const dl = $('#dir-line');
  if (dl && st.director) {
    dl.textContent = `DIRECTOR: ${st.director.tier} \u00b7 SKILL ${Math.round(st.director.skill * 100)}% \u00b7 RUN #${st.director.runs}`;
  }
  // "one more run" goal
  const gl = $('#goal-line');
  if (gl) {
    if (st.mode === 'endless') { gl.textContent = `NEXT: ${nextGoal(st)}`; gl.classList.remove('hidden'); }
    else gl.classList.add('hidden');
  }

  renderStreak();
  checkAchievements(st);

  if (st.isBest) {
    $('#newbest').classList.remove('hidden');
    if (anime) anime({ targets: '#newbest', scale: [0, 1], rotate: [-8, 0], duration: 800, delay: 250, easing: 'easeOutElastic(1, .5)' });
    celebrate();
  } else {
    $('#newbest').classList.add('hidden');
  }
}

function celebrate() {
  if (!confetti) return;
  const colors = ['#38f5ff', '#ff2e88', '#ffd23f', '#4dff9e', '#ffffff'];
  confetti({ particleCount: 90, spread: 78, startVelocity: 42, origin: { x: 0.5, y: 0.62 }, colors, scalar: 1.1, ticks: 220 });
  setTimeout(() => confetti({ particleCount: 60, spread: 120, startVelocity: 34, origin: { x: 0.2, y: 0.7 }, colors, scalar: 0.9 }), 220);
  setTimeout(() => confetti({ particleCount: 60, spread: 120, startVelocity: 34, origin: { x: 0.8, y: 0.7 }, colors, scalar: 0.9 }), 380);
}

/* ------------------------------------------------------------ buttons */
$('#btn-play').addEventListener('click', () => { SFX.ui(); vibrate(HAPTIC.ui); startRun(); });
$('#btn-retry').addEventListener('click', () => { SFX.ui(); vibrate(HAPTIC.ui); startRun(true); });
$('#btn-menu').addEventListener('click', () => {
  SFX.ui(); vibrate(HAPTIC.ui);
  hide('#over'); show('#menu');
  game.toMenu();
  $('#hud').classList.add('dim');
  popIn('#menu');
});

$('#btn-resume').addEventListener('click', () => { SFX.ui(); vibrate(HAPTIC.ui); hide('#pause'); game.resume(); });
$('#btn-quit').addEventListener('click', () => {
  SFX.ui(); vibrate(HAPTIC.ui);
  hide('#pause'); hide('#over'); show('#menu');
  game.toMenu();
  $('#hud').classList.add('dim');
  popIn('#menu');
});

function toggle(name) {
  setSetting(name, !settings[name]);
  syncToggles();
  if (name === 'music') { settings.music ? (game.state === 'play' ? Music.start() : null) : Music.stop(); }
  SFX.ui(settings[name]); // two-pitch tick: up = on, down = off
  vibrate(HAPTIC.ui);
}
function syncToggles() {
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    const on = !!settings[b.dataset.toggle];
    b.classList.toggle('off', !on);
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.state').textContent = on ? 'ON' : 'OFF';
  });
}
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle)));
syncToggles();

function syncJuice() {
  document.querySelectorAll('[data-juice]').forEach((b) => {
    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.juice) - settings.juice) < 0.01);
  });
}
document.querySelectorAll('[data-juice]').forEach((b) =>
  b.addEventListener('click', () => {
    setSetting('juice', parseFloat(b.dataset.juice));
    syncJuice();
    SFX.ui();
    vibrate(HAPTIC.ui);
    game.fx.shake(0.5);
    game.fx.flash('#ffd23f', 0.25);
  })
);
syncJuice();

$('#btn-standalone').addEventListener('click', () => { location.href = 'neon-dodge-standalone.html'; });

$('#btn-share').addEventListener('click', async () => {
  SFX.ui(); vibrate(HAPTIC.ui);
  if (!lastEntry) return;
  const text = `NEON DODGE — ${lastEntry.s} pts in ${lastEntry.t}s (level ${lastEntry.l}). Beat that.`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Neon Dodge', text, url: location.href }); return; }
    await navigator.clipboard.writeText(text + ' ' + location.href);
    toast('COPIED TO CLIPBOARD');
  } catch (e) { toast('SHARE CANCELLED'); }
});

renderBoards();
renderStreak();

/* --------------------------------------------------------------- PWA */
let deferredPrompt = null;
const IS_STANDALONE =
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true;
const IS_IOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').classList.remove('hidden');
});
$('#btn-install').addEventListener('click', async () => {
  SFX.ui();
  try { localStorage.setItem('neon-dodge-install-nudge', '1'); } catch (e) {}
  if (!deferredPrompt) {
    $('#install-help').classList.remove('hidden');
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') $('#btn-install').classList.add('hidden');
  deferredPrompt = null;
});
window.addEventListener('appinstalled', () => {
  $('#btn-install').classList.add('hidden');
  $('#install-help').classList.add('hidden');
  toast('INSTALLED — SEE YOU ON THE HOME SCREEN');
  celebrate();
});

/* iOS has no beforeinstallprompt: show the Share -> Add to Home Screen
   hint on Apple touch devices instead of a silent dead end. */
if (IS_IOS && !IS_STANDALONE) $('#install-help').classList.remove('hidden');

/* The install pop: a few seconds after the game is open, put the offer in
   front of the player once. Native prompt on Chromium, banner + iOS steps
   elsewhere. Never nags twice (dismissed flag in localStorage). */
function installNudge() {
  if (IS_STANDALONE) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem('neon-dodge-install-nudge') === '1'; } catch (e) {}
  if (dismissed) return;
  const btn = $('#btn-install');
  btn.classList.remove('hidden');
  btn.classList.add('pulse');
  toast(IS_IOS ? 'ADD TO HOME SCREEN FOR FULL-SCREEN PLAY' : 'INSTALL NEON DODGE — PLAYS OFFLINE');
}
setTimeout(() => {
  if (document.body.classList.contains('ready')) installNudge();
}, 5000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* -------------------------------------------------------------- loop */
window.addEventListener('resize', () => game.resize());
window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 220));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (game.pause()) show('#pause');
  else Music.stop();
});
window.addEventListener('blur', () => { if (game.pause()) show('#pause'); });

const bestFor = (m) => (settings.bests && settings.bests[m]) || 0;

function syncMode() {
  const m = settings.mode === 'daily' ? 'daily' : 'endless';
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  $('#mode-chip').textContent = m.toUpperCase();
  elBest.textContent = bestFor(m);
  $('#menu-best').textContent = bestFor(m);
  renderBoards();
}
document.querySelectorAll('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    setSetting('mode', b.dataset.mode === 'daily' ? 'daily' : 'endless');
    syncMode();
    SFX.ui();
    vibrate(HAPTIC.ui);
    toast(b.dataset.mode === 'daily' ? 'DAILY — SAME LAYOUT FOR EVERYONE' : 'ENDLESS — FRESH LAYOUT EVERY RUN');
  })
);
syncMode();

elBest.textContent = bestFor(settings.mode);
$('#menu-best').textContent = bestFor(settings.mode);

// Battery hint: start on the low tier when the device is nearly dead (docs/10)
if (typeof navigator.getBattery === 'function') {
  navigator.getBattery()
    .then((b) => { if (b && !b.charging && b.level < 0.2) game.setQuality(2); })
    .catch(() => {});
}

const MIN_FRAME_MS = 1000 / 62;   // don't render faster than ~60fps: halves battery on 120Hz screens
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const elapsed = now - last;
  if (booted && elapsed < MIN_FRAME_MS - 1) return;
  last = now;
  if (booted) {
    game.frame(elapsed / 1000);
    const t = Math.max(0, Math.min(1, game.comboTimer / 2.6));
    elCombo.style.width = (game.combo > 0 ? t * 100 : 0) + '%';
  }
}
requestAnimationFrame(loop);
