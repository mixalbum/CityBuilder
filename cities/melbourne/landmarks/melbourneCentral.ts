// Melbourne Central: the glass cone over Coop's Shot Tower (1889). The cone
// isn't in the footprint data, so it is placed from the tower's coordinate
// and seated on whatever roof is there.

import { M } from '../../../src/world/palette';
import { ribDistance, sector } from '../../../pipeline/gen/landmarks/kit';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

/** Coop's Shot Tower, grid metres. */
const TOWER: [number, number] = [-95, 885];
const CONE_RADIUS = 21;
const CONE_APEX = 76;
const TOWER_HEIGHT = 50;

export const melbourneCentral: LandmarkModel = {
  name: 'Melbourne Central',
  select: {},

  build(kit) {
    const [cx, cz] = kit.grid(...TOWER);
    const k = kit.withBase(kit.ground(cx, cz));
    const roof = k.topAt(cx, cz, k.y(45));
    const apex = k.y(CONE_APEX);

    // Brick shot tower with a slate cap (inside the cone).
    k.lathe(cx, cz, k.base, k.y(TOWER_HEIGHT), () => 5, (_x, y, _z, ang) =>
      (y - k.base) % 6 === 3 && sector(ang, 8) % 2 === 0 ? M.WINDOW_DARK : M.RED_BRICK,
    );
    k.lathe(cx, cz, k.y(TOWER_HEIGHT) + 1, k.y(TOWER_HEIGHT) + 4, (t) => 5.5 * (1 - t) + 0.4, M.ROOF_SLATE);

    // Glass cone framed by steel rings and meridian ribs.
    k.lathe(cx, cz, roof + 1, apex, (t) => CONE_RADIUS * (1 - t) + 0.4, (_x, y, _z, ang) =>
      (y - roof) % 5 === 0 || ribDistance(ang, 16) < 0.07 ? M.FRAME_ALU : M.GLASS_CLEAR,
    { shell: 1.2 });
  },
};
