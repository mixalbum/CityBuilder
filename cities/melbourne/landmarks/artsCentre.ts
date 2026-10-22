// Arts Centre Melbourne: bluestone-banded theatres under the 162 m white
// lattice spire, which flares into a pleated "skirt" at its base.

import { M } from '../../../src/world/palette';
import { ribDistance } from '../../../pipeline/gen/landmarks/kit';
import type { LandmarkModel, SiteTier } from '../../../pipeline/gen/landmarks/types';

const isSpire = (t: SiteTier) => t.minH >= 29;
const SPIRE_TOP = 162;

export const artsCentre: LandmarkModel = {
  name: 'Arts Centre Melbourne',
  select: { structureAt: [-71.5, -448] },
  drop: isSpire,

  style: () => ({
    name: 'artsCentre',
    interior: M.CONCRETE_DARK,
    roof: M.ROOF_DARK,
    pitchedRoof: M.ROOF_DARK,
    rooftop: 'none',
    inset: () => 0,
    wall: ({ fromGround }) => (fromGround % 6 === 5 ? M.RENDER_WHITE : M.BLUESTONE),
  }),

  build(k, site) {
    const spire = site.tiers.filter(isSpire).sort((a, b) => b.h - a.h)[0];
    if (!spire) return;
    const cx = spire.mask.x0 + spire.mask.w / 2;
    const cz = spire.mask.z0 + spire.mask.d / 2;
    const base = k.topAt(cx, cz, k.y(32)) + 1;
    const top = k.y(SPIRE_TOP);
    const span = top - base;
    const hAt = (t: number) => t * span; // metres above the base

    const radius = (t: number) => {
      const h = hAt(t);
      if (h < 24) return 6.5 + 12 * (1 - h / 24) ** 2; // skirt
      if (h < span - 22) return 6.5 - 5.5 * ((h - 24) / (span - 46)); // lattice cone
      return 0.5; // mast
    };
    k.lathe(cx, cz, base, top, radius, (_x, y, _z, ang, t) => {
      const r = radius(t);
      if (r < 2.5) return M.RENDER_WHITE;
      const ring = (y - base) % 5 === 0;
      const rib = ribDistance(ang, hAt(t) < 24 ? 36 : 12) < (hAt(t) < 24 ? 0.2 : 0.12);
      return ring || rib ? M.RENDER_WHITE : 0;
    }, { shell: 1.2 });
    k.set(cx, top + 1, cz, M.CLOCK_FACE);
  },
};
