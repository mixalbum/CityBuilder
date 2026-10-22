// Data sources add local knowledge on top of OpenStreetMap: surveyed building
// heights, footprints or ground levels that some cities publish as open data.
// Each source downloads into the city's cache, then contributes terrain and/or
// replacement buildings at build time. Register new ones in ./index.ts.

import type { CityProfile } from '../city/profile';
import type { BBox } from '../fetch/overpass';
import type { Terrain } from '../gen/elevation';
import type { WorldFrame } from '../geo/project';
import type { Area, Building } from '../model/features';
import type { VoxelWorld } from '../voxel/world';

export interface FetchContext {
  profile: CityProfile;
  bbox: BBox;
  /** The city's download folder (data/cache/<slug>). */
  cacheDir: string;
  force: boolean;
  log: (msg: string) => void;
}

export interface LoadContext {
  profile: CityProfile;
  cacheDir: string;
  frame: WorldFrame;
  log: (msg: string) => void;
}

export interface LoadedSource {
  /** Ground elevations, replacing the global elevation model. */
  terrain?: (areas: Area[]) => { terrain: Terrain; samples: number };
  /**
   * Buildings to generate in place of OSM's. Receives OSM's buildings (for
   * names and gaps in coverage) and the ground already laid out.
   */
  buildings?: (osm: Building[], world: VoxelWorld, terrain: Terrain) => { buildings: Building[]; summary: string };
}

export interface DataSource {
  id: string;
  /** Credit line shown in the viewer, as the licence requires. */
  attribution: string;
  description: string;
  fetch(ctx: FetchContext): Promise<void>;
  /** Undefined when nothing has been downloaded. */
  load(ctx: LoadContext): LoadedSource | undefined;
}
