// A city profile describes one city: where it is, how much of it to build and
// any local knowledge (street widths, landmarks, extra data sources). Profiles
// live in cities/<slug>/city.json; `npm run new-city` writes one from a place
// name, and everything in it can be tuned by hand afterwards.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Extent, LandmarkDef } from '../config';
import type { LandmarkModel } from '../gen/landmarks/types';
import type { LatLon } from '../geo/project';

export const CITIES_DIR = 'cities';

/** A rule giving matching streets a fixed corridor width (e.g. a city's grand boulevards). */
export interface StreetWidthRule {
  /** Regular expression matched against the street's OSM name. */
  match?: string;
  /** Regular expression matched against the OSM highway class (e.g. "^service$"). */
  highway?: string;
  /** Full corridor width including footpaths, in metres; the OSM width tag when omitted. */
  width?: number;
  /** Carriageway width; the rest of the corridor is footpath. */
  carriageway?: number;
  /** How the street is drawn: 'main' and 'little' are asphalt with footpaths, 'lane' is cobbled. */
  kind?: 'main' | 'little' | 'lane';
}

/** A camera view for `npm run screenshots`: offsets are voxels from the target. */
export interface ViewDef {
  name: string;
  /** Aim at a landmark (by name), else at the city's origin. */
  landmark?: string;
  target?: 'origin';
  /** Move the target, e.g. along a street. */
  shift?: [number, number, number];
  offset: [number, number, number];
  /** Aim this fraction of the landmark's height up. */
  lift?: number;
  /** Time of day in hours; 14.5 by default. */
  time?: number;
  /** Aim at the tram nearest this point (voxels from the origin). */
  tramNear?: [number, number];
  /** Switch camera mode, then hold `keys` for `seconds` of simulated time. */
  mode?: 'fly' | 'walk' | 'diorama';
  /** Orthographic zoom for diorama views. */
  zoom?: number;
  keys?: string[];
  seconds?: number;
}

export interface CityProfile {
  /** Folder name under cities/, also used in URLs (?city=slug). */
  slug: string;
  /** Display name, shown in the viewer's title. */
  name: string;
  /** The place search that created the profile, for reference. */
  query?: string;
  /** Centre of the model: the world origin. */
  origin: LatLon;
  /** Area to build, in metres around the origin along the street grid. */
  extent: Extent;
  /** Fixed street-grid bearing in degrees anticlockwise from east; estimated from the streets when omitted. */
  gridAngleDeg?: number;
  /** Streets whose bearing defines the grid (all major roads when omitted). */
  gridStreets?: string[];
  /** Fixed widths for named streets; other roads are sized by their OSM class, lanes and width tags. */
  streetWidths?: StreetWidthRule[];
  /** Height in metres for buildings with no height, levels or known type. Default 10. */
  defaultHeight?: number;
  /** 'auto' (default) uses a data source's terrain if one provides it, else the global elevation model. */
  terrain?: 'auto' | 'dem' | 'flat';
  /** Extra data sources by id (see pipeline/sources), e.g. ["melbourne-footprints"]. */
  sources?: string[];
  /** Landmarks for the viewer's jump list; matched by OSM name. */
  landmarks?: LandmarkDef[];
  /** How many more landmarks to pick automatically from notable OSM buildings. Default 10. */
  autoLandmarks?: number;
  /** Extra camera views for `npm run screenshots`. */
  views?: ViewDef[];
}


export function cityDir(slug: string): string {
  return join(CITIES_DIR, slug);
}

/** Downloads for one city (gitignored). */
export function cacheDir(slug: string): string {
  return join('data', 'cache', slug);
}

/** Where a built city is written for the viewer. */
export function outDir(slug: string): string {
  return join('public', 'cities', slug);
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'city'
  );
}

/** An extent of `width` × `depth` metres centred on the origin. */
export function extentAround(width: number, depth = width): Extent {
  return { minX: -width / 2, maxX: width / 2, minN: -depth / 2, maxN: depth / 2 };
}

/** Check a parsed profile, filling the slug from its folder. Throws with a readable message. */
export function validateProfile(raw: unknown, slug: string): CityProfile {
  const p = raw as Partial<CityProfile>;
  const fail = (msg: string): never => {
    throw new Error(`cities/${slug}/city.json: ${msg}`);
  };
  if (!p || typeof p !== 'object') fail('not a JSON object');
  if (typeof p.name !== 'string' || !p.name) fail('"name" is required');
  const o = p.origin;
  if (!o || typeof o.lat !== 'number' || typeof o.lon !== 'number' || Math.abs(o.lat) > 85 || Math.abs(o.lon) > 180)
    fail('"origin" must be { "lat": number, "lon": number }');
  const e = p.extent;
  if (!e || ![e.minX, e.maxX, e.minN, e.maxN].every((v) => typeof v === 'number') || e.maxX <= e.minX || e.maxN <= e.minN)
    fail('"extent" must be { "minX", "maxX", "minN", "maxN" } in metres, with max > min');
  const area = (e!.maxX - e!.minX) * (e!.maxN - e!.minN);
  if (area > 36e6) fail(`the extent is ${(area / 1e6).toFixed(0)} km²; keep it under 36 km² (e.g. 6 × 6 km)`);
  for (const r of p.streetWidths ?? []) {
    if (r.match === undefined && r.highway === undefined) fail('each streetWidths rule needs "match" or "highway"');
    for (const re of [r.match, r.highway])
      try {
        if (re !== undefined) new RegExp(re);
      } catch {
        fail(`streetWidths: "${re}" is not a valid regular expression`);
      }
  }
  return { ...(p as CityProfile), slug };
}

export function loadProfile(slug: string): CityProfile {
  const path = join(cityDir(slug), 'city.json');
  if (!existsSync(path)) {
    const known = listProfiles();
    throw new Error(
      `No city "${slug}" (looked for ${path}).` +
        (known.length ? ` Known cities: ${known.join(', ')}.` : '') +
        ` Create one with: npm run new-city -- "<place name>"`,
    );
  }
  return validateProfile(JSON.parse(readFileSync(path, 'utf8')), slug);
}

export function listProfiles(): string[] {
  if (!existsSync(CITIES_DIR)) return [];
  return readdirSync(CITIES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CITIES_DIR, d.name, 'city.json')))
    .map((d) => d.name)
    .sort();
}

/** The city's hand-made landmark models, from cities/<slug>/landmarks/index.ts, if it has any. */
export async function loadLandmarkModels(slug: string): Promise<LandmarkModel[]> {
  const path = resolve(cityDir(slug), 'landmarks', 'index.ts');
  if (!existsSync(path)) return [];
  const mod = (await import(pathToFileURL(path).href)) as { models?: LandmarkModel[] };
  return mod.models ?? [];
}
