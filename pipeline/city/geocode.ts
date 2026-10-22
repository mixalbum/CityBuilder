// Turn a place name into a city profile: look it up with OpenStreetMap's
// Nominatim geocoder (Photon as a fallback) and choose an extent around it.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchWithRetry, USER_AGENT as UA } from '../fetch/http';
import { cityDir, extentAround, slugify, type CityProfile } from './profile';

export interface Place {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  /** [south, north, west, east] when the geocoder gives one. */
  bounds?: [number, number, number, number];
}


export async function geocode(query: string, log: (msg: string) => void = console.log): Promise<Place> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const hits = JSON.parse(await fetchWithRetry(url, { headers: { 'User-Agent': UA } }, 3, log)) as {
      lat: string;
      lon: string;
      name?: string;
      display_name: string;
      boundingbox?: string[];
    }[];
    if (hits.length) {
      const h = hits[0];
      return {
        name: h.name || h.display_name.split(',')[0],
        displayName: h.display_name,
        lat: parseFloat(h.lat),
        lon: parseFloat(h.lon),
        bounds: h.boundingbox?.map(Number) as Place['bounds'],
      };
    }
  } catch (err) {
    log(`Nominatim failed (${String(err).slice(0, 120)}); trying Photon`);
  }
  const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`;
  const res = JSON.parse(await fetchWithRetry(url, { headers: { 'User-Agent': UA } }, 3, log)) as {
    features: { geometry: { coordinates: [number, number] }; properties: { name?: string; city?: string; country?: string; extent?: number[] } }[];
  };
  const f = res.features[0];
  if (!f) throw new Error(`Could not find "${query}". Try adding the country, e.g. "Wellington, New Zealand", or pass --center lat,lon.`);
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  const e = p.extent; // [west, north, east, south]
  return {
    name: p.name ?? query,
    displayName: [p.name, p.city, p.country].filter(Boolean).join(', '),
    lat,
    lon,
    bounds: e ? [e[3], e[1], e[0], e[2]] : undefined,
  };
}

export interface NewCityOptions {
  /** Place to look up; optional when `center` is given. */
  query?: string;
  center?: { lat: number; lon: number };
  /** Width and depth in metres; by default the place's own size, capped to 2 km. */
  width?: number;
  depth?: number;
  slug?: string;
  name?: string;
  log?: (msg: string) => void;
}

/** Default and largest automatic size, in metres. */
const AUTO_SIZE = 2000;
const MIN_SIZE = 600;

/** Create cities/<slug>/city.json. Returns the profile. */
export async function createProfile(opts: NewCityOptions): Promise<CityProfile> {
  const log = opts.log ?? console.log;
  let place: Place | undefined;
  if (opts.query && !opts.center) {
    place = await geocode(opts.query, log);
    log(`Found: ${place.displayName} (${place.lat.toFixed(5)}, ${place.lon.toFixed(5)})`);
  }
  const lat = opts.center?.lat ?? place!.lat;
  const lon = opts.center?.lon ?? place!.lon;

  // A neighbourhood-sized result keeps its own size; a whole city gets the central 2 km.
  let width = opts.width, depth = opts.depth;
  if (width === undefined && place?.bounds) {
    const [s, n, w, e] = place.bounds;
    const h = (n - s) * 110574;
    const wd = (e - w) * 111320 * Math.cos((lat * Math.PI) / 180);
    if (h < AUTO_SIZE * 1.5 && wd < AUTO_SIZE * 1.5) {
      width = Math.max(MIN_SIZE, Math.min(AUTO_SIZE, Math.round(wd * 1.1)));
      depth = Math.max(MIN_SIZE, Math.min(AUTO_SIZE, Math.round(h * 1.1)));
    }
  }
  width ??= AUTO_SIZE;
  depth ??= opts.depth ?? width;

  const name = opts.name ?? place?.name ?? opts.query ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  const slug = opts.slug ?? slugify(name);
  const dir = cityDir(slug);
  const path = join(dir, 'city.json');
  if (existsSync(path)) throw new Error(`${path} already exists. Build it with: npm run city -- ${slug}  (or pass --slug to make another)`);

  const profile: CityProfile = {
    slug,
    name,
    query: opts.query,
    origin: { lat: +lat.toFixed(6), lon: +lon.toFixed(6) },
    extent: extentAround(Math.round(width), Math.round(depth)),
    autoLandmarks: 10,
  };
  mkdirSync(dir, { recursive: true });
  const { slug: _slug, ...stored } = profile;
  void _slug;
  writeFileSync(path, JSON.stringify(stored, null, 2) + '\n');
  log(`Wrote ${path}: ${Math.round(width)} × ${Math.round(depth)} m around ${profile.origin.lat}, ${profile.origin.lon}`);
  return profile;
}
