// Eureka Tower (2006): blue-grey glass ruled with white lines, the gold-glazed
// top ten floors, and the red stripe for the blood spilt at the Eureka
// Stockade.

import { M } from '../../../src/world/palette';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

const GOLD_FROM = 262;
const PODIUM = 32;

export const eurekaTower: LandmarkModel = {
  name: 'Eureka Tower',
  select: { structureAt: [-395, -337] },

  style: (_rng, site) => {
    const stripe = Math.round((site.x0 + site.x1) / 2) + 6;
    return {
      name: 'eureka',
      interior: M.CONCRETE_DARK,
      roof: M.ROOF_DARK,
      parapet: M.FRAME_ALU,
      rooftop: 'none',
      inset: () => 0,
      wall({ fromGround, along, alongAxis, corner }) {
        if (fromGround < PODIUM) return fromGround % 3 === 2 ? M.CONCRETE : M.GLASS_DARK;
        if (fromGround >= GOLD_FROM) return corner ? M.FRAME_ALU : M.GOLD;
        if (alongAxis === 'x' && (along === stripe || along === stripe + 1) && fromGround > 90) return M.EUREKA_RED;
        if (corner || fromGround % 3 === 2) return M.FRAME_ALU;
        return M.GLASS_BLUE;
      },
    };
  },
};
