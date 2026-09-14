/* ------------------------------------------------------------------
   Seeded PRNG (mulberry32) for reproducible runs.
   Only GAMEPLAY randomness goes through here — particles, jitter and
   audio variation stay on Math.random so the visuals keep their sparkle
   while the level layout is identical for everyone on a given day.
------------------------------------------------------------------- */
let state = 1;

export function seedRng(seed) {
  state = (seed >>> 0) || 1;
}

export function srnd() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const srange = (a, b) => a + srnd() * (b - a);
export const spick = (arr) => arr[(srnd() * arr.length) | 0];

/** Stable per-calendar-day seed (local timezone): same number for every player. */
export function dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
