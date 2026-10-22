import { M } from '../../../src/world/palette';
import type { Rng } from '../../util/rng';
import type { FacadeStyle } from './types';

/** Interwar building: strong vertical piers and a stepped top. */
export function artDeco(rng: Rng): FacadeStyle {
  const wall = rng.pick([M.SANDSTONE, M.RENDER_CREAM, M.RENDER_WHITE]);
  const pier = wall === M.RENDER_WHITE ? M.SANDSTONE : M.RENDER_WHITE;

  return {
    name: 'artDeco',
    interior: M.CONCRETE_DARK,
    roof: M.ROOF_GRAVEL,
    parapet: pier,
    rooftop: 'plant',
    inset(yRel, H) {
      if (H < 30) return 0;
      if (yRel > H * 0.92) return 4;
      if (yRel > H * 0.82) return 2;
      return 0;
    },
    wall({ yRel, fromGround, along, corner }) {
      if (corner || along % 4 === 0) return pier;
      if (fromGround < 4 && yRel === fromGround) return fromGround === 3 ? pier : M.SHOPFRONT;
      const row = (fromGround - 4) % 4;
      return row === 1 || row === 2 ? M.WINDOW_DARK : wall;
    },
  };
}
