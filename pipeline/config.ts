// Constants shared by every pipeline stage, whatever the city. Per-city
// settings live in cities/<slug>/city.json (see pipeline/city/profile.ts).

/** First air layer on flat ground: y=0 is subsoil, y=1 is the street surface. */
export const GROUND_Y = 2;

/** Default world height when nothing taller is found; grows with the city (see build.ts). */
export const MIN_WORLD_HEIGHT = 128;
/** Upper bound on world height (voxels): the tallest buildings on Earth fit. */
export const MAX_WORLD_HEIGHT = 896;

/**
 * Extents in grid-aligned metres around a city's origin: x runs along the
 * grid's main axis (towards the east when the grid angle is 0), n runs
 * across it (towards the north).
 */
export interface Extent {
  minX: number;
  maxX: number;
  minN: number;
  maxN: number;
}

export interface LandmarkDef {
  name: string;
  /** Other OSM spellings of the name (matched case-insensitively). */
  aliases?: string[];
  /** Fallback location for buildings that are unnamed in OSM. */
  at?: { lat: number; lon: number };
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
export const DEM_ATTRIBUTION = 'Terrain: Mapzen/AWS Terrain Tiles';
