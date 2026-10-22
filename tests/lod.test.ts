import { describe, expect, it } from 'vitest';
import { CHUNK, CHUNK_VOL, rleEncode, voxelIndex } from '../src/world/chunkFormat';
import { denseRegion, downsampleRegion } from '../src/world/lod';
import { meshVolume } from '../src/world/mesher';
import { linearPalette } from '../src/world/palette';

const palette = linearPalette();

/** One chunk at the origin filled by `fill(x, y, z)`. */
function chunk(fill: (x: number, y: number, z: number) => number, cx = 0, cz = 0) {
  const data = new Uint8Array(CHUNK_VOL);
  for (let y = 0; y < CHUNK; y++)
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) data[voxelIndex(x, y, z)] = fill(x, y, z);
  return { cx, cy: 0, cz, rle: rleEncode(data) };
}

function cellAt(vol: Uint8Array, dims: [number, number, number], x: number, y: number, z: number) {
  const PX = dims[0] + 2, PZ = dims[2] + 2;
  return vol[x + 1 + (z + 1) * PX + (y + 1) * PX * PZ];
}

describe('coarse LOD', () => {
  it('halves every axis', () => {
    const r = denseRegion([chunk(() => 0)], 0, 0, CHUNK, CHUNK);
    expect(downsampleRegion(r, CHUNK).dims).toEqual([16, 16, 16]);
  });

  it('keeps a cell when at least 4 of its 8 voxels are solid', () => {
    // Cell (0,0,0): bottom layer of 4. Cell (1,0,0): 3 voxels.
    const c = chunk((x, y, z) => (y === 0 && x < 2 && z < 2) || (y === 0 && x >= 2 && x < 4 && z === 0) || (x === 2 && y === 1 && z === 0) ? 5 : 0);
    const { vol, dims } = downsampleRegion(denseRegion([c], 0, 0, CHUNK, CHUNK), CHUNK);
    expect(cellAt(vol, dims, 0, 0, 0)).toBe(5);
    expect(cellAt(vol, dims, 1, 0, 0)).toBe(0);
  });

  it('colours cells from the voxels exposed to air, not the interior fill', () => {
    // A 16-wide block with a 1-voxel skin of material 7 around fill 2.
    const c = chunk((x, y, z) => {
      if (x >= 16 || y >= 16 || z >= 16) return 0;
      return x === 0 || x === 15 || y === 15 || z === 0 || z === 15 ? 7 : 2;
    });
    const { vol, dims } = downsampleRegion(denseRegion([c], 0, 0, CHUNK, CHUNK), CHUNK);
    expect(cellAt(vol, dims, 0, 3, 3)).toBe(7); // facade cell
    expect(cellAt(vol, dims, 4, 3, 4)).toBe(2); // fully interior cell
  });

  it('pulls neighbouring chunks into the padding so region seams are culled', () => {
    const solid = () => 3;
    const { vol, dims } = downsampleRegion(denseRegion([chunk(solid), chunk(solid, 1)], 0, 0, CHUNK, CHUNK), CHUNK);
    expect(cellAt(vol, dims, dims[0], 0, 0)).toBe(3); // +x padding comes from the neighbour
    const mesh = meshVolume(vol, dims, palette);
    // No face on the +x side, where the neighbour continues the solid.
    const xs = mesh.positions.filter((_, i) => i % 3 === 0);
    const maxX = Math.max(...xs);
    expect(mesh.normals.some((n, i) => i % 3 === 0 && n > 0 && xs[i / 3] === maxX)).toBe(false);
  });

  it('meshes at scale 2 in world units', () => {
    const vol = new Uint8Array(3 * 3 * 3);
    vol[1 + 3 + 9] = 4; // single cell in a 1x1x1 volume
    const m = meshVolume(vol, [1, 1, 1], palette, [10, 0, 0], [0, 0, 0], 2);
    const xs = m.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(12);
    expect(m.indices.length / 6).toBe(6);
  });
});
