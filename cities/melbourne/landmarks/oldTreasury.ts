// Old Treasury Building (1862): Renaissance Revival sandstone closing the
// vista up Collins St, with a rusticated base and arched central entrance.

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const oldTreasury: LandmarkModel = {
  name: 'Old Treasury Building',
  select: { names: ['Old Treasury Building'] },
  style: () =>
    classical({ name: 'oldTreasury', wall: M.SANDSTONE, trim: M.RENDER_CREAM, base: M.LIMESTONE, baseHeight: 7, bay: 5, storey: 6 }),

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    const xf = site.x0; // Spring St (west) front, facing down Collins St
    const zc = Math.round((site.z0 + site.z1) / 2);
    // Projecting entrance bay with a tall arch, and steps.
    k.box(xf - 3, k.base, zc - 6, xf - 1, k.y(14), zc + 6, (_x, y, z) => {
      const h = y - k.base;
      if (Math.abs(z - zc) <= 2 && h <= 8 - Math.max(0, Math.abs(z - zc) - 1)) return M.WINDOW_DARK;
      return h % 2 === 0 ? M.LIMESTONE : M.SANDSTONE;
    });
    for (let s = 0; s < 3; s++) k.box(xf - 9 + 2 * s, k.base, zc - 7, xf - 4, k.base + s, zc + 7, M.PAVING_LIGHT);
  },
};
