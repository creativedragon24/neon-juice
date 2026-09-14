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
const game = new Game(canvas, { onHud, onGameOver });
window.__game = game;              // handy for tinkering in devtools
Music.onBeat((s) => game.beat(s));

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
  if (!game.input.active) return;
  const p = toWorld(e.clientX, e.clientY);
  game.input.x = p.x;
  game.input.y = p.y;
}
function onUp() { game.input.active = false; }

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
  keys[k] = true;
  updateKeys();
  if (k === ' ' || k === 'enter') {
    e.preventDefault();
    if (game.state === 'menu') startRun();
    else if (game.state === 'over') startRun();
  }
  if (k === 'm') toggle('sfx');
  if (k === 'f') { game.showFps = !game.showFps; SFX.ui(); }
  if (k === 'escape' || k === 'p') {
    SFX.ui();
    if (game.state === 'play') { if (game.pause()) show('#pause'); }
    else if (game.state === 'paused') { hide('#pause'); game.resume(); }
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; updateKeys(); });
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

function startRun() {
  unlockAudio();
  hide('#menu'); hide('#over'); hide('#pause');
  $('#hints').classList.add('hidden');
  $('#hud').classList.remove('dim');
  let n = 3;
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
$('#btn-retry').addEventListener('click', () => { SFX.ui(); vibrate(HAPTIC.ui); startRun(); });
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
  SFX.ui();
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

/* --------------------------------------------------------------- PWA */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').classList.remove('hidden');
});
$('#btn-install').addEventListener('click', async () => {
  SFX.ui();
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
});

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
