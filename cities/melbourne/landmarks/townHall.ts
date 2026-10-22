// Melbourne Town Hall (1870): Second Empire sandstone on a bluestone base,
// the clock tower on the Swanston/Collins corner and the portico over the
// Swanston St footpath.

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel, SiteTier } from '../../../pipeline/gen/landmarks/types';

const isTower = (t: SiteTier) => t.roof === 'pyramidal' && t.h >= 30;

export const townHall: LandmarkModel = {
  name: 'Melbourne Town Hall',
  select: { structureAt: [44, 275] },
  style: () =>
    classical({ name: 'townHall', wall: M.SANDSTONE, trim: M.RENDER_CREAM, base: M.BLUESTONE, baseHeight: 6, bay: 5, storey: 7 }),

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    const tower = site.tiers.filter(isTower).sort((a, b) => b.h - a.h)[0];
    if (tower) {
      const cx = tower.mask.x0 + tower.mask.w / 2;
      const cz = tower.mask.z0 + tower.mask.d / 2;
      k.clockFaces(cx, cz, tower.y1 - 6, Math.min(tower.mask.w, tower.mask.d) / 2 - 0.5);
      // Flagpole above the slate cap.
      const cap = k.topAt(cx, cz) + 1;
      for (let y = cap; y < cap + 6; y++) k.set(cx, y, cz, M.FRAME_DARK);
    }
    // Portico projecting over the Swanston St (west) footpath near the corner.
    const xf = site.x0;
    const zEnd = site.z1 - 2, zStart = zEnd - 14;
    const top = k.y(10);
    k.columns('z', xf - 6, zStart, zEnd, 4, k.base, top - 1, 1, M.RENDER_CREAM);
    k.box(xf - 8, top, zStart - 2, xf - 1, top + 1, zEnd + 2, M.RENDER_CREAM);
    // Balustrade around the portico roof: posts along its outer edges.
    k.box(xf - 8, top + 2, zStart - 2, xf - 1, top + 2, zEnd + 2, (x, _y, z) =>
      (x === xf - 8 || z === zStart - 2 || z === zEnd + 2) && (x + z) % 2 === 0 ? M.RENDER_CREAM : 0,
    );
  },
};
