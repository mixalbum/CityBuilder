// Greedy mesher with per-vertex ambient occlusion. Pure (no three.js) so it
// runs in a worker and in unit tests.

import { CHUNK, CHUNK_VOL, rleDecode } from './chunkFormat';
import { TRANSPARENT, glowAt } from './palette';

const S = CHUNK;
/** Padded volume edge: one voxel of neighbour data on every side. */
export const P = S + 2;
const P2 = P * P;

/** Brightness for 0..3 unoccluded neighbours at a vertex. */
const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

export const paddedIndex = (x: number, y: number, z: number): number => x + 1 + (z + 1) * P + (y + 1) * P2;

const IS_TRANSPARENT = new Uint8Array(256);
for (const m of TRANSPARENT) IS_TRANSPARENT[m] = 1;
/** Solid and not see-through: hides neighbouring faces and casts AO. */
const IS_OPAQUE = new Uint8Array(256).map((_, m) => (m !== 0 && !IS_TRANSPARENT[m] ? 1 : 0));

export interface MeshData {
  /** Vertex positions relative to the mesh origin (chunk offset added). */
  positions: Uint16Array;
  normals: Int8Array;
  /** Linear RGB with AO baked in. */
  colors: Uint8Array;
  /** 255 where the face glows at night, else 0. */
  glow: Uint8Array;
  indices: Uint32Array;
  vertexCount: number;
  /** See-through faces (glass), meshed separately for the translucent pass. */
  transparent?: MeshData;
}

/**
 * Build the padded (34³) volume for a chunk from the RLE data of its 3x3x3
 * neighbourhood. `neighbours[(oy + 1) * 9 + (oz + 1) * 3 + (ox + 1)]` is the
 * chunk at offset (ox, oy, oz); null means empty.
 */
export function buildPadded(neighbours: (Uint8Array | null)[], scratch?: Uint8Array[]): Uint8Array {
  const vol = new Uint8Array(P * P * P);
  const decoded = scratch ?? Array.from({ length: 27 }, () => new Uint8Array(CHUNK_VOL));
  const present = neighbours.map((rle, i) => {
    if (!rle) return false;
    rleDecode(rle, decoded[i]);
    return true;
  });
  for (let y = -1; y <= S; y++) {
    const oy = y < 0 ? -1 : y >= S ? 1 : 0;
    const ly = y - oy * S;
    for (let z = -1; z <= S; z++) {
      const oz = z < 0 ? -1 : z >= S ? 1 : 0;
      const lz = z - oz * S;
      for (let x = -1; x <= S; x++) {
        const ox = x < 0 ? -1 : x >= S ? 1 : 0;
        const n = (oy + 1) * 9 + (oz + 1) * 3 + (ox + 1);
        if (!present[n]) continue;
        vol[paddedIndex(x, y, z)] = decoded[n][(x - ox * S) | (lz << 5) | (ly << 10)];
      }
    }
  }
  return vol;
}

/**
 * Mesh a padded volume. `palette` is linear RGB floats (3 per material);
 * `offset` is added to every vertex position; `origin` is the chunk's world
 * voxel position, which seeds which windows are lit at night.
 */
export function meshChunk(
  vol: Uint8Array,
  palette: Float32Array,
  offset: [number, number, number] = [0, 0, 0],
  origin: [number, number, number] = [0, 0, 0],
): MeshData {
  return meshVolume(vol, [S, S, S], palette, offset, origin);
}

/**
 * Mesh a padded volume of any size: `dims` is the unpadded size [x, y, z]
 * and the volume holds (x+2)(y+2)(z+2) cells, x fastest then z then y.
 * Vertex positions are multiplied by `scale` (for downsampled LOD meshes).
 */
export function meshVolume(
  vol: Uint8Array,
  dims: [number, number, number],
  palette: Float32Array,
  offset: [number, number, number] = [0, 0, 0],
  origin: [number, number, number] = [0, 0, 0],
  scale = 1,
): MeshData {
  // Opaque faces show wherever the neighbour isn't opaque (air or glass);
  // glass faces only where they touch air.
  const mesh = meshPass(vol, dims, palette, offset, origin, scale, (m, next) => IS_OPAQUE[m] === 1 && IS_OPAQUE[next] === 0);
  if (vol.some((m) => IS_TRANSPARENT[m] === 1))
    mesh.transparent = meshPass(vol, dims, palette, offset, origin, scale, (m, next) => IS_TRANSPARENT[m] === 1 && next === 0);
  return mesh;
}

function meshPass(
  vol: Uint8Array,
  dims: [number, number, number],
  palette: Float32Array,
  offset: [number, number, number],
  origin: [number, number, number],
  scale: number,
  faceVisible: (m: number, next: number) => boolean,
): MeshData {
  const pos: number[] = [];
  const glow: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const mask = new Int32Array(Math.max(dims[0] * dims[1], dims[1] * dims[2], dims[0] * dims[2]));
  const PX = dims[0] + 2, PXZ = PX * (dims[2] + 2);
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const at = (c: number[]) => vol[c[0] + 1 + (c[2] + 1) * PX + (c[1] + 1) * PXZ];
  const occludes = (c: number[]) => IS_OPAQUE[at(c)];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    for (const dir of [1, -1]) {
      const U = dims[u], V = dims[v];
      for (let s = 0; s < dims[d]; s++) {
        // 1. Mask of visible faces in this slice, keyed by material + AO.
        let n = 0;
        for (let j = 0; j < V; j++)
          for (let i = 0; i < U; i++, n++) {
            p[d] = s;
            p[u] = i;
            p[v] = j;
            const m = at(p);
            mask[n] = 0;
            if (!m) continue;
            q[0] = p[0];
            q[1] = p[1];
            q[2] = p[2];
            q[d] += dir;
            if (!faceVisible(m, at(q))) continue;
            // AO from the air cell in front of the face; lit faces never merge with unlit ones.
            let key = m | (glowAt(m, origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]) << 16);
            for (let c = 0; c < 4; c++) {
              const su = c === 1 || c === 2 ? 1 : -1;
              const sv = c >= 2 ? 1 : -1;
              q[u] += su;
              const side1 = occludes(q);
              q[v] += sv;
              const corner = occludes(q);
              q[u] -= su;
              const side2 = occludes(q);
              q[v] -= sv;
              const ao = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
              key |= ao << (8 + c * 2);
            }
            mask[n] = key;
          }

        // 2. Merge equal-keyed cells into rectangles.
        n = 0;
        for (let j = 0; j < V; j++)
          for (let i = 0; i < U; ) {
            const key = mask[n];
            if (!key) {
              i++;
              n++;
              continue;
            }
            let w = 1;
            while (i + w < U && mask[n + w] === key) w++;
            let h = 1;
            grow: for (; j + h < V; h++)
              for (let k = 0; k < w; k++) if (mask[n + k + h * U] !== key) break grow;

            emitQuad(d, u, v, dir, s, i, j, w, h, key);
            for (let l = 0; l < h; l++) mask.fill(0, n + l * U, n + l * U + w);
            i += w;
            n += w;
          }
      }
    }
  }

  function emitQuad(d: number, u: number, v: number, dir: number, s: number, i: number, j: number, w: number, h: number, key: number) {
    const m = key & 0xff;
    const lit = (key >> 16) & 1 ? 255 : 0;
    const base = pos.length / 3;
    // Corners in (u, v): (0,0) (1,0) (1,1) (0,1); CCW seen from +d.
    const order = dir > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const ao: number[] = [];
    for (const c of order) {
      const cu = c === 1 || c === 2 ? 1 : 0;
      const cv = c >= 2 ? 1 : 0;
      const vert = [0, 0, 0];
      vert[d] = dir > 0 ? s + 1 : s;
      vert[u] = i + cu * w;
      vert[v] = j + cv * h;
      pos.push(vert[0] * scale + offset[0], vert[1] * scale + offset[1], vert[2] * scale + offset[2]);
      const nrm = [0, 0, 0];
      nrm[d] = dir * 127;
      nor.push(nrm[0], nrm[1], nrm[2]);
      glow.push(lit);
      const a = (key >> (8 + c * 2)) & 3;
      ao.push(a);
      const f = AO_CURVE[a] * 255;
      col.push(
        Math.round(palette[m * 3] * f),
        Math.round(palette[m * 3 + 1] * f),
        Math.round(palette[m * 3 + 2] * f),
      );
    }
    // Split along the diagonal that keeps AO gradients symmetric.
    if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return {
    positions: Uint16Array.from(pos),
    normals: Int8Array.from(nor),
    colors: Uint8Array.from(col),
    glow: Uint8Array.from(glow),
    indices: Uint32Array.from(idx),
    vertexCount: pos.length / 3,
  };
}
