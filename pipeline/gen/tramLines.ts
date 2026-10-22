// Tram routes for the viewer's animated trams. OSM splits each track into
// many short ways; these are chained end-to-end into continuous lines, then
// resampled with the height of the track surface (terrain or bridge deck).

import type { Pt, Rail } from '../model/features';
import type { VoxelWorld } from '../voxel/world';
import type { Terrain } from './elevation';
import { surfaceAt } from './terrain';

const JOIN = 1.5; // voxels: endpoints this close are the same point
const MAX_TURN = Math.PI / 3; // don't chain through sharp junction turns
const STEP = 3; // resample spacing, voxels
const MIN_LENGTH = 60; // drop stubs (depot spurs, crossovers)

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const heading = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const turn = (h1: number, h2: number) => Math.abs(((h2 - h1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

/** Append pool lines to the end of `chain` while one continues it without a sharp turn. */
function extend(chain: Pt[], pool: Pt[][]): void {
  for (let grew = true; grew; ) {
    grew = false;
    const end = chain[chain.length - 1];
    const endHeading = heading(chain[chain.length - 2], end);
    let best = -1, bestTurn = MAX_TURN, flip = false;
    pool.forEach((l, i) => {
      for (const rev of [false, true]) {
        const a = rev ? l[l.length - 1] : l[0];
        const b = rev ? l[l.length - 2] : l[1];
        if (dist(a, end) > JOIN) continue;
        const t = turn(endHeading, heading(a, b));
        if (t < bestTurn) [best, bestTurn, flip] = [i, t, rev];
      }
    });
    if (best >= 0) {
      const next = pool.splice(best, 1)[0];
      if (flip) next.reverse();
      chain.push(...next.slice(1));
      grew = true;
    }
  }
}

/** Join polylines whose ends meet (in either direction) into longer chains. */
export function chainLines(lines: Pt[][]): Pt[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const out: Pt[][] = [];
  while (pool.length) {
    const chain = pool.pop()!;
    extend(chain, pool);
    // Then grow from the other end.
    chain.reverse();
    extend(chain, pool);
    out.push(chain);
  }
  return out;
}

/**
 * Tram lines as flat [x, y, z, x, y, z, ...] arrays, y on top of the track.
 * OSM data covers a bounding box larger than the (rotated) world, so routes
 * are clipped to the world and split where they leave it.
 */
export function tramLines(rails: Rail[], world: VoxelWorld, terrain: Terrain): number[][] {
  const chains = chainLines(rails.filter((r) => r.kind === 'tram').map((r) => r.line));
  const inside = (x: number, z: number) => x >= 2 && z >= 2 && x < world.sizeX - 2 && z < world.sizeZ - 2;
  const out: number[][] = [];
  for (const line of chains) {
    let run: number[] = [];
    const flush = () => {
      if (run.length / 3 >= MIN_LENGTH / STEP) out.push(run);
      run = [];
    };
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const [bx, bz] = line[i];
      const n = Math.max(1, Math.round(dist(line[i - 1], line[i]) / STEP));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (!inside(x, z)) {
          flush();
          continue;
        }
        const y = surfaceAt(world, terrain, Math.floor(x), Math.floor(z)) + 1;
        run.push(Math.round(x * 10) / 10, y, Math.round(z * 10) / 10);
      }
    }
    flush();
  }
  return out;
}
