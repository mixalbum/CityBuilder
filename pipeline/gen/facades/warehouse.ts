import { M } from '../../../src/world/palette';
import type { Rng } from '../../util/rng';
import type { FacadeStyle } from './types';

/** Laneway brick warehouse: small windows and a loading door. */
export function warehouse(rng: Rng): FacadeStyle {
  const wall = rng.pick([M.RED_BRICK, M.BROWN_BRICK]);

  return {
    name: 'warehouse',
    interior: M.BROWN_BRICK,
    roof: M.ROOF_TIN,
    parapet: wall,
    rooftop: 'heritage',
    inset: () => 0,
    wall({ yRel, fromGround, along, corner }) {
      if (corner) return wall;
      const slot = along % 8;
      if (fromGround < 3 && yRel === fromGround && slot >= 3 && slot <= 5) return M.FRAME_DARK;
      return fromGround % 4 === 2 && along % 4 === 2 ? M.WINDOW_DARK : wall;
    },
  };
}
