import { describe, expect, it } from 'vitest';
import { CHUNK_VOL, readRegion, rleDecode, rleEncode, voxelIndex, writeRegion } from '../src/world/chunkFormat';
import { P, buildPadded, meshChunk, paddedIndex } from '../src/world/mesher';
import { M, linearPalette } from '../src/world/palette';

const palette = linearPalette();
const quads = (m: { indices: Uint32Array }) => m.indices.length / 6;

function volume(cells: [number, number, number][], mat = 3): Uint8Array {
  const v = new Uint8Array(P * P * P);
  for (const [x, y, z] of cells) v[paddedIndex(x, y, z)] = mat;
  return v;
}

describe('RLE and regions', () => {
  it('round-trips chunk data', () => {
    const data = new Uint8Array(CHUNK_VOL);
    for (let i = 0; i < data.length; i++) data[i] = i % 977 < 400 ? 0 : (i >> 7) % 5;
    const out = new Uint8Array(CHUNK_VOL);
    rleDecode(rleEncode(data), out);
    expect(out).toEqual(data);
  });

  it('round-trips region files', () => {
    const rle = rleEncode(new Uint8Array(CHUNK_VOL).fill(4));
    const back = readRegion(writeRegion([{ cx: 3, cy: 1, cz: 7, rle }]).buffer as ArrayBuffer);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ cx: 3, cy: 1, cz: 7 });
    expect([...back[0].rle]).toEqual([...rle]);
  });
});

describe('greedy mesher', () => {
  it('emits 6 quads for a single voxel', () => {
    expect(quads(meshChunk(volume([[5, 5, 5]]), palette))).toBe(6);
  });

  it('merges a row of voxels and culls internal faces', () => {
    const m = meshChunk(volume([[4, 4, 4], [5, 4, 4], [6, 4, 4]]), palette);
    expect(quads(m)).toBe(6);
  });

  it('does not merge faces of different materials', () => {
    const v = volume([[4, 4, 4]], 3);
    v[paddedIndex(5, 4, 4)] = 4;
    expect(quads(meshChunk(v, palette))).toBe(10);
  });

  it('culls faces against neighbouring chunk data in the padding', () => {
    const m = meshChunk(volume([[31, 0, 0], [32, 0, 0]]), palette);
    // The padding voxel at x=32 hides the +x face; padding itself is not meshed.
    expect(quads(m)).toBe(5);
  });

  it('darkens vertices in a concave corner (AO)', () => {
    // A floor with one wall voxel on it: floor vertices next to the wall are darker.
    const cells: [number, number, number][] = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) cells.push([x, 0, z]);
    cells.push([2, 1, 2]);
    const m = meshChunk(volume(cells), palette);
    let darkest = 1, brightest = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      if (m.normals[i * 3 + 1] !== 127 || m.positions[i * 3 + 1] !== 1) continue; // floor top faces
      const r = m.colors[i * 3] / 255 / palette[3 * 3];
      darkest = Math.min(darkest, r);
      brightest = Math.max(brightest, r);
    }
    expect(brightest).toBeCloseTo(1, 1);
    expect(darkest).toBeLessThan(0.85);
  });

  it('meshes glass separately and keeps solid faces behind it', () => {
    // A brick voxel with a glass voxel on its +x side.
    const v = volume([[5, 5, 5]], 3);
    v[paddedIndex(6, 5, 5)] = M.GLASS_CLEAR;
    const m = meshChunk(v, palette);
    expect(quads(m)).toBe(6); // the face behind the glass is kept
    expect(m.transparent).toBeDefined();
    expect(quads(m.transparent!)).toBe(5); // glass shows only faces touching air
    expect(meshChunk(volume([[5, 5, 5]]), palette).transparent).toBeUndefined();
  });

  it('builds padded volumes from neighbour chunks', () => {
    const centre = new Uint8Array(CHUNK_VOL);
    centre[voxelIndex(0, 0, 0)] = 2;
    const east = new Uint8Array(CHUNK_VOL);
    east[voxelIndex(0, 5, 6)] = 9;
    const n: (Uint8Array | null)[] = Array(27).fill(null);
    n[13] = rleEncode(centre);
    n[14] = rleEncode(east); // offset (+1, 0, 0)
    const vol = buildPadded(n);
    expect(vol[paddedIndex(0, 0, 0)]).toBe(2);
    expect(vol[paddedIndex(32, 5, 6)]).toBe(9);
  });
});
