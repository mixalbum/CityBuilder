/** FNV-1a 32-bit hash, used to seed per-feature RNGs from OSM ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  (): number;
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number;
  range(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
}

/** Deterministic mulberry32 generator returning floats in [0, 1). */
export function makeRng(seed: number | string): Rng {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.pick = (items) => items[Math.floor(next() * items.length)];
  return next;
}
