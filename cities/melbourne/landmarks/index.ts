// Melbourne's hand-modelled landmarks. Each model claims its building's
// footprint tiers and restyles or rebuilds them (see docs/LANDMARKS.md).

import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';
import { artsCentre } from './artsCentre';
import { blockArcade } from './blockArcade';
import { eurekaTower } from './eurekaTower';
import { federationSquare } from './federationSquare';
import { flindersStreetStation } from './flindersStreetStation';
import { gpo } from './gpo';
import { hamerHall } from './hamerHall';
import { manchesterUnity } from './manchesterUnity';
import { melbourneCentral } from './melbourneCentral';
import { oldTreasury } from './oldTreasury';
import { parliamentHouse } from './parliamentHouse';
import { princesBridge } from './princesBridge';
import { princessTheatre } from './princessTheatre';
import { southernCross } from './southernCross';
import { stPauls } from './stPauls';
import { stateLibrary } from './stateLibrary';
import { townHall } from './townHall';
import { youngAndJackson } from './youngAndJackson';

export const models: LandmarkModel[] = [
  flindersStreetStation,
  stPauls,
  federationSquare,
  stateLibrary,
  artsCentre,
  eurekaTower,
  melbourneCentral,
  southernCross,
  parliamentHouse,
  princessTheatre,
  oldTreasury,
  gpo,
  blockArcade,
  townHall,
  manchesterUnity,
  hamerHall,
  youngAndJackson,
  princesBridge,
];
