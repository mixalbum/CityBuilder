// Block Arcade (1892): ornate Collins St frontage, a glazed roof over the
// L-shaped arcade to Elizabeth St and a glass dome at its corner.

import { M } from '../../../src/world/palette';
import { ribDistance } from '../../../pipeline/gen/landmarks/kit';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const blockArcade: LandmarkModel = {
  name: 'Block Arcade',
  select: { names: ['Block Arcade'] },
  style: () =>
    classical({ name: 'blockArcade', wall: M.RENDER_WHITE, trim: M.SANDSTONE, base: M.SHOPFRONT, baseHeight: 5, bay: 4, storey: 5 }),

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    const xc = Math.round((site.x0 + site.x1) / 2);
    const zc = Math.round((site.z0 + site.z1) / 2);
    const glaze = (x: number, z: number, ridge: boolean) => {
      const y = k.topAt(x, z) + 1;
      k.set(x, y, z, M.GLASS_CLEAR);
      if (ridge) k.set(x, y + 1, z, M.FRAME_ALU);
    };
    // Skylight from Collins St (south) to the corner, then west to Elizabeth St.
    for (let z = zc; z <= site.z1; z++) for (let dx = -1; dx <= 1; dx++) glaze(xc + dx, z, dx === 0);
    for (let x = site.x0; x <= xc; x++) for (let dz = -1; dz <= 1; dz++) glaze(x, zc + dz, dz === 0);
    const y = k.topAt(xc, zc) + 1;
    k.dome(xc + 0.5, zc + 0.5, y, 4, 4, (_x, _y, _z, ang) => (ribDistance(ang, 8) < 0.08 ? M.FRAME_ALU : M.GLASS_CLEAR), { shape: 'octagon' });
  },
};
