import type { Ring } from '../model/features';

/**
 * Even-odd scanline fill sampled at voxel centres, so courtyards (inner
 * rings) come out hollow. Calls `cb` once per covered (x, z) cell, clipped to
 * [0, sizeX) x [0, sizeZ).
 */
export function fillPolygon(
  rings: Ring[],
  sizeX: number,
  sizeZ: number,
  cb: (x: number, z: number) => void,
): void {
  let zMin = Infinity, zMax = -Infinity;
  for (const r of rings)
    for (const [, z] of r) {
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  const z0 = Math.max(0, Math.floor(zMin));
  const z1 = Math.min(sizeZ - 1, Math.ceil(zMax));
  const xs: number[] = [];
  for (let z = z0; z <= z1; z++) {
    const sz = z + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, zi] = ring[i];
        const [xj, zj] = ring[j];
        if (zi > sz !== zj > sz) xs.push(xi + ((sz - zi) * (xj - xi)) / (zj - zi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Cells whose centre x + 0.5 lies in [xs[k], xs[k+1]).
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(sizeX - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = xa; x <= xb; x++) cb(x, z);
    }
  }
}

/**
 * Cells whose centres lie within width/2 of a polyline. Each cell is visited
 * at most once even where segments overlap at joints.
 */
export function drawThickLine(
  line: Ring,
  width: number,
  sizeX: number,
  sizeZ: number,
  cb: (x: number, z: number) => void,
): void {
  const r = width / 2;
  const seen = new Set<number>();
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(sizeX - 1, Math.ceil(Math.max(ax, bx) + r));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) - r));
    const z1 = Math.min(sizeZ - 1, Math.ceil(Math.max(az, bz) + r));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax, pz = z + 0.5 - az;
        const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / len2)) : 0;
        const ex = px - t * dx, ez = pz - t * dz;
        if (ex * ex + ez * ez > r * r) continue;
        const k = z * sizeX + x;
        if (seen.has(k)) continue;
        seen.add(k);
        cb(x, z);
      }
  }
}

/** A rasterised footprint in a local bounding box. */
export interface Mask {
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** 1 inside, 0 outside; index (z - z0) * w + (x - x0). */
  cells: Uint8Array;
  count: number;
}

export function rasterizeMask(rings: Ring[], sizeX: number, sizeZ: number): Mask | undefined {
  const pts: [number, number][] = [];
  fillPolygon(rings, sizeX, sizeZ, (x, z) => pts.push([x, z]));
  if (!pts.length) return undefined;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  const cells = new Uint8Array(w * d);
  for (const [x, z] of pts) cells[(z - z0) * w + (x - x0)] = 1;
  return { x0, z0, w, d, cells, count: pts.length };
}

/**
 * Distance (in 4-connected steps) from each inside cell to the nearest
 * outside cell: perimeter cells are 1, the next ring in is 2, and so on.
 * Outside cells are 0.
 */
export function distanceToEdge(mask: Mask): Uint16Array {
  const { w, d, cells } = mask;
  const dist = new Uint16Array(w * d);
  const queue: number[] = [];
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (!cells[i]) continue;
      const edge =
        x === 0 || z === 0 || x === w - 1 || z === d - 1 ||
        !cells[i - 1] || !cells[i + 1] || !cells[i - w] || !cells[i + w];
      if (edge) {
        dist[i] = 1;
        queue.push(i);
      }
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w, z = (i - x) / w;
    const next = dist[i] + 1;
    const visit = (j: number) => {
      if (cells[j] && dist[j] === 0) {
        dist[j] = next;
        queue.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (z > 0) visit(i - w);
    if (z < d - 1) visit(i + w);
  }
  return dist;
}
