// State Library Victoria (1856–1913): classical sandstone ranges with white
// pilasters, the octagonal La Trobe Reading Room under its copper dome, and
// the columned portico facing Swanston St.

import { M } from '../../../src/world/palette';
import { ribDistance, sector } from '../../../pipeline/gen/landmarks/kit';
import type { LandmarkModel, SiteTier } from '../../../pipeline/gen/landmarks/types';

/** The drum (21.5–29.5 m) and cupola (to 43.5 m) tiers of the reading room. */
const isDomeTier = (t: SiteTier) => t.minH >= 20 && t.h >= 29;

export const stateLibrary: LandmarkModel = {
  name: 'State Library Victoria',
  select: { structureAt: [106, 864] },
  drop: isDomeTier,

  style: () => ({
    name: 'stateLibrary',
    interior: M.CONCRETE_DARK,
    roof: M.ROOF_SLATE,
    pitchedRoof: M.ROOF_SLATE,
    parapet: M.RENDER_WHITE,
    rooftop: 'none',
    inset: () => 0,
    wall({ yRel, fromGround, H, along, corner }) {
      if (corner || along % 6 === 0) return M.RENDER_WHITE; // pilasters
      if (yRel >= H - 2) return M.RENDER_WHITE; // entablature
      const row = fromGround % 6;
      const a = along % 6;
      if (row >= 2 && row <= 4 && a >= 2 && a <= 4) return M.WINDOW_DARK;
      return M.SANDSTONE;
    },
  }),

  build(k, site) {
    const tiers = site.tiers.filter(isDomeTier);
    if (!tiers.length) return;
    const drum = tiers.reduce((a, b) => (a.mask.count > b.mask.count ? a : b));
    const cupola = tiers.reduce((a, b) => (a.h > b.h ? a : b));
    const cx = drum.mask.x0 + drum.mask.w / 2;
    const cz = drum.mask.z0 + drum.mask.d / 2;
    const R = Math.min(drum.mask.w, drum.mask.d) / 2 - 2;
    const top = cupola.y1;

    // Octagonal drum with tall windows, then the ribbed copper dome.
    k.lathe(cx, cz, drum.y0, drum.y1, () => R, (_x, y, _z, ang) => {
      const row = y - drum.y0;
      return row >= 2 && row <= 6 && sector(ang, 24) % 3 === 1 ? M.WINDOW_DARK : M.SANDSTONE;
    }, { shape: 'octagon' });
    k.lathe(cx, cz, drum.y1 + 1, drum.y1 + 1, () => R + 1, M.RENDER_WHITE, { shape: 'octagon' });
    k.dome(cx, cz, drum.y1 + 2, R - 1, top - drum.y1 - 4, (_x, _y, _z, ang) => (ribDistance(ang - Math.PI / 8, 8) < 0.05 ? M.RENDER_WHITE : M.COPPER_GREEN), { shape: 'octagon' });
    // Glazed lantern.
    k.lathe(cx, cz, top - 2, top, () => 3, (_x, y) => (y === top ? M.COPPER_GREEN : M.GLASS_CLEAR), { shape: 'octagon' });
    k.set(cx, top + 1, cz, M.GOLD);

    // Portico on the Swanston St (west) front, centred on the dome.
    const xf = site.x0;
    const zc = Math.round(cz);
    const yEnt = k.y(14);
    for (let z = zc - 14; z <= zc + 14; z += 4) k.lathe(xf - 4, z + 0.5, k.base + 1, yEnt - 1, () => 1.2, M.RENDER_WHITE);
    k.box(xf - 6, yEnt, zc - 16, xf, yEnt + 1, zc + 16, M.RENDER_WHITE);
    for (let i = 0; i <= 6; i++) k.box(xf - 6, yEnt + 2 + i, zc - 16 + Math.round(i * 2.5), xf, yEnt + 2 + i, zc + 16 - Math.round(i * 2.5), i === 6 ? M.ROOF_SLATE : M.RENDER_WHITE);
    // Steps up to the portico.
    for (let s = 0; s < 3; s++) k.box(xf - 10 + s * 2, k.base, zc - 15, xf - 1, k.base + s, zc + 15, M.PAVING_LIGHT);
  },
};
