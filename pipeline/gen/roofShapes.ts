// Roofs from OSM's roof:shape tag, built on any footprint from its
// distance-to-edge field: hipped/pyramidal roofs rise towards the middle,
// gabled ones along the short axis only, domes and onions bulge with a round
// profile, cones taper to a point. Roof heights follow roof:height when tagged.

import type { Mask } from '../voxel/rasterize';
import type { VoxelWorld } from '../voxel/world';

export type RoofShape = 'hipped' | 'pyramidal' | 'gabled' | 'skillion' | 'mansard' | 'dome' | 'onion' | 'cone' | 'round' | 'flat';

const ALIASES: Record<string, RoofShape> = {
  hipped: 'hipped', 'half-hipped': 'hipped', side_hipped: 'hipped', hip: 'hipped',
  pyramidal: 'pyramidal', pyramid: 'pyramidal',
  gabled: 'gabled', gable: 'gabled', saltbox: 'gabled', gambrel: 'gabled', crosspitched: 'hipped', double_saltbox: 'gabled',
  skillion: 'skillion', lean_to: 'skillion', shed: 'skillion',
  mansard: 'mansard',
  dome: 'dome', 'half-dome': 'dome',
  onion: 'onion',
  cone: 'cone', conical: 'cone', spire: 'cone',
  round: 'round', arched: 'round', barrel: 'round',
  flat: 'flat',
};

export function parseRoofShape(tag: string | undefined): RoofShape | undefined {
  return tag ? ALIASES[tag.toLowerCase()] : undefined;
}

/** Shapes that make sense on big buildings too (domes on towers, spires). */
export const ALWAYS_SHAPED = new Set<RoofShape>(['dome', 'onion', 'cone']);

/** Distance (cells) to the footprint edge along the mask's shorter axis only. */
function shortAxisDistance(mask: Mask): { d: Uint16Array; max: number } {
  const { w, d: depth, cells } = mask;
  const out = new Uint16Array(w * depth);
  const alongX = w >= depth; // ridge runs along x, so slopes face ±z
  let max = 0;
  const lines = alongX ? w : depth, len = alongX ? depth : w;
  for (let a = 0; a < lines; a++) {
    // Runs of filled cells along the short axis; distance is to the nearer end.
    let start = -1;
    for (let b = 0; b <= len; b++) {
      const idx = alongX ? b * w + a : a * w + b;
      const filled = b < len && cells[idx];
      if (filled && start < 0) start = b;
      if (!filled && start >= 0) {
        for (let k = start; k < b; k++) {
          const v = Math.min(k - start + 1, b - k);
          out[alongX ? k * w + a : a * w + k] = v;
          if (v > max) max = v;
        }
        start = -1;
      }
    }
  }
  return { d: out, max };
}

/**
 * Add a roof of `shape` above layer `topY`. `dist` is the mask's
 * distance-to-edge field; `heightM` overrides the shape's natural height.
 * Returns the number of layers added.
 */
export function addShapedRoof(
  world: VoxelWorld,
  mask: Mask,
  dist: Uint16Array,
  topY: number,
  shape: RoofShape,
  material: number,
  heightM?: number,
): number {
  if (shape === 'flat') return 0;
  let R = 0;
  for (const v of dist) if (v > R) R = v;
  if (R < 2) return 0;
  const { w, d } = mask;
  const put = (lx: number, lz: number, y: number) => world.set(mask.x0 + lx, y, mask.z0 + lz, material);

  if (shape === 'gabled' || shape === 'round' || shape === 'skillion') {
    const { d: sd, max } = shortAxisDistance(mask);
    const natural = shape === 'round' ? max * 0.8 : Math.min(12, max * 0.6);
    const H = Math.max(1, Math.round(heightM ?? natural));
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        const v = sd[lz * w + lx];
        if (!v) continue;
        // Fraction of the way to the ridge.
        const t = Math.min(1, v / max);
        const rise = shape === 'round' ? Math.sqrt(1 - (1 - t) ** 2) : shape === 'skillion' ? lx / Math.max(1, w - 1) : t;
        const top = Math.round(rise * H);
        for (let k = 1; k <= top; k++) put(lx, lz, topY + k);
      }
    return H;
  }

  // Radial profiles: r(k) is the inset (cells from the edge) still covered at layer k.
  let H: number;
  let covered: (k: number) => number;
  switch (shape) {
    case 'dome': {
      H = Math.round(heightM ?? R);
      covered = (k) => R - R * Math.sqrt(Math.max(0, 1 - (k / H) ** 2));
      break;
    }
    case 'onion': {
      // Bulges past the drum, then pinches to a point.
      H = Math.round(heightM ?? R * 1.8);
      covered = (k) => {
        const t = k / H;
        const radius = R * (t < 0.35 ? 1 + 0.25 * Math.sin((t / 0.35) * (Math.PI / 2)) : 1.25 * Math.cos(((t - 0.35) / 0.65) * (Math.PI / 2)));
        return R - Math.min(R, radius);
      };
      break;
    }
    case 'cone': {
      H = Math.round(heightM ?? R * 2.5);
      covered = (k) => (R * k) / H;
      break;
    }
    case 'pyramidal': {
      H = Math.round(heightM ?? R);
      covered = (k) => (R * k) / H;
      break;
    }
    case 'mansard': {
      // Steep lower slope, then a shallow top.
      H = Math.round(heightM ?? Math.min(8, R * 0.7));
      covered = (k) => (k <= H * 0.7 ? k * 0.4 : H * 0.28 + (k - H * 0.7) * 2.5);
      break;
    }
    default: {
      // hipped: one layer up for every two cells in, capped.
      H = Math.round(heightM ?? Math.min(9, Math.floor((R - 1) / 2)));
      covered = (k) => (k * (R - 1)) / Math.max(1, H);
    }
  }
  if (H < 1) return 0;
  for (let k = 1; k <= H; k++) {
    const inset = covered(k);
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        const v = dist[lz * w + lx];
        // The innermost cells always reach the top layer, so every roof has an apex.
        if (v && (v > inset || (k === H && v === R))) put(lx, lz, topY + k);
      }
  }
  // Domes, onions and cones get a finial.
  if (shape === 'dome' || shape === 'onion' || shape === 'cone') {
    let cx = 0, cz = 0;
    for (let i = 0; i < dist.length; i++)
      if (dist[i] === R) {
        cx = i % w;
        cz = Math.floor(i / w);
        break;
      }
    for (let k = 1; k <= Math.max(1, Math.round(R / 4)); k++) put(cx, cz, topY + H + k);
  }
  return H;
}
