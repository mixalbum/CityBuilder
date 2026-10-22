import { M } from '../../../src/world/palette';
import type { Rng } from '../../util/rng';
import type { FacadeStyle } from './types';

/** 2-6 storey Victorian/Edwardian shopfront building with a parapet. */
export function victorian(rng: Rng): FacadeStyle {
  const wall = rng.pick([M.RENDER_CREAM, M.RENDER_CREAM, M.RENDER_WHITE, M.RED_BRICK, M.BROWN_BRICK, M.SANDSTONE, M.BLUESTONE]);
  const trim = wall === M.RENDER_WHITE ? M.SANDSTONE : M.RENDER_WHITE;
  const bay = rng.int(3, 4);

  return {
    name: 'victorian',
    interior: M.BROWN_BRICK,
    roof: rng.pick([M.ROOF_TIN, M.ROOF_DARK]),
    parapet: trim,
    rooftop: 'heritage',
    inset: () => 0,
    wall({ yRel, fromGround, H, along, corner }) {
      if (fromGround < 4 && yRel === fromGround) {
        // Shopfront with piers and a fascia band.
        if (fromGround === 3) return trim;
        return along % 5 === 0 || corner ? wall : M.SHOPFRONT;
      }
      if (yRel === H - 2) return trim; // cornice
      if (corner) return yRel % 2 === 0 ? trim : wall; // quoins
      const row = (fromGround - 4) & 3;
      return (row === 1 || row === 2) && along % bay === 1 ? M.WINDOW_DARK : wall;
    },
  };
}
