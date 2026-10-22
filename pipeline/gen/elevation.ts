// Terrain: a per-column height map ("lifts") the ground, roads and buildings
// sit on. Two inputs share one path (gridToTerrain):
// - a global elevation model (fetch/dem.ts), filtered to strip buildings out;
// - surveyed ground points from a data source (e.g. City of Melbourne
//   footprints), interpolated onto a coarse grid (buildTerrain).
// Water bodies are pinned flat at their own level and the lowest water (or
// ground) becomes the datum, lift 0.
//
// Heights are "lifts" in voxels above the flat world's datum: a column with
// lift L has subsoil up to y = L, its street surface at y = L + 1 and its
// first air layer at y = GROUND_Y + L.

import { GROUND_Y } from '../config';
import type { LatLon } from '../geo/project';
import type { Area } from '../model/features';
import type { FootprintCollection } from '../model/footprints';
import type { WorldFrame } from '../geo/project';
import { fillPolygon, type Mask } from '../voxel/rasterize';
import type { Building } from '../model/features';

/** Footprint types whose base isn't street-level ground. */
const NOT_GROUND = new Set(['Bridge', 'Jetty', 'Tunnel', 'Ramp', 'Train Platform']);

const CELL = 8; // metres per interpolation cell
const SEARCH = 120; // metres
const SMOOTH_PASSES = 3;

export class Terrain {
  constructor(
    readonly sizeX: number,
    readonly sizeZ: number,
    /** Per-column lift in voxels. */
    readonly lifts: Int16Array,
    /** Columns that are open sea (at lift 0), from the elevation model's bathymetry. */
    readonly sea?: Uint8Array,
  ) {}

  isSea(x: number, z: number): boolean {
    return !!this.sea?.[Math.floor(z) * this.sizeX + Math.floor(x)];
  }

  static flat(sizeX: number, sizeZ: number): Terrain {
    return new Terrain(sizeX, sizeZ, new Int16Array(sizeX * sizeZ));
  }

  lift(x: number, z: number): number {
    const xi = Math.min(this.sizeX - 1, Math.max(0, Math.floor(x)));
    const zi = Math.min(this.sizeZ - 1, Math.max(0, Math.floor(z)));
    return this.lifts[zi * this.sizeX + xi];
  }

  /** Street surface layer of a column. */
  surface(x: number, z: number): number {
    return 1 + this.lift(x, z);
  }

  /** First air layer of a column (where buildings and trees stand). */
  ground(x: number, z: number): number {
    return GROUND_Y + this.lift(x, z);
  }

  /** Lift for metres above the datum (sea level for surveyed data). */
  static liftFor(metres: number): number {
    return Math.max(0, Math.round(metres));
  }

  /** Highest lift anywhere. */
  maxLift(): number {
    let hi = 0;
    for (const l of this.lifts) if (l > hi) hi = l;
    return hi;
  }
}

interface Sample {
  x: number;
  z: number;
  v: number;
}

function samplesFrom(fc: FootprintCollection, frame: WorldFrame): Sample[] {
  const byStructure = new Map<string, Sample>();
  for (const f of fc.features) {
    const p = f.properties;
    if (!f.geometry || p.structure_min_elevation == null || NOT_GROUND.has(p.footprint_type)) continue;
    // Use a tier that touches the ground, so the sample sits on the structure's base.
    if (p.footprint_min_elevation != null && p.footprint_min_elevation - p.structure_min_elevation > 1) continue;
    const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : (f.geometry.coordinates as number[][][][])[0][0]) as number[][];
    let x = 0, z = 0;
    for (const [lon, lat] of ring) {
      const [vx, vz] = frame.latLonToVoxel(lat, lon);
      x += vx;
      z += vz;
    }
    if (!byStructure.has(p.structure_id)) byStructure.set(p.structure_id, { x: x / ring.length, z: z / ring.length, v: p.structure_min_elevation });
  }
  return [...byStructure.values()];
}

/** Interpolate footprint base elevations into per-column lifts. */
export function buildTerrain(fc: FootprintCollection, frame: WorldFrame, areas: Area[]): { terrain: Terrain; samples: number } {
  const { sizeX, sizeZ } = frame;
  const samples = samplesFrom(fc, frame);
  if (samples.length < 10) return { terrain: Terrain.flat(sizeX, sizeZ), samples: samples.length };

  // Bucket samples for neighbourhood queries.
  const B = SEARCH;
  const buckets = new Map<string, Sample[]>();
  for (const s of samples) {
    const k = `${Math.floor(s.x / B)},${Math.floor(s.z / B)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }
  const near = (x: number, z: number, r: number) => {
    const out: Sample[] = [];
    const reach = Math.ceil(r / B);
    const bx = Math.floor(x / B), bz = Math.floor(z / B);
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) for (const s of buckets.get(`${bx + dx},${bz + dz}`) ?? []) out.push(s);
    return out;
  };

  // Inverse-distance weighting on a coarse grid.
  const gw = Math.ceil(sizeX / CELL) + 1, gd = Math.ceil(sizeZ / CELL) + 1;
  const grid = new Float32Array(gw * gd);
  for (let j = 0; j < gd; j++)
    for (let i = 0; i < gw; i++) {
      const x = i * CELL, z = j * CELL;
      let r = SEARCH, cands = near(x, z, r);
      while (cands.length < 4 && r < 2000) cands = near(x, z, (r *= 2));
      let num = 0, den = 0;
      for (const s of cands) {
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d2 > r * r) continue;
        const w = 1 / (d2 + 25);
        num += w * s.v;
        den += w;
      }
      grid[j * gw + i] = den > 0 ? num / den : 0;
    }

  return { terrain: gridToTerrain(grid, gw, gd, sizeX, sizeZ, areas, { datum: 0, water: 'datum' }), samples: samples.length };
}

export interface GridOptions {
  /** Metres that become lift 0, or 'water' for the lowest water body's level (else the lowest ground). */
  datum: number | 'water';
  /** 'datum': every water body sits at the datum. 'own': each sits at its own (lowest) level. */
  water: 'datum' | 'own';
}

/**
 * Turn a coarse grid of elevations (metres, CELL apart) into per-column
 * lifts: water bodies pinned flat, smoothed, datum subtracted.
 */
export function gridToTerrain(
  grid: Float32Array,
  gw: number,
  gd: number,
  sizeX: number,
  sizeZ: number,
  areas: Area[],
  opts: GridOptions,
  /** Coarse cells that are open sea: pinned at sea level, which becomes the datum. */
  seaCells?: Uint8Array,
  /** Exact per-column sea (e.g. from coastlines), refining the coarse cells at the shore. */
  seaColumns?: Uint8Array,
): Terrain {
  // Each water body's cells and level on the coarse grid.
  const bodies: { area: Area; cells: number[]; level: number }[] = [];
  for (const a of areas) {
    if (a.kind !== 'water') continue;
    const cells: number[] = [];
    fillPolygon(a.rings.map((r) => r.map(([x, z]) => [x / CELL, z / CELL] as [number, number])), gw, gd, (i, j) => cells.push(j * gw + i));
    if (!cells.length) continue;
    const vals = cells.map((k) => grid[k]).sort((a, b) => a - b);
    bodies.push({ area: a, cells, level: vals[Math.floor(vals.length * 0.25)] });
  }
  let datum: number;
  const hasSea = !!seaCells?.some((v) => v);
  if (typeof opts.datum === 'number') datum = opts.datum;
  else if (hasSea) datum = 0;
  else if (bodies.length) datum = Math.min(...bodies.map((b) => b.level));
  else {
    const sorted = Float32Array.from(grid).sort();
    datum = sorted[Math.floor(sorted.length * 0.01)];
  }
  // Water within 2 m of the datum is the same river or sea: one level.
  const levelOf = (b: { level: number }) => (opts.water === 'datum' || b.level - datum < 2 ? datum : b.level);

  let g = grid;
  const pin = () => {
    for (const b of bodies) for (const k of b.cells) g[k] = levelOf(b);
    if (seaCells) for (let k = 0; k < g.length; k++) if (seaCells[k]) g[k] = 0;
  };
  for (let pass = 0; pass <= SMOOTH_PASSES; pass++) {
    pin();
    if (pass === SMOOTH_PASSES) break;
    const next = new Float32Array(g.length);
    for (let j = 0; j < gd; j++)
      for (let i = 0; i < gw; i++) {
        let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= gw || jj >= gd) continue;
            sum += g[jj * gw + ii];
            n++;
          }
        next[j * gw + i] = sum / n;
      }
    g = next;
  }

  // Bilinear sample per column; water columns sit exactly at their body's level.
  const lifts = new Int16Array(sizeX * sizeZ);
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++) {
      const fx = x / CELL, fz = z / CELL;
      const i = Math.min(gw - 2, Math.floor(fx)), j = Math.min(gd - 2, Math.floor(fz));
      const tx = fx - i, tz = fz - j;
      const v = g[j * gw + i] * (1 - tx) * (1 - tz) + g[j * gw + i + 1] * tx * (1 - tz) + g[(j + 1) * gw + i] * (1 - tx) * tz + g[(j + 1) * gw + i + 1] * tx * tz;
      lifts[z * sizeX + x] = Terrain.liftFor(v - datum);
    }
  for (const a of areas) {
    if (a.kind !== 'water') continue;
    const body = bodies.find((b) => b.area === a);
    const level = body ? Terrain.liftFor(levelOf(body) - datum) : 0;
    fillPolygon(a.rings, sizeX, sizeZ, (x, z) => (lifts[z * sizeX + x] = level));
  }
  let sea: Uint8Array | undefined;
  if (hasSea) {
    sea = new Uint8Array(sizeX * sizeZ);
    for (let z = 0; z < sizeZ; z++)
      for (let x = 0; x < sizeX; x++)
        if (seaColumns ? seaColumns[z * sizeX + x] : seaCells![Math.round(z / CELL) * gw + Math.round(x / CELL)]) {
          sea[z * sizeX + x] = 1;
          lifts[z * sizeX + x] = 0;
        }
  }
  return new Terrain(sizeX, sizeZ, lifts, sea);
}

/**
 * Terrain from a global elevation model sampled at lat/lon. A minimum filter
 * over ~25 m strips most buildings and trees that leak into the model, then
 * the usual smoothing applies.
 */
export function demTerrain(
  sample: (lat: number, lon: number) => number,
  toLatLon: (x: number, z: number) => LatLon,
  sizeX: number,
  sizeZ: number,
  areas: Area[],
  /** Sea from OSM coastlines (coastlineSea), if any. */
  coastSea?: Uint8Array,
): Terrain {
  const gw = Math.ceil(sizeX / CELL) + 1, gd = Math.ceil(sizeZ / CELL) + 1;
  const raw = new Float32Array(gw * gd);
  for (let j = 0; j < gd; j++)
    for (let i = 0; i < gw; i++) {
      const { lat, lon } = toLatLon(i * CELL, j * CELL);
      raw[j * gw + i] = sample(lat, lon);
    }
  // Open water: the coastline's sea side if there is one; else, where the
  // model has bathymetry, anything clearly below sea level.
  const seaCells = new Uint8Array(gw * gd);
  for (let j = 0; j < gd; j++)
    for (let i = 0; i < gw; i++) {
      const x = Math.min(sizeX - 1, i * CELL), z = Math.min(sizeZ - 1, j * CELL);
      if (coastSea ? coastSea[z * sizeX + x] : raw[j * gw + i] < -1.5) seaCells[j * gw + i] = 1;
    }
  const R = 3; // cells: ±24 m
  const grid = new Float32Array(gw * gd);
  for (let j = 0; j < gd; j++)
    for (let i = 0; i < gw; i++) {
      let lo = Infinity;
      for (let dj = -R; dj <= R; dj++)
        for (let di = -R; di <= R; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < gw && jj < gd && raw[jj * gw + ii] < lo) lo = raw[jj * gw + ii];
        }
      grid[j * gw + i] = lo;
    }
  for (let k = 0; k < grid.length; k++) if (seaCells[k]) grid[k] = 0;
  return gridToTerrain(grid, gw, gd, sizeX, sizeZ, areas, { datum: 'water', water: 'own' }, seaCells, coastSea);
}

/**
 * Lift a building stands on. City of Melbourne tiers use their structure's
 * surveyed base, so every tier of a structure sits level; other buildings
 * sit on the lowest ground under their footprint (uphill sides are buried).
 */
export function baseLift(b: Building, mask: Mask, terrain: Terrain): number {
  const surveyed = parseFloat(b.tags['com:base_elevation'] ?? '');
  if (Number.isFinite(surveyed)) return Terrain.liftFor(surveyed);
  let low = Infinity;
  for (let lz = 0; lz < mask.d; lz++)
    for (let lx = 0; lx < mask.w; lx++) if (mask.cells[lz * mask.w + lx]) low = Math.min(low, terrain.lift(mask.x0 + lx, mask.z0 + lz));
  return Number.isFinite(low) ? low : 0;
}
