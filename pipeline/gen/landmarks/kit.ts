// Voxel modelling helpers for hand-tuned landmarks. Coordinates are voxel
// space (x east-ish along Collins St, z south-ish, y up); heights passed as
// metres go through `y()`.

import { M } from '../../../src/world/palette';
import { GROUND_Y } from '../../config';
import type { WorldFrame } from '../../geo/project';
import type { VoxelWorld } from '../../voxel/world';
import { Terrain } from '../elevation';

export type Shape = 'circle' | 'octagon' | 'square';

/** Horizontal distance from an axis, measured in the given footprint shape. */
export function radialDistance(dx: number, dz: number, shape: Shape): number {
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (shape === 'square') return Math.max(ax, az);
  if (shape === 'octagon') return Math.max(ax, az, (ax + az) / Math.SQRT2);
  return Math.hypot(dx, dz);
}

/**
 * A material, or a function choosing one per voxel; return 0 to leave the
 * voxel untouched. `angle` is around the lathe axis (radians, -π..π) and `t`
 * the fraction of the lathe's height.
 */
export type Mat = number | ((x: number, y: number, z: number, angle: number, t: number) => number);

const pick = (m: Mat, x: number, y: number, z: number, angle = 0, t = 0) => (typeof m === 'number' ? m : m(x, y, z, angle, t));

export interface LatheOpts {
  shape?: Shape;
  /** Only fill a band this thick inside the radius (skins and lattices); 0 or unset = solid. */
  shell?: number;
}

export class Kit {
  constructor(
    readonly world: VoxelWorld,
    readonly frame: WorldFrame,
    readonly terrain: Terrain = Terrain.flat(world.sizeX, world.sizeZ),
    /** Ground layer heights are measured from: the landmark's base. */
    readonly base: number = GROUND_Y,
  ) {}

  /** The same kit measuring heights from another ground layer. */
  withBase(base: number): Kit {
    return new Kit(this.world, this.frame, this.terrain, base);
  }

  /** Voxel layer for a height in metres above the base. */
  y(metres: number): number {
    return this.base + Math.round(metres);
  }

  /** First air layer of a column on the terrain. */
  ground(x: number, z: number): number {
    return this.terrain.ground(x, z);
  }

  /** Voxel (x, z) for grid metres (x along Collins St, n along Swanston St). */
  grid(gx: number, gn: number): [number, number] {
    return this.frame.gridToVoxel(gx, gn);
  }

  set(x: number, y: number, z: number, m: number): void {
    this.world.set(Math.floor(x), y, Math.floor(z), m);
  }

  get(x: number, y: number, z: number): number {
    return this.world.get(Math.floor(x), y, Math.floor(z));
  }

  /** Fill an inclusive box; Mat functions get (x, y, z). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const v = pick(m, x, y, z);
          if (v) this.world.set(x, y, z, v);
        }
  }

  clearBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.world.set(x, y, z, 0);
  }

  /** Highest solid layer in a column at or below `below`, or the street surface if none. */
  topAt(x: number, z: number, below = this.world.sizeY - 1): number {
    const g = this.ground(x, z);
    for (let y = below; y >= g; y--) if (this.get(x, y, z)) return y;
    return g - 1;
  }

  /**
   * Surface of revolution around a vertical axis through (cx, cz), filling
   * layers y0..y1. `radius(t)` gives the radius at fraction t of the height.
   * Radii under ~0.7 still place the axis voxel, so spires end in a point.
   */
  lathe(cx: number, cz: number, y0: number, y1: number, radius: (t: number) => number, m: Mat, opts: LatheOpts = {}): void {
    const shape = opts.shape ?? 'circle';
    const shell = opts.shell ?? 0;
    for (let y = y0; y <= y1; y++) {
      const t = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
      const r = radius(t);
      if (r <= 0) continue;
      if (r < 0.71) {
        const v = pick(m, cx, y, cz, 0, t);
        if (v) this.set(cx, y, cz, v);
        continue;
      }
      const R = Math.ceil(r) + 1;
      for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
          const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
          const d = radialDistance(dx, dz, shape);
          if (d > r + 0.01) continue;
          if (shell > 0 && d <= r - shell && r > shell + 1) continue;
          const v = pick(m, x, y, z, Math.atan2(dz, dx), t);
          if (v) this.world.set(x, y, z, v);
        }
    }
  }

  /** Upper half-ellipsoid dome resting on layer `yBase`. */
  dome(cx: number, cz: number, yBase: number, rx: number, height: number, m: Mat, opts: LatheOpts = {}): void {
    this.lathe(cx, cz, yBase, yBase + Math.max(1, Math.round(height)), (t) => rx * Math.sqrt(Math.max(0, 1 - t * t)), m, opts);
  }

  /** Tapering spire from radius r0 at y0 to a point at y1. */
  spire(cx: number, cz: number, y0: number, y1: number, r0: number, m: Mat, shape: Shape = 'octagon'): void {
    this.lathe(cx, cz, y0, y1, (t) => r0 * (1 - t) + 0.3, m, { shape });
  }

  /**
   * Pitched roof over a rectangle: the ridge runs along `axis`, rising one
   * layer per voxel inwards from layer yEave.
   */
  gable(x0: number, z0: number, x1: number, z1: number, yEave: number, axis: 'x' | 'z', m: Mat): void {
    const half = axis === 'z' ? (x1 - x0) / 2 : (z1 - z0) / 2;
    for (let k = 0; k <= Math.ceil(half); k++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const across = axis === 'z' ? Math.min(x - x0, x1 - x) : Math.min(z - z0, z1 - z);
          if (across < k) continue;
          const v = pick(m, x, yEave + k, z);
          if (v) this.world.set(x, yEave + k, z, v);
        }
  }

  /**
   * A row of round columns with their axis along `axis`: at fixed coordinate
   * `at` on the other axis, from `from` to `to` every `spacing` voxels.
   */
  columns(axis: 'x' | 'z', at: number, from: number, to: number, spacing: number, y0: number, y1: number, r: number, m: Mat): void {
    for (let p = from; p <= to; p += spacing) {
      const [cx, cz] = axis === 'x' ? [p + 0.5, at + 0.5] : [at + 0.5, p + 0.5];
      this.lathe(cx, cz, y0, y1, () => r, m);
    }
  }

  /** Clock faces (white with a dark centre) on all four sides of a square tower. */
  clockFaces(cx: number, cz: number, y: number, half: number): void {
    const x0 = Math.floor(cx - half), x1 = Math.floor(cx + half), z0 = Math.floor(cz - half), z1 = Math.floor(cz + half);
    const mx = Math.floor(cx), mz = Math.floor(cz);
    for (let dy = -1; dy <= 1; dy++)
      for (let d = -1; d <= 1; d++) {
        const m = dy === 0 && d === 0 ? M.FRAME_DARK : M.CLOCK_FACE;
        this.set(mx + d, y + dy, z0 - 1, m);
        this.set(mx + d, y + dy, z1 + 1, m);
        this.set(x0 - 1, y + dy, mz + d, m);
        this.set(x1 + 1, y + dy, mz + d, m);
      }
  }

  /** Repave the street surface where `test` accepts the current material. */
  pave(x0: number, z0: number, x1: number, z1: number, m: number, test: (current: number) => boolean): void {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const g = this.ground(x, z);
        if (this.world.get(x, g, z) !== 0) continue; // under a building
        if (test(this.world.get(x, g - 1, z))) this.world.set(x, g - 1, z, m);
      }
  }
}

/** Sector index (0..n-1) of an angle split into n equal sectors. */
export function sector(angle: number, n: number): number {
  return Math.floor(((angle + Math.PI) / (2 * Math.PI)) * n) % n;
}

/** Distance (0..0.5) of an angle from the nearest of n evenly spaced ribs. */
export function ribDistance(angle: number, n: number): number {
  const f = ((angle + Math.PI) / (2 * Math.PI)) * n;
  return Math.abs(f - Math.round(f));
}
