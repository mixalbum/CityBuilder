// Young & Jackson (1853): the sandstone hotel on the Flinders/Swanston
// corner with a bluestone ground floor and a cast-iron verandah.

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const youngAndJackson: LandmarkModel = {
  name: 'Young and Jackson',
  select: { names: ['Young & Jacksons', 'Young & Jackson'] },
  style: () =>
    classical({ name: 'youngAndJackson', wall: M.SANDSTONE, trim: M.RENDER_CREAM, base: M.BLUESTONE, baseHeight: 4, bay: 4, storey: 4 }),

  build(k, site) {
    if (Number.isNaN(site.x0)) return;
    // Verandah along the Flinders St (south) and Swanston St (east) fronts.
    const roofY = k.base + 4;
    const post = (x: number, z: number) => {
      for (let y = k.base; y < roofY; y++) k.set(x, y, z, M.FRAME_DARK);
    };
    k.box(site.x0, roofY, site.z1 + 1, site.x1 + 3, roofY, site.z1 + 3, M.ROOF_TIN);
    k.box(site.x1 + 1, roofY, site.z0, site.x1 + 3, roofY, site.z1 + 3, M.ROOF_TIN);
    for (let x = site.x0; x <= site.x1 + 3; x += 4) post(x, site.z1 + 3);
    for (let z = site.z0; z <= site.z1 + 3; z += 4) post(site.x1 + 3, z);
  },
};
