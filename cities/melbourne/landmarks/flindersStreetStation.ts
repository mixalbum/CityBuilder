// Flinders Street Station (1910): ochre Edwardian Baroque frontage with cream
// banding and arched windows, green-capped turrets, and the copper dome over
// the main entrance at the Swanston St corner, with the row of clocks below.

import { M } from '../../../src/world/palette';
import { ribDistance, sector } from '../../../pipeline/gen/landmarks/kit';
import type { LandmarkModel, SiteTier } from '../../../pipeline/gen/landmarks/types';

const isDome = (t: SiteTier) => t.roof === 'pyramidal' && t.h > 35;

export const flindersStreetStation: LandmarkModel = {
  name: 'Flinders Street Station',
  select: { structureAt: [-150, -30] },
  drop: isDome,

  style: () => ({
    name: 'flindersStation',
    interior: M.BROWN_BRICK,
    roof: M.ROOF_SLATE,
    // Copper caps on the turrets; slate over the long roofs.
    pitchedRoof: (shape) => (shape === 'pyramidal' ? M.COPPER_GREEN : M.ROOF_SLATE),
    parapet: M.RENDER_CREAM,
    rooftop: 'none',
    inset: () => 0,
    wall({ yRel, fromGround, H, along, corner }) {
      if (corner || yRel >= H - 1) return M.RENDER_CREAM;
      if (fromGround < 6) {
        // Street-level arcade of round arches.
        const a = along % 7;
        if (fromGround === 5 || a === 0) return M.RENDER_CREAM;
        if (fromGround === 4 && (a === 1 || a === 6)) return M.OCHRE;
        return M.SHOPFRONT;
      }
      const row = (fromGround - 6) % 6;
      if (row === 0) return M.RENDER_CREAM; // string course
      const a = along % 6;
      if (row >= 1 && row <= 3 && a >= 2 && a <= 4) return M.WINDOW_DARK;
      if (row === 4 && a === 3) return M.WINDOW_DARK; // arched head
      return M.OCHRE;
    },
  }),

  build(k, site) {
    const dome = site.tiers.find(isDome);
    if (!dome) return;
    const cx = dome.mask.x0 + dome.mask.w / 2;
    const cz = dome.mask.z0 + dome.mask.d / 2;
    const r = Math.min(dome.mask.w, dome.mask.d) / 2;
    const drumBase = dome.y0;
    const drumTop = drumBase + 5;

    // Drum ringed with arched windows, a cream cornice, then the copper dome.
    k.lathe(cx, cz, drumBase, drumTop, () => r - 1, (_x, y, _z, ang) => {
      const row = y - drumBase;
      return row >= 1 && row <= 3 && sector(ang, 16) % 2 === 0 ? M.WINDOW_DARK : M.OCHRE;
    });
    k.lathe(cx, cz, drumTop + 1, drumTop + 1, () => r, M.RENDER_CREAM);
    const domeTop = Math.max(drumTop + 4, dome.y1 - 4);
    k.dome(cx, cz, drumTop + 2, r - 1, domeTop - drumTop - 2, (_x, _y, _z, ang) => (ribDistance(ang, 12) < 0.06 ? M.RENDER_CREAM : M.COPPER_GREEN));
    // Lantern and finial.
    k.lathe(cx, cz, domeTop + 1, domeTop + 3, () => 1.6, (_x, y) => (y === domeTop + 2 ? M.WINDOW_DARK : M.RENDER_CREAM));
    k.dome(cx, cz, domeTop + 4, 1.6, 2, M.COPPER_GREEN);
    k.set(cx, domeTop + 7, cz, M.GOLD);
    k.set(cx, domeTop + 8, cz, M.GOLD);

    // "Under the clocks": the main entrance arch on the Flinders St frontage
    // below the dome, with the row of clocks above it.
    const frontage = site.tiers.filter((t) => !t.dropped && t.minH > 10 && t.h > 20).sort((a, b) => b.mask.count - a.mask.count)[0];
    if (!frontage) return;
    const zFront = frontage.mask.z0; // north edge, facing Flinders St
    for (let x = Math.floor(cx) - 4; x <= Math.floor(cx) + 4; x++) {
      const off = Math.abs(x - Math.floor(cx));
      for (let y = k.base; y <= k.base + 8 - (off > 2 ? off - 2 : 0); y++) k.set(x, y, zFront, M.SHOPFRONT);
    }
    for (let i = -4; i <= 4; i += 2) {
      const x = Math.floor(cx) + i;
      k.set(x, k.base + 10, zFront - 1, M.CLOCK_FACE);
      k.set(x, k.base + 11, zFront - 1, M.FRAME_DARK);
    }
  },
};
