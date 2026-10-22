// General Post Office (1867–1907): three colonnaded storeys on the corner of
// Bourke and Elizabeth Sts, with the clock tower over the corner.

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel, SiteTier } from '../../../pipeline/gen/landmarks/types';

const isTower = (t: SiteTier) => t.h > 40;

export const gpo: LandmarkModel = {
  name: 'General Post Office',
  select: { structureAt: [-195, 528] },
  style: () => classical({ name: 'gpo', wall: M.RENDER_WHITE, trim: M.SANDSTONE, bay: 4, storey: 6, window: M.SHOPFRONT }),

  build(k, site) {
    const tower = site.tiers.filter(isTower).sort((a, b) => b.h - a.h)[0];
    if (!tower) return;
    const cx = tower.mask.x0 + tower.mask.w / 2;
    const cz = tower.mask.z0 + tower.mask.d / 2;
    k.clockFaces(cx, cz, tower.y1 - 5, Math.min(tower.mask.w, tower.mask.d) / 2 - 0.5);
  },
};
