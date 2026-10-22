import { describe, expect, it } from 'vitest';
import { Terrain } from '../pipeline/gen/elevation';
import { chainLines, tramLines } from '../pipeline/gen/tramLines';
import type { Pt, Rail } from '../pipeline/model/features';
import { VoxelWorld } from '../pipeline/voxel/world';

describe('tram routes', () => {
  it('chains ways end to end, flipping reversed ones', () => {
    const a: Pt[] = [[0, 0], [50, 0]];
    const b: Pt[] = [[100, 0], [50.5, 0]]; // reversed, meets a's end
    const c: Pt[] = [[100, 0], [150, 0]];
    const chains = chainLines([a, b, c]);
    expect(chains).toHaveLength(1);
    const xs = chains[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(150);
  });

  it('does not chain through sharp turns at junctions', () => {
    const a: Pt[] = [[0, 0], [50, 0]];
    const right: Pt[] = [[50, 0], [50, 50]]; // 90° turn
    expect(chainLines([a, right])).toHaveLength(2);
  });

  it('samples routes on the track surface and drops short stubs', () => {
    const terrain = Terrain.flat(200, 50);
    const world = new VoxelWorld(200, 32, 50);
    const rails: Rail[] = [
      { id: 'long', kind: 'tram', line: [[10, 10], [150, 10]] },
      { id: 'stub', kind: 'tram', line: [[10, 30], [30, 30]] },
      { id: 'train', kind: 'rail', line: [[10, 40], [190, 40]] },
    ];
    const lines = tramLines(rails, world, terrain);
    expect(lines).toHaveLength(1);
    const ys = new Set(lines[0].filter((_, i) => i % 3 === 1));
    expect([...ys]).toEqual([terrain.surface(10, 10) + 1]);
    expect(lines[0].length / 3).toBeGreaterThan(40); // ~3 m spacing over 140 m
  });

  it('clips routes to the world', () => {
    const terrain = Terrain.flat(200, 50);
    const world = new VoxelWorld(200, 32, 50);
    const lines = tramLines([{ id: 'through', kind: 'tram', line: [[-300, 10], [500, 10]] }], world, terrain);
    expect(lines).toHaveLength(1);
    const xs = lines[0].filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...xs)).toBeLessThan(198);
  });
});
