import type { Building } from '../../model/features';
import type { Rng } from '../../util/rng';
import type { Mask } from '../../voxel/rasterize';
import type { FacadeStyle } from '../facades';
import type { Kit } from './kit';

/** A footprint tier claimed by a landmark, with its rasterised shape. */
export interface SiteTier {
  b: Building;
  mask: Mask;
  dist: Uint16Array;
  /** Metres above street level. */
  minH: number;
  h: number;
  /** Voxel layers, matching generateBuildings. */
  y0: number;
  y1: number;
  roof?: string;
  /** Removed before generation so the model can replace it. */
  dropped: boolean;
}

export interface Site {
  model: LandmarkModel;
  tiers: SiteTier[];
  /** Ground layer the landmark stands on (its base tier's first layer). */
  base: number;
  /** Voxel bounding box of all claimed tiers (inclusive); empty sites use NaN. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface LandmarkModel {
  /** Matches a LANDMARKS entry in config.ts when it should appear in the viewer's jump list. */
  name: string;
  /**
   * Which footprint tiers belong to the landmark:
   * - structureAt: every tier of the structure(s) with a tier over this grid point (metres);
   * - names: tiers carrying one of these (inherited OSM) names;
   * - rect: tiers whose centroid lies in [x0, x1, n0, n1] grid metres.
   */
  select: { structureAt?: [number, number]; names?: string[]; rect?: [number, number, number, number] };
  /** Tiers to remove before generation, for the model to rebuild. */
  drop?: (t: SiteTier) => boolean;
  /** Facade for the kept tiers. */
  style?: (rng: Rng, site: Site) => FacadeStyle;
  /** Extra modelling once all buildings and trees are generated. */
  build?: (k: Kit, site: Site) => void;
}
