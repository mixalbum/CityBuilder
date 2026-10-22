// St Paul's Cathedral (1891, spires 1933): Gothic Revival in sandstone with
// grey limestone banding. Rebuilt within the surveyed footprint: aisled nave
// along Swanston St, transept, a tower and 98 m spire over the crossing, and
// twin spires on the front facing Flinders St.

import { M } from '../../../src/world/palette';
import type { Kit, Mat } from '../../../pipeline/gen/landmarks/kit';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

/** Banded masonry with lancet windows on the faces of a block. */
function masonry(base: number, x0: number, z0: number, x1: number, z1: number, yTop: number, windows: boolean): Mat {
  return (x, y, z) => {
    const h = y - base;
    if (h < 2) return M.BLUESTONE; // plinth
    const edgeX = x === x0 || x === x1;
    const edgeZ = z === z0 || z === z1;
    if (windows && (edgeX || edgeZ) && !(edgeX && edgeZ) && h >= 4 && y <= yTop - 3) {
      const along = edgeX ? z : x;
      const slot = along % 5;
      if (slot === 2 && (h - 4) % 9 < 6) return M.WINDOW_DARK; // lancet
    }
    return h % 4 === 0 ? M.LIMESTONE : M.SANDSTONE;
  };
}

function block(k: Kit, x0: number, z0: number, x1: number, z1: number, h: number, windows = true): number {
  const yTop = k.y(h);
  k.box(x0, k.base, z0, x1, yTop, z1, masonry(k.base, x0, z0, x1, z1, yTop, windows));
  return yTop;
}

export const stPauls: LandmarkModel = {
  name: "St Paul's Cathedral",
  select: { names: ["Saint Paul's Cathedral", "St Paul's Cathedral"] },
  drop: () => true,

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    const { x0, z0, x1, z1 } = site;
    const xc = Math.round((x0 + x1) / 2);
    const L = z1 - z0;
    // The front (south, facing Flinders St) is z1; the chancel is north.
    const zCross = Math.round(z0 + L * 0.38);

    // Aisles, then the taller nave and transept, each under steep slate roofs.
    const aisleTop = block(k, x0 + 2, z0 + 8, x1 - 2, z1 - 3, 10);
    k.gable(x0 + 2, z0 + 8, x1 - 2, z1 - 3, aisleTop + 1, 'z', M.ROOF_SLATE);
    const naveTop = block(k, xc - 7, z0 + 2, xc + 7, z1 - 2, 20);
    k.gable(xc - 7, z0 + 2, xc + 7, z1 - 2, naveTop + 1, 'z', M.ROOF_SLATE);
    const transTop = block(k, x0, zCross - 7, x1, zCross + 7, 20);
    k.gable(x0, zCross - 7, x1, zCross + 7, transTop + 1, 'x', M.ROOF_SLATE);

    // Crossing tower and the 98 m central spire.
    const towerTop = block(k, xc - 6, zCross - 6, xc + 6, zCross + 6, 42);
    k.box(xc - 7, towerTop - 1, zCross - 7, xc + 7, towerTop, zCross + 7, M.LIMESTONE);
    k.spire(xc + 0.5, zCross + 0.5, towerTop + 1, k.y(98), 6.5, (_x, y) => ((y - towerTop) % 6 === 0 ? M.LIMESTONE : M.SANDSTONE));

    // Twin front towers with spires, and the great window between them.
    for (const tx of [x0 + 1, x1 - 8]) {
      const tTop = block(k, tx, z1 - 9, tx + 7, z1, 36);
      k.box(tx - 1, tTop - 1, z1 - 10, tx + 8, tTop, z1 + 1, M.LIMESTONE);
      k.spire(tx + 4, z1 - 4.5, tTop + 1, k.y(66), 4.2, (_x, y) => ((y - tTop) % 6 === 0 ? M.LIMESTONE : M.SANDSTONE));
    }
    for (let y = k.base + 6; y <= k.base + 17; y++)
      for (let x = xc - 3; x <= xc + 3; x++) if (Math.abs(x - xc) <= 3 - Math.max(0, y - k.base - 14)) k.set(x, y, z1 - 2, M.WINDOW_DARK);
    // Main doors.
    for (let y = k.base; y <= k.base + 4; y++) for (let x = xc - 2; x <= xc + 2; x++) k.set(x, y, z1 - 2, M.FRAME_DARK);
  },
};
