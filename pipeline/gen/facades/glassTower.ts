import { M } from '../../../src/world/palette';
import type { Rng } from '../../util/rng';
import type { FacadeStyle } from './types';

/**
 * Curtain-wall office tower. The `banded` variant is the 1960s-80s look:
 * ribbon windows between concrete spandrels.
 */
export function glassTower(rng: Rng, banded: boolean): FacadeStyle {
  const glass = rng.pick([M.GLASS_BLUE, M.GLASS_GREEN, M.GLASS_GREY, M.GLASS_BRONZE, M.GLASS_DARK]);
  const frame = rng.pick([M.FRAME_ALU, M.FRAME_DARK]);
  const spandrel = banded ? rng.pick([M.CONCRETE, M.RENDER_WHITE, M.CONCRETE_DARK]) : M.SPANDREL;
  const mullion = rng.int(3, 5);
  const lobby = rng.int(4, 6);
  const setbacks = !banded && rng() < 0.6;

  return {
    name: 'glassTower',
    interior: M.CONCRETE_DARK,
    roof: M.ROOF_GRAVEL,
    rooftop: 'plant',
    inset(yRel, H) {
      if (!setbacks || H < 90) return 0;
      if (yRel > H * 0.9) return 4;
      if (yRel > H * 0.75) return 2;
      return 0;
    },
    wall({ yRel, fromGround, H, along, corner }) {
      if (corner) return frame;
      if (fromGround < lobby && yRel === fromGround) return along % 6 === 0 ? frame : M.GLASS_DARK;
      if (yRel >= H - 2) return frame; // crown
      const row = (fromGround - lobby) & 3;
      if (banded) return row < 2 ? M.WINDOW_DARK : spandrel;
      if (row === 3) return spandrel;
      return along % mullion === 0 ? frame : glass;
    },
  };
}
