// Federation Square (2002): shards clad in a fractal "pinwheel" of
// triangular sandstone, zinc and glass panels around an ochre sandstone plaza.

import { M } from '../../../src/world/palette';
import { hashString } from '../../../pipeline/util/rng';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

const PANELS = [M.SANDSTONE, M.SANDSTONE, M.SANDSTONE, M.SANDSTONE, M.SANDSTONE, M.PLANT_METAL, M.PLANT_METAL, M.GLASS_GREY];
const PANEL = 8;
const PAVEABLE = new Set([M.FOOTPATH, M.PAVING_LIGHT, M.GRASS, M.GRASS_DARK]);

export const federationSquare: LandmarkModel = {
  name: 'Federation Square',
  select: { rect: [12, 205, -118, -12] },

  style: () => ({
    name: 'fedSquare',
    interior: M.CONCRETE_DARK,
    roof: M.PLANT_METAL,
    pitchedRoof: M.PLANT_METAL,
    rooftop: 'none',
    inset: () => 0,
    wall({ fromGround, along, alongAxis }) {
      // Each square panel splits into two triangles along its diagonal; the
      // diagonal itself reads as a dark joint.
      const u = Math.floor(along / PANEL), v = Math.floor(fromGround / PANEL);
      const lu = along % PANEL, lv = fromGround % PANEL;
      if (lu + lv === PANEL - 1) return M.CONCRETE_DARK;
      const upper = lu + lv >= PANEL ? 1 : 0;
      return PANELS[hashString(`${alongAxis}${u},${v},${upper}`) % PANELS.length];
    },
  }),

  build(k, site) {
    const [ax, az] = k.grid(12, -12);
    const [bx, bz] = k.grid(205, -118);
    k.pave(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), M.PAVING_OCHRE, (m) => PAVEABLE.has(m));
    void site;
  },
};
