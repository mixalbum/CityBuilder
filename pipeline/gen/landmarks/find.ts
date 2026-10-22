import type { Landmark } from '../../../src/world/chunkFormat';
import type { LandmarkDef } from '../../config';
import type { Terrain } from '../elevation';
import type { WorldFrame } from '../../geo/project';
import type { Building } from '../../model/features';
import type { VoxelWorld } from '../../voxel/world';

/** Highest solid voxel in a square around (x, z), as a height above ground. */
function columnTop(world: VoxelWorld, x: number, z: number, r: number, ground: number): number {
  let top = ground - 1;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++)
      for (let y = world.sizeY - 1; y > top; y--)
        if (world.get(x + dx, y, z + dz)) {
          top = y;
          break;
        }
  return top + 1 - ground;
}

/**
 * Locate landmarks: by OSM name (or alias) on any building or tier, falling
 * back to a known coordinate for buildings unnamed in OSM. Heights are read
 * back from the generated voxels so they match what the viewer shows.
 */
export function findLandmarks(world: VoxelWorld, frame: WorldFrame, buildings: Building[], defs: LandmarkDef[], terrain: Terrain): Landmark[] {
  const byName = new Map<string, LandmarkDef>();
  for (const d of defs) for (const n of [d.name, ...(d.aliases ?? [])]) byName.set(n.toLowerCase(), d);

  const boxes = new Map<LandmarkDef, [number, number, number, number]>();
  for (const b of buildings) {
    const def = byName.get((b.tags.name ?? '').toLowerCase());
    if (!def) continue;
    const box = boxes.get(def) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of b.rings)
      for (const [x, z] of r) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], z);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], z);
      }
    boxes.set(def, box);
  }

  const out: Landmark[] = [];
  for (const def of defs) {
    let x: number, z: number, r: number;
    const box = boxes.get(def);
    if (box) {
      [x, z] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      r = Math.min(25, Math.floor(Math.min(box[2] - box[0], box[3] - box[1]) / 2));
    } else if (def.at) {
      [x, z] = frame.latLonToVoxel(def.at.lat, def.at.lon);
      r = 6;
    } else continue;
    if (x < 0 || z < 0 || x >= world.sizeX || z >= world.sizeZ) continue;
    const ground = terrain.ground(x, z);
    out.push({ name: def.name, x: Math.round(x), z: Math.round(z), ground, height: columnTop(world, Math.round(x), Math.round(z), r, ground) });
  }
  return out;
}
