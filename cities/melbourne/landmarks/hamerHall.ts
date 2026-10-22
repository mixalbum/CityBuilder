// Hamer Hall (1982, renewed 2012): the round concert hall on the riverbank,
// bluestone banded in white, glazed at street level.

import { M } from '../../../src/world/palette';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const hamerHall: LandmarkModel = {
  name: 'Hamer Hall',
  select: { names: ['Hamer Hall'] },
  style: () => ({
    name: 'hamerHall',
    interior: M.CONCRETE_DARK,
    roof: M.ROOF_DARK,
    pitchedRoof: M.ROOF_DARK,
    rooftop: 'none',
    inset: () => 0,
    wall: ({ fromGround }) => (fromGround < 5 ? (fromGround === 4 ? M.RENDER_WHITE : M.GLASS_DARK) : fromGround % 5 === 4 ? M.RENDER_WHITE : M.BLUESTONE),
  }),
};
