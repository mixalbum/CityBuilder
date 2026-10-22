// Rooftop clutter: plant rooms, AC units, helipads and chimneys.

import { M } from '../../src/world/palette';
import type { Rng } from '../util/rng';
import type { Mask } from '../voxel/rasterize';
import type { VoxelWorld } from '../voxel/world';
import type { FacadeStyle } from './facades';

export interface RoofCtx {
  mask: Mask;
  dist: Uint16Array;
  /** Highest solid layer of the building. */
  topY: number;
  /** Inset of the top layer, so details stay on the actual roof. */
  topInset: number;
  H: number;
  style: FacadeStyle;
  rng: Rng;
  /** Off for real massing, which already includes plant rooms. */
  plantRoom: boolean;
}

export function addRoofDetails(world: VoxelWorld, c: RoofCtx): void {
  const { mask, dist, topY, topInset, H, style, rng, plantRoom } = c;
  const { x0, z0, w, d } = mask;
  let maxEdge = 0;
  for (let i = 0; i < dist.length; i++) maxEdge = Math.max(maxEdge, dist[i] - topInset);
  const above = topY + 1 + (style.parapet !== undefined ? 1 : 0);

  // Plant room on the roof's inner core.
  const plant = new Uint8Array(w * d);
  if (plantRoom && style.rooftop === 'plant' && H >= 24 && maxEdge >= 5) {
    const coreMin = Math.max(3, Math.floor(maxEdge * 0.55));
    const ph = rng.int(3, 5);
    const helipad = H > 170;
    for (let i = 0; i < dist.length; i++) {
      const e = dist[i] - topInset;
      if (e < coreMin) continue;
      plant[i] = 1;
      const x = x0 + (i % w), z = z0 + Math.floor(i / w);
      for (let y = topY + 1; y < topY + ph; y++) world.set(x, y, z, M.PLANT_METAL);
      world.set(x, topY + ph, z, helipad ? (e === coreMin ? M.HELIPAD_MARK : M.HELIPAD) : M.ROOF_DARK);
    }
  }

  // Scattered small units: AC boxes on modern roofs, chimneys on heritage ones.
  for (let i = 0; i < dist.length; i++) {
    const e = dist[i] - topInset;
    if (e < 2 || plant[i]) continue;
    const x = x0 + (i % w), z = z0 + Math.floor(i / w);
    if (style.rooftop === 'plant' && rng() < 0.012) {
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const j = i + dx + dz * w;
        if (x - x0 + dx < w && dist[j] - topInset >= 2 && !plant[j]) world.setIfAir(x + dx, topY + 1, z + dz, M.PLANT_METAL);
      }
    } else if (style.rooftop === 'heritage' && rng() < 0.006) {
      world.setIfAir(x, topY + 1, z, M.RED_BRICK);
      world.setIfAir(x, above, z, M.RED_BRICK);
    }
  }
}
