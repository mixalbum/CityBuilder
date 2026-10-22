// The open sea from OSM coastlines. OSM maps the sea as coastline lines, not
// areas, drawn with the land on the left and the water on the right. Within
// the world, the coastline pieces are drawn as walls, cells just right of
// them seed "sea" and cells just left seed "land", and both flood out until
// they meet a wall or each other. The world's edge closes the regions.

import type { Ring } from '../model/features';

const SEA = 1, LAND = 2, WALL = 3;

/** Per-column sea mask (1 = sea) for a sizeX × sizeZ world, or undefined if no coastline crosses it. */
export function coastlineSea(coastlines: Ring[], sizeX: number, sizeZ: number): Uint8Array | undefined {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < sizeX && z < sizeZ;
  const label = new Uint8Array(sizeX * sizeZ);
  const seeds: number[] = [];
  let any = false;

  for (const line of coastlines)
    for (let i = 1; i < line.length; i++) {
      const [x0, z0] = line[i - 1];
      const [x1, z1] = line[i];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      // Walls: sample the segment densely.
      const steps = Math.ceil(len * 2);
      for (let s = 0; s <= steps; s++) {
        const x = Math.floor(x0 + (dx * s) / steps), z = Math.floor(z0 + (dz * s) / steps);
        if (!inside(x, z)) continue;
        label[z * sizeX + x] = WALL;
        any = true;
      }
      // Voxel z points south, which mirrors the map: the land (left on the
      // map) lies towards (dz, -dx) here and the sea towards (-dz, dx).
      const nx = -dz / len, nz = dx / len;
      for (let s = 1; s < steps; s += 4) {
        const px = x0 + (dx * s) / steps, pz = z0 + (dz * s) / steps;
        for (const [side, k] of [[SEA, 2.5], [LAND, -2.5]] as const) {
          const x = Math.floor(px + nx * k), z = Math.floor(pz + nz * k);
          if (inside(x, z) && label[z * sizeX + x] === 0) {
            label[z * sizeX + x] = side;
            seeds.push(z * sizeX + x);
          }
        }
      }
    }
  if (!any) return undefined;

  // Grow both sides together until they meet a wall or each other.
  for (let h = 0; h < seeds.length; h++) {
    const k = seeds[h];
    const v = label[k];
    const x = k % sizeX, z = (k - x) / sizeX;
    if (x > 0 && label[k - 1] === 0) (label[k - 1] = v), seeds.push(k - 1);
    if (x < sizeX - 1 && label[k + 1] === 0) (label[k + 1] = v), seeds.push(k + 1);
    if (z > 0 && label[k - sizeX] === 0) (label[k - sizeX] = v), seeds.push(k - sizeX);
    if (z < sizeZ - 1 && label[k + sizeX] === 0) (label[k + sizeX] = v), seeds.push(k + sizeX);
  }

  const sea = new Uint8Array(sizeX * sizeZ);
  let n = 0;
  for (let k = 0; k < sea.length; k++)
    if (label[k] === SEA) {
      sea[k] = 1;
      n++;
    }
  return n ? sea : undefined;
}
