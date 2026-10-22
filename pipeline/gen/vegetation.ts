import { M } from '../../src/world/palette';
import type { Tree } from '../model/features';
import { makeRng } from '../util/rng';
import type { VoxelWorld } from '../voxel/world';
import type { Terrain } from './elevation';

const LEAVES = [M.LEAF_1, M.LEAF_2, M.LEAF_3];

/** Voxel street trees: a trunk under a noisy ellipsoid canopy. Elms grow bigger than planes. */
export function generateTrees(world: VoxelWorld, trees: Tree[], terrain: Terrain): number {
  let planted = 0;
  for (const t of trees) {
    const x = Math.floor(t.x), z = Math.floor(t.z);
    const g = terrain.ground(x, z);
    if (!world.inBounds(x, g, z) || world.get(x, g, z) !== 0) continue;
    if (world.get(x, g - 1, z) === 0) continue; // over water

    const rng = makeRng(t.id);
    const elm = /ulmus|elm/i.test(`${t.tags.genus ?? ''} ${t.tags.species ?? ''} ${t.tags['species:en'] ?? ''}`);
    const trunk = rng.int(4, elm ? 7 : 6);
    const r = elm ? rng.range(3.5, 5) : rng.range(2.6, 4.2);
    const rv = r * 0.8;
    const cy = g + trunk + rv * 0.6;

    for (let y = g; y < g + trunk; y++) world.setIfAir(x, y, z, M.TREE_TRUNK);
    const ri = Math.ceil(r), rvi = Math.ceil(rv);
    for (let dy = -rvi; dy <= rvi; dy++)
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++) {
          const q = (dx * dx + dz * dz) / (r * r) + (dy * dy) / (rv * rv);
          if (q >= 1 - rng() * 0.3) continue;
          const shade = dy > rv * 0.3 ? 2 : dy < -rv * 0.3 ? 0 : rng.int(0, 2);
          world.setIfAir(x + dx, Math.round(cy + dy), z + dz, LEAVES[shade]);
        }
    planted++;
  }
  return planted;
}
