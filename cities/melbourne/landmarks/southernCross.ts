// Southern Cross Station (2006): the undulating "dune" roof on slender
// columns, each dune topped by a ventilation cowl, open over the platforms.

import { M } from '../../../src/world/palette';
import type { LandmarkModel, SiteTier } from '../../../pipeline/gen/landmarks/types';

/** The station's great gabled roof tier (184 x 212 m); smaller tiers are the office wing. */
const isRoof = (t: SiteTier) => t.roof === 'gabled' && t.minH > 5 && t.mask.count > 10_000;
const BAY_X = 37;
const BAY_Z = 30;

export const southernCross: LandmarkModel = {
  name: 'Southern Cross Station',
  select: { names: ['Southern Cross'] },
  drop: isRoof,

  style: () => ({
    name: 'southernCross',
    interior: M.CONCRETE_DARK,
    roof: M.CONCRETE,
    rooftop: 'none',
    inset: () => 0,
    wall: ({ fromGround, along }) => (along % 8 === 0 || fromGround === 4 ? M.CONCRETE : M.GLASS_GREY),
  }),

  build(k, site) {
    const roof = site.tiers.find(isRoof);
    if (!roof) return;
    const { x0, z0, w, d } = roof.mask;
    const lo = roof.y0, hi = roof.y1;

    // Height field: a grid of dunes peaking mid-bay.
    const hAt = new Int16Array(w * d).fill(-1);
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        if (!roof.dist[lz * w + lx]) continue;
        const fu = (lx / BAY_X) % 1, fz = (lz / BAY_Z) % 1;
        hAt[lz * w + lx] = Math.round(lo + 1 + (hi - lo) * 0.6 * Math.sin(Math.PI * fu) * Math.sin(Math.PI * fz));
      }
    // Roof skin, filled down to the lowest neighbour so slopes have no holes.
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        const h = hAt[lz * w + lx];
        if (h < 0) continue;
        let low = h;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = lx + dx, nz = lz + dz;
          const nh = nx >= 0 && nz >= 0 && nx < w && nz < d ? hAt[nz * w + nx] : -1;
          if (nh >= 0) low = Math.min(low, nh + 1);
        }
        for (let y = low; y <= h; y++) k.set(x0 + lx, y, z0 + lz, M.ROOF_TIN);
        // Columns on a regular grid, away from the edges.
        if (lx % 24 === 12 && lz % 24 === 12 && roof.dist[lz * w + lx] > 3)
          for (let y = k.base; y < low; y++) k.set(x0 + lx, y, z0 + lz, M.FRAME_DARK);
      }
    // Cowls at the dune peaks.
    for (let bz = BAY_Z / 2; bz < d; bz += BAY_Z)
      for (let bx = BAY_X / 2; bx < w; bx += BAY_X) {
        const i = Math.floor(bz) * w + Math.floor(bx);
        if (hAt[i] < 0 || roof.dist[i] < 4) continue;
        k.lathe(x0 + bx, z0 + bz, hAt[i] + 1, hAt[i] + 3, () => 1.6, (_x, y) => (y === hAt[i] + 3 ? M.FRAME_DARK : M.RENDER_WHITE));
      }
  },
};
