// Princess Theatre (1886): Second Empire facade on Spring St with mansard
// pavilions, the central one crowned by a gilded figure.

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { Kit } from '../../../pipeline/gen/landmarks/kit';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

function pavilion(k: Kit, xf: number, zc: number, base: number, half: number, gilded: boolean): void {
  k.box(xf - 2 * half, base, zc - half, xf, base + 4, zc + half, (_x, y) => ((y - base) % 4 === 2 ? M.WINDOW_DARK : M.RENDER_CREAM));
  k.lathe(xf - half + 0.5, zc + 0.5, base + 5, base + 5 + half, (t) => (half + 0.5) * (1 - 0.7 * t), M.ROOF_SLATE, { shape: 'square' });
  if (gilded) for (let i = 1; i <= 3; i++) k.set(xf - half + 0.5, base + 5 + half + i, zc + 0.5, M.GOLD);
}

export const princessTheatre: LandmarkModel = {
  name: 'Princess Theatre',
  select: { names: ['Princess Theatre'] },
  style: () => classical({ name: 'princess', wall: M.RENDER_CREAM, trim: M.RENDER_WHITE, baseHeight: 5, bay: 4, storey: 5 }),

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    const xf = site.x1; // Spring St (east) front
    const zc = Math.round((site.z0 + site.z1) / 2);
    const top = Math.max(...site.tiers.map((t) => t.y1));
    pavilion(k, xf, zc, top - 6, 4, true);
    pavilion(k, xf, site.z0 + 4, top - 8, 3, false);
    pavilion(k, xf, site.z1 - 4, top - 8, 3, false);
  },
};
