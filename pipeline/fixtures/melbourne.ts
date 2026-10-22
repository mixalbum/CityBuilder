// Melbourne constants for the synthetic stand-in grid and the tests. Real
// cities are described by cities/<slug>/city.json (see pipeline/city/profile.ts).

import type { Extent } from '../config';

/** Flinders St / Swanston St corner. */
export const ORIGIN = { lat: -37.81747, lon: 144.96744 };

/** Bearing of the Hoddle Grid: Collins St runs this many degrees anticlockwise from due east. */
export const GRID_ANGLE_DEG_DEFAULT = 20.0;

export const EXTENTS: Record<string, Extent> = {
  full: { minX: -1360, maxX: 880, minN: -540, maxN: 1000 },
  small: { minX: -160, maxX: 160, minN: -160, maxN: 160 },
};

export const MAIN_STREETS = [
  'Flinders Street',
  'Collins Street',
  'Bourke Street',
  'Lonsdale Street',
  'La Trobe Street',
  'Spencer Street',
  'King Street',
  'William Street',
  'Queen Street',
  'Elizabeth Street',
  'Swanston Street',
  'Russell Street',
  'Exhibition Street',
  'Spring Street',
];
