// Coarse level of detail: a region downsampled 2x on every axis, so distant
// regions draw roughly a quarter of the faces. Pure, for workers and tests.

import { CHUNK, CHUNK_VOL, rleDecode, type RegionChunk } from './chunkFormat';

/** Border (voxels) kept around a region: the downsampled padding needs 2, exposure tests 1 more. */
const BORDER = 4;

export interface DenseRegion {
  data: Uint8Array;
  /** World voxel position of data[0]. */
  x0: number;
  z0: number;
  w: number;
  h: number;
  d: number;
}

/** Decode a region's chunks plus a border from its neighbours into one dense volume. */
export function denseRegion(chunks: RegionChunk[], x0: number, z0: number, span: number, height: number): DenseRegion {
  const w = span + 2 * BORDER, d = span + 2 * BORDER, h = height;
  const data = new Uint8Array(w * h * d);
  const ox = x0 - BORDER, oz = z0 - BORDER;
  const tmp = new Uint8Array(CHUNK_VOL);
  for (const c of chunks) {
    const bx = c.cx * CHUNK - ox, by = c.cy * CHUNK, bz = c.cz * CHUNK - oz;
    if (bx >= w || bz >= d || bx + CHUNK <= 0 || bz + CHUNK <= 0 || by >= h) continue;
    rleDecode(c.rle, tmp);
    for (let ly = 0; ly < CHUNK && by + ly < h; ly++)
      for (let lz = 0; lz < CHUNK; lz++) {
        const z = bz + lz;
        if (z < 0 || z >= d) continue;
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = bx + lx;
          if (x < 0 || x >= w) continue;
          data[x + z * w + (by + ly) * w * d] = tmp[lx | (lz << 5) | (ly << 10)];
        }
      }
  }
  return { data, x0: ox, z0: oz, w, h, d };
}

/**
 * Downsample a region 2x into a padded volume for meshVolume(): each cell
 * becomes solid when at least 4 of its 8 voxels are, taking the most common
 * material among the voxels exposed to air (so facades keep their colours
 * rather than the hidden interior fill).
 */
export function downsampleRegion(r: DenseRegion, span: number): { vol: Uint8Array; dims: [number, number, number] } {
  const X = span / 2, Z = span / 2, Y = Math.ceil(r.h / 2);
  const PX = X + 2, PZ = Z + 2;
  const vol = new Uint8Array(PX * PZ * (Y + 2));
  const { data, w, h, d } = r;
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : data[x + z * w + y * w * d]);
  const exposed = (x: number, y: number, z: number) =>
    !at(x + 1, y, z) || !at(x - 1, y, z) || !at(x, y + 1, z) || !at(x, y - 1, z) || !at(x, y, z + 1) || !at(x, y, z - 1);
  const mats = new Uint8Array(8), counts = new Uint8Array(8);

  for (let cy = -1; cy <= Y; cy++)
    for (let cz = -1; cz <= Z; cz++)
      for (let cx = -1; cx <= X; cx++) {
        // Source voxels of this cell, in dense-volume coordinates.
        const sx = BORDER + cx * 2, sy = cy * 2, sz = BORDER + cz * 2;
        let solid = 0, n = 0, anyExposed = false;
        for (let pass = 0; pass < 2 && !n; pass++)
          for (let dy = 0; dy < 2; dy++)
            for (let dz = 0; dz < 2; dz++)
              for (let dx = 0; dx < 2; dx++) {
                const m = at(sx + dx, sy + dy, sz + dz);
                if (!m) continue;
                if (pass === 0) {
                  solid++;
                  if (!exposed(sx + dx, sy + dy, sz + dz)) continue;
                  anyExposed = true;
                } else if (anyExposed) continue;
                let k = 0;
                while (k < n && mats[k] !== m) k++;
                if (k === n) (mats[n] = m), (counts[n++] = 0);
                counts[k]++;
              }
        if (solid < 4) continue;
        let best = 0;
        for (let k = 1; k < n; k++) if (counts[k] > counts[best]) best = k;
        vol[cx + 1 + (cz + 1) * PX + (cy + 1) * PX * PZ] = mats[best];
      }
  return { vol, dims: [X, Y, Z] };
}
