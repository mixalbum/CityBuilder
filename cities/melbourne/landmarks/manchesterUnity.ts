// Manchester Unity Building (1932): Gothic-tinged Art Deco in cream
// terracotta faience, ribbed with piers, and a stepped corner tower.

import { M } from '../../../src/world/palette';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const manchesterUnity: LandmarkModel = {
  name: 'Manchester Unity Building',
  select: { names: ['Manchester Unity Building'] },

  style: () => ({
    name: 'manchesterUnity',
    interior: M.CONCRETE_DARK,
    roof: M.ROOF_GRAVEL,
    parapet: M.RENDER_WHITE,
    rooftop: 'none',
    inset: () => 0,
    wall({ fromGround, along, corner }) {
      if (fromGround < 5) return fromGround === 4 ? M.GOLD : along % 4 === 0 ? M.RENDER_CREAM : M.SHOPFRONT;
      if (corner || along % 3 === 0) return M.RENDER_WHITE; // faience piers
      return fromGround % 4 === 0 ? M.RENDER_CREAM : M.WINDOW_DARK;
    },
  }),

  build(k, site) {
    const tower = [...site.tiers].sort((a, b) => b.h - a.h)[0];
    if (!tower) return;
    const cx = tower.mask.x0 + tower.mask.w / 2;
    const cz = tower.mask.z0 + tower.mask.d / 2;
    const r = Math.min(tower.mask.w, tower.mask.d) / 2;
    // Stepped crown and mast.
    k.lathe(cx, cz, tower.y1 + 1, tower.y1 + 4, (t) => r * (0.8 - 0.5 * t), M.RENDER_WHITE, { shape: 'octagon' });
    for (let y = tower.y1 + 5; y < tower.y1 + 10; y++) k.set(cx, y, cz, M.FRAME_DARK);
    k.set(cx, tower.y1 + 10, cz, M.GOLD);
  },
};
