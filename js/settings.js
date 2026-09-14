/* Persisted user settings (localStorage). No imports - safe to load anywhere. */
const KEY = 'neon-dodge-v1';

const DEFAULTS = {
  sfx: true,
  music: true,
  haptics: true,
  shake: true,
  juice: 1,        // 0.4 subtle · 1 normal · 1.6 insane
  mode: 'endless', // 'endless' | 'daily' (seeded, same for everyone)
  reduceFlash: false,
  bests: { endless: 0, daily: 0 },
  runs: 0,
  scores: [],      // local top-5: { s, t, l, d, m }
};

// respect the OS "reduce motion" preference on first run
try {
  if (localStorage.getItem(KEY) === null && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    DEFAULTS.juice = 0.4;
  }
} catch (e) {}

export const settings = Object.assign({}, DEFAULTS);

try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(settings, JSON.parse(raw));
} catch (e) { /* private mode - ignore */ }

// migrate single `best` from earlier builds, and make sure the shape is right
if (settings.best) {
  settings.bests = Object.assign({}, settings.bests, { endless: settings.best });
  delete settings.best;
}
if (!settings.bests) settings.bests = { endless: 0, daily: 0 };
if (!Array.isArray(settings.scores)) settings.scores = [];

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
}

export function setSetting(k, v) {
  settings[k] = v;
  saveSettings();
}
