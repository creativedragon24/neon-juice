/* ------------------------------------------------------------------
   Procedural audio - no audio files, everything synthesised by ZzFX.
   https://github.com/KilledByAPixel/ZzFX  (MIT)
   Param order: [vol, randomness, freq, attack, sustain, release, shape,
   shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
   noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo]

   Mix design (v2):
   · every voice is routed sfxBus / musicBus -> master gain -> compressor
     -> speakers, so stacked layers (fever + explosions + music) glue
     together instead of clipping;
   · one-shots get subtle pitch/level humanisation so repeats never
     sound machine-gunned;
   · positional stereo: impacts pan with the player's x position;
   · the music bus ducks when you get hit, so SFX always cut through;
   · the graze ladder climbs a minor-pentatonic scale, not linear Hz.
------------------------------------------------------------------- */
import { ZZFX } from '../vendor/zzfx.min.js';
import { settings } from './settings.js';

ZZFX.volume = 0.4;

const ac = () => ZZFX.audioContext;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------- mix buses */
let master = null;
let sfxBus = null;
let musicBus = null;

function buses() {
  if (master) return;
  const c = ac();
  if (!c) return;
  master = c.createGain();
  master.gain.value = 0.9;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 18;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.24;
  master.connect(comp);
  comp.connect(c.destination);
  sfxBus = c.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(master);
  musicBus = c.createGain();
  musicBus.gain.value = 0.95;
  musicBus.connect(master);
}

export function unlockAudio() {
  buses();
  const c = ac();
  if (c && c.state !== 'running') c.resume().catch(() => {});
}
if (typeof window !== 'undefined') {
  ['pointerdown', 'touchstart', 'keydown'].forEach((e) =>
    window.addEventListener(e, unlockAudio, { passive: true })
  );
  // save the battery on hidden tabs: suspend the context with the page
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      const c = ac();
      if (!c) return;
      if (document.hidden) c.suspend().catch(() => {});
      else c.resume().catch(() => {});
    });
  }
}

/* One voice through the mix. `bus` = sfxBus | musicBus.
   Callers gate on settings.sfx / settings.music. */
function voice(bus, params, vol = 1, pan = 0, humanize = 0.015) {
  const p = params.slice();
  p[0] = (p[0] == null ? 1 : p[0]) * vol * (1 + (Math.random() * 2 - 1) * 0.08);
  if (humanize && p[2] && (p[1] == null || p[1] < 0.05)) {
    p[2] *= 1 + (Math.random() * 2 - 1) * humanize;
  }
  buses();
  if (!master) return;
  try {
    const c = ac();
    const samples = ZZFX.buildSamples(...p);
    const buf = c.createBuffer(1, samples.length, ZZFX.sampleRate);
    buf.getChannelData(0).set(samples);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = 1;
    let node = src;
    if (c.createStereoPanner && pan) {
      const pn = c.createStereoPanner();
      pn.pan.value = clamp(pan, -1, 1);
      node.connect(pn);
      node = pn;
    }
    node.connect(g);
    g.connect(bus);
    src.start();
  } catch (e) {
    /* context not ready yet - stay silent */
  }
}

function play(params, vol = 1, pan = 0) {
  if (!settings.sfx) return;
  buses();
  if (sfxBus) voice(sfxBus, params, vol, pan);
}
function playMusic(params, vol = 1, pan = 0) {
  if (!settings.music) return;
  buses();
  if (musicBus) voice(musicBus, params, vol, pan, 0.006);
}

/* Duck the music so a big SFX moment cuts through, then float back up. */
function duckMusic(depth = 0.6, secs = 0.9) {
  if (!musicBus) return;
  const c = ac();
  const g = musicBus.gain;
  const t = c.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(1 - depth, t + 0.045);
  g.linearRampToValueAtTime(0.95, t + secs);
}

const semi = (f, n) => f * Math.pow(2, n / 12);
const PENT = [0, 3, 5, 7, 10]; // minor pentatonic ladder for grazes
const pentAt = (f, n) => semi(f, PENT[n % 5] + 12 * Math.floor(n / 5));

/* ------------------------------------------------------------ one shots */
export const SFX = {
  graze(n = 0, pan = 0) {
    const step = Math.min(n, 24);
    play([0.22, 0.03, pentAt(660, step), 0, 0.015, 0.07, 1, 1.6, 1.2], 1, pan * 0.5);
  },
  gem(n = 0, pan = 0) {
    const f = pentAt(620, Math.min(n, 24));
    play([0.5, 0.02, f, 0, 0.05, 0.22, 1, 1.3, 0, 0, 0.5, 0.06], 1, pan * 0.4);
    play([0.28, 0.02, f * 1.5, 0, 0.04, 0.26, 0, 1, 0, 0, 0.5, 0.06], 1, pan * 0.4);
    play([0.2, 0, f * 2, 0, 0.03, 0.3, 0, 1], 1, -pan * 0.3);
  },
  hit(pan = 0) {
    play([1.0, 0.2, 210, 0, 0.05, 0.5, 2, 1.2, -1, 0, 0, 0, 0, 1.4, 0.6, 2], 1, pan);
    play([0.9, 0.1, 95, 0, 0.06, 0.4, 1, 1, -0.9], 1, pan * 0.6);
    duckMusic(0.65, 0.9);
  },
  explode(pan = 0) {
    play([1.2, 0.3, 150, 0, 0.12, 1.0, 2, 1.4, -0.6, 0, 0, 0, 0, 2.6, 0.5, 4], 1, pan);
    play([1.0, 0.2, 70, 0, 0.2, 0.9, 1, 1, -0.5], 1, pan * 0.5);
    play([0.5, 0.4, 900, 0, 0.05, 0.5, 0, 1, -3, 0, 0, 0, 0, 1.5], 1, -pan * 0.6);
    duckMusic(0.7, 1.1);
  },
  levelUp() {
    [0, 4, 7, 12, 16].forEach((n, i) =>
      setTimeout(() => play([0.42, 0.01, semi(440, n), 0, 0.06, 0.22, 1, 1.2], 1, (i - 2) * 0.18), i * 65)
    );
    play([0.4, 0, 220, 0, 0.25, 0.4, 2, 1, 4]);
  },
  ui(on) {
    // two-pitch tick so toggles audibly read on/off
    play(on === false ? [0.3, 0.01, 390, 0, 0.01, 0.06, 2, 1, -1.4] : [0.3, 0.01, 520, 0, 0.01, 0.06, 2, 1, 1.2]);
  },
  start() { play([0.45, 0, 180, 0.01, 0.2, 0.25, 1, 1, 4]); },
  comboBreak() {
    play([0.26, 0.02, 320, 0, 0.05, 0.2, 1, 1, -2]);
    duckMusic(0.35, 0.5);
  },
  gameOver() {
    duckMusic(0.85, 1.6);
    play([0.6, 0.05, 420, 0, 0.35, 0.6, 2, 1, -6]);
    setTimeout(() => play([0.5, 0.05, 220, 0, 0.4, 0.7, 1, 1, -4]), 140);
    setTimeout(() => play([0.7, 0.2, 120, 0, 0.3, 1.2, 2, 1, -0.5, 0, 0, 0, 0, 2]), 300);
  },
  countdown(n) { play([0.4, 0.01, n === 0 ? 880 : 440, 0, 0.04, 0.16, 1, 1.2]); },
  power(kind) {
    const base = kind === 'shield' ? 520 : kind === 'magnet' ? 430 : 660;
    [0, 7, 12, 19].forEach((n, i) =>
      setTimeout(() => play([0.42, 0.01, semi(base, n), 0, 0.05, 0.2, 1, 1.3], 1, (i - 1.5) * 0.22), i * 55)
    );
    play([0.35, 0, 200, 0, 0.16, 0.32, 2, 1, 3]);
  },
  charge() {
    play([0.28, 0.02, 150, 0, 1.25, 0.25, 2, 1.1, 7]);        // rising warn tone
    play([0.14, 0.05, 900, 0, 0.05, 0.12, 0, 1], 1, 0.2);
  },
  beam(pan = 0) {
    play([0.9, 0.15, 320, 0, 0.1, 0.75, 2, 1.2, -2.5, 0, 0, 0, 0, 2.2, 0.6], 1, pan);
    play([0.8, 0.05, 90, 0, 0.35, 0.6, 1, 1, -0.7], 1, pan * 0.5);
    play([0.45, 0.1, 1800, 0, 0.04, 0.3, 0, 1, -3], 1, -pan * 0.4);
    duckMusic(0.5, 0.8);
  },
  shieldBreak(pan = 0) {
    play([0.85, 0.12, 760, 0, 0.04, 0.42, 1, 1.2, -5, 0, 0, 0, 0, 1.7, 0.5], 1, pan);
    play([0.5, 0.06, 300, 0, 0.1, 0.5, 0, 1, 0, 0, 0, 0, 0, 0.9], 1, pan * 0.6);
    play([0.4, 0.05, 1200, 0, 0.03, 0.3, 0, 1, -2], 1, -pan * 0.5);
    duckMusic(0.55, 0.8);
  },
};

/* -------------------------------------------------------------- music */
let beatCb = null;
let musicTimer = null;
let step = 0;
let nextStepAt = 0;
let level = 0;
let fever = false;
let slow = false;
/* Layered music intensity (0..3) - layers stack in as the run heats up:
   0 core kick+bass · 1 +snare · 2 +hats · 3 +arpeggio lead. */
let intensity = 1;

const BPM_BASE = 126;
const ROOT = 55; // A1
// 16 step patterns
const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const HAT = [0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1];
const BASS = [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 3, 0, 10];
const ARP  = [0, 7, 12, 15, 12, 7, 15, 19, 0, 7, 12, 15, 19, 15, 12, 7];

function stepDuration() {
  const bpm = Math.min(200, Math.max(70, BPM_BASE + level * 7 + (fever ? 16 : 0) - (slow ? 40 : 0)));
  return 60 / bpm / 4;
}

function layers() { return fever ? 3 : intensity; }   // fever always runs the full stack

function tick() {
  const s = step % 16;
  const L = layers();
  if (KICK[s]) {
    playMusic([0.6, 0.02, 150, 0, 0.03, 0.16, 1, 1, -1.4], 0.9);
    if (beatCb) beatCb(s === 0 ? 1 : 0.62);
  }
  if (L >= 1 && SNARE[s]) playMusic([0.3, 0.15, 420, 0, 0.02, 0.13, 0, 1, 0, 0, 0, 0, 0, 1.7], 0.8, 0.12);
  if (L >= 2 && (HAT[s] || (fever && s % 2 === 1)))
    playMusic([0.12, 0.2, 5200, 0, 0.005, 0.035, 0, 1, 0, 0, 0, 0, 0, 1.3], 0.7, s % 4 === 2 ? 0.35 : -0.35);
  if (BASS[s] !== 0 || s % 4 === 0) {
    const f = semi(ROOT, BASS[s] + Math.min(level, 5) + (fever ? 12 : 0) - (slow ? 5 : 0));
    playMusic([0.3, 0.01, f, 0, 0.08, 0.13, 2, 0.9, 0, 0, 0, 0, 0, 0.15, 0.4], 0.85);
  }
  if (L >= 3 && ARP[s] != null) {
    const f = semi(ROOT * 4, ARP[s] + (fever ? 12 : 0) - (slow ? 5 : 0));
    // the lead wanders across the stereo field, step by step
    playMusic([0.11, 0.01, f, 0, 0.02, 0.10, 1, 1.1, 0, 0, 0, 0, 0, 0.2], 0.75, ((s * 7) % 5 - 2) * 0.22);
  }
  step++;
  schedule();
}

function schedule() {
  if (!musicTimer) return;
  const now = performance.now() / 1000;
  const delay = Math.max(0, (nextStepAt - now) * 1000);
  nextStepAt += stepDuration();
  clearTimeout(musicTimer);
  musicTimer = setTimeout(tick, delay);
}

export const Music = {
  start() {
    if (musicTimer) return;
    unlockAudio();
    step = 0;
    nextStepAt = performance.now() / 1000 + 0.06;
    musicTimer = setTimeout(tick, 60);
  },
  stop() {
    clearTimeout(musicTimer);
    musicTimer = null;
  },
  setLevel(n) { level = n; },
  setIntensity(n) { intensity = Math.max(0, Math.min(3, Math.round(n) || 0)); },
  get intensity() { return layers(); },
  setFever(v) { fever = !!v; },
  setSlow(v) { slow = !!v; },
  onBeat(cb) { beatCb = cb; },
  get running() { return !!musicTimer; },
};
