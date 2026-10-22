// Parliament House (1856–1929): the Spring St front's giant Doric colonnade
// raised on a broad flight of steps, over sandstone wings.

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const parliamentHouse: LandmarkModel = {
  name: 'Parliament House',
  select: { names: ['Parliament House', 'Parliament House Victoria'] },
  style: () => classical({ name: 'parliament', wall: M.SANDSTONE, trim: M.RENDER_CREAM, baseHeight: 6, bay: 5, storey: 6 }),

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    const xf = site.x0; // Spring St (west) front
    const zc = Math.round((site.z0 + site.z1) / 2);
    const half = Math.round((site.z1 - site.z0) * 0.3);
    const podium = k.base + 3;
    // Steps rising to the colonnade podium.
    for (let s = 0; s <= 3; s++) k.box(xf - 8 - 2 * s, k.base, zc - half - 2, xf - 1, podium - s, zc + half + 2, M.PAVING_LIGHT);
    // Colonnade, entablature and a low pediment-less attic.
    const top = k.y(20);
    k.columns('z', xf - 6, zc - half, zc + half, 4, podium + 1, top - 1, 1.2, M.RENDER_CREAM);
    k.box(xf - 8, top, zc - half - 2, xf - 1, top + 2, zc + half + 2, M.RENDER_CREAM);
    k.box(xf - 8, top + 3, zc - half - 2, xf - 1, top + 3, zc + half + 2, M.SANDSTONE);
  },
};
