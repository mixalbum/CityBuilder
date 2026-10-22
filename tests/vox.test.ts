import { describe, expect, it } from 'vitest';
import { M, PALETTE_SRGB } from '../src/world/palette';
import { exportVox, readVox, VOX_MODEL_MAX, type Box, type VoxelSource } from '../src/world/vox';

/** A sparse voxel source backed by a map. */
function source(cells: [number, number, number, number][]): VoxelSource {
  const m = new Map(cells.map(([x, y, z, v]) => [`${x},${y},${z}`, v]));
  return { get: (x, y, z) => m.get(`${x},${y},${z}`) ?? 0 };
}
const box = (x1: number, y1: number, z1: number): Box => ({ x0: 0, y0: 0, z0: 0, x1, y1, z1 });

describe('.vox export', () => {
  it('writes a valid file with east as +x, north as +y and up as +z', () => {
    // One voxel at the south-west corner on the ground, one at the north-east corner, raised.
    const src = source([[0, 0, 9, M.RED_BRICK], [9, 4, 0, M.SANDSTONE]]);
    const { bytes, stats } = exportVox(src, box(10, 5, 10));
    const vox = readVox(bytes);
    expect(vox.version).toBe(150);
    expect(stats).toMatchObject({ models: 1, voxels: 2 });
    expect(vox.models[0].size).toEqual([10, 10, 5]);
    const v = vox.models[0].voxels;
    const voxels = [[v[0], v[1], v[2], v[3]], [v[4], v[5], v[6], v[7]]];
    expect(voxels).toContainEqual([0, 0, 0, M.RED_BRICK]); // world z = 9 (south) → vox y = 0
    expect(voxels).toContainEqual([9, 9, 4, M.SANDSTONE]); // world z = 0 (north) → vox y = 9
  });

  it('maps material ids to palette colours (colour index i is RGBA entry i - 1)', () => {
    const { bytes } = exportVox(source([[0, 0, 0, M.GOLD]]), box(1, 1, 1));
    const pal = readVox(bytes).palette!;
    const hex = PALETTE_SRGB[M.GOLD];
    expect([...pal.subarray((M.GOLD - 1) * 4, M.GOLD * 4)]).toEqual([(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255]);
  });

  it('drops hidden interior voxels unless asked to keep them', () => {
    const cube: [number, number, number, number][] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) cube.push([x + 1, y + 1, z + 1, M.CONCRETE]);
    expect(exportVox(source(cube), box(5, 5, 5)).stats).toMatchObject({ voxels: 26, dropped: 1 });
    expect(exportVox(source(cube), box(5, 5, 5), { hollow: false }).stats).toMatchObject({ voxels: 27, dropped: 0 });
  });

  it('keeps voxels behind glass and marks glass as a glass material', () => {
    const cube: [number, number, number, number][] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) cube.push([x + 1, y + 1, z + 1, M.CONCRETE]);
    cube[cube.findIndex(([x, y, z]) => x === 2 && y === 2 && z === 1)][3] = M.GLASS_CLEAR; // a glass face
    const { bytes, stats } = exportVox(source(cube), box(5, 5, 5));
    expect(stats.dropped).toBe(0); // the centre is visible through the glass
    expect(readVox(bytes).materials.get(M.GLASS_CLEAR)).toMatchObject({ _type: '_glass' });
  });

  it('splits areas over 256 voxels into tiled models placed by the scene graph', () => {
    const src = source([[0, 0, 0, M.CONCRETE], [300, 0, 0, M.CONCRETE], [0, 300, 0, M.CONCRETE]]);
    const { bytes, stats } = exportVox(src, box(301, 301, 1));
    const vox = readVox(bytes);
    expect(stats.models).toBe(3); // empty tiles are skipped
    for (const m of vox.models) expect(Math.max(...m.size)).toBeLessThanOrEqual(VOX_MODEL_MAX);
    expect(vox.translations).toHaveLength(3);
    // The tall tile sits on top of the ground tile.
    const zs = vox.translations.map((t) => Number(t.split(' ')[2]));
    expect(Math.max(...zs)).toBeGreaterThan(256);
  });

  it('refuses areas larger than the MagicaVoxel world', () => {
    expect(() => exportVox(source([]), box(4000, 10, 10))).toThrow(/world limit/);
  });
});
