// Princes Bridge (1888): bluestone parapets and ornate cast-iron lamp
// standards along the Swanston St crossing of the Yarra.

import { M } from '../../../src/world/palette';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

/** Bridge span in grid metres: road centreline x and its southern/northern ends. */
const CENTRE_X = 1;
const HALF_WIDTH = 15;
const N_SOUTH = -235;
const N_NORTH = -95;

export const princesBridge: LandmarkModel = {
  name: 'Princes Bridge',
  select: {},

  build(k) {
    for (let n = N_SOUTH; n <= N_NORTH; n++) {
      const [xc, z] = k.grid(CENTRE_X, n);
      // Only where the deck crosses water or the river banks.
      const under = k.get(xc, 0, z);
      const surface = k.get(xc, k.ground(xc, z) - 1, z);
      if (under !== M.WATER && surface !== M.RIVER_BANK) continue;
      for (const side of [-HALF_WIDTH, HALF_WIDTH]) {
        const x = Math.floor(xc + side);
        const deck = k.topAt(x, z, 40) + 1;
        k.set(x, deck, z, M.BLUESTONE);
        if (n % 12 === 0) {
          for (let y = deck + 1; y <= deck + 5; y++) k.set(x, y, z, M.FRAME_DARK);
          for (const dz of [-1, 0, 1]) k.set(x, deck + 6, z + dz, M.CLOCK_FACE); // triple globes
        }
      }
    }
  },
};
