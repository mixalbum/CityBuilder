// One command from a place name to an explorable city:
//
//   npm run city -- "Wellington, New Zealand"      # look it up, download, build
//   npm run city -- wellington                      # rebuild a city you already have
//   npm run city -- "Prague Old Town" --size 1500   # choose the area (metres)
//   npm run city -- --center 40.7484,-73.9857 --name "Midtown Manhattan"
//
// Options:
//   --size <m> | --width <m> --depth <m>   area to build (new cities only; default: the place's size, max 2 km)
//   --center <lat,lon>                      centre on a point instead of looking a name up
//   --name <text> --slug <id>               display name and folder name
//   --preview                               build only the middle 600 m (fast)
//   --flat                                  ignore terrain
//   --force                                 download the map data again
//   --no-build                              download only
//
// Downloads (OpenStreetMap, elevation tiles, any extra data sources) run in
// parallel and are cached in data/cache/, so rebuilding never re-downloads.

import { parseArgs } from 'node:util';
import { buildCity, osmPath, profileBBox } from '../build';
import { createProfile } from '../city/geocode';
import { cacheDir, cityDir, listProfiles, loadProfile, slugify, type CityProfile } from '../city/profile';
import { fetchDem } from '../fetch/dem';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchOsm, OVERPASS_ENDPOINTS, quickQuery, streetQuery } from '../fetch/overpass';
import { estimateGridAngle, Projector } from '../geo/project';
import { osmLines } from '../model/features';
import { getSource } from '../sources';
import { isMain } from '../util/isMain';

/**
 * Fix a new city's street-grid angle before the big download: one light query
 * for its main streets, then the angle is saved to city.json. The map data can
 * then be downloaded for the tight, rotated extent instead of a box covering
 * every rotation, about half the area.
 */
async function settleGridAngle(profile: CityProfile, endpoints: string[], log: (m: string) => void): Promise<CityProfile> {
  if (profile.gridAngleDeg !== undefined) return profile;
  const inner = new Projector(profile.origin, 0).bbox(profile.extent);
  let angle = 0;
  try {
    const streets = await quickQuery(streetQuery(inner), endpoints, log);
    angle = estimateGridAngle(osmLines(streets), new Projector(profile.origin, 0), profile.gridStreets) ?? 0;
  } catch (err) {
    log(`Could not fetch streets to estimate the grid angle (${String(err).slice(0, 100)}); using 0°`);
  }
  angle = Math.round(angle * 100) / 100;
  const path = join(cityDir(profile.slug), 'city.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  raw.gridAngleDeg = angle;
  writeFileSync(path, JSON.stringify(raw, null, 2) + '\n');
  log(`Street grid: ${angle}° (saved to ${path})`);
  return { ...profile, gridAngleDeg: angle };
}

export async function downloadCity(profile: CityProfile, opts: { force?: boolean; endpoints?: string[]; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  profile = await settleGridAngle(profile, opts.endpoints ?? OVERPASS_ENDPOINTS, log);
  const bbox = profileBBox(profile);
  const cdir = cacheDir(profile.slug);
  const t0 = performance.now();
  await Promise.all([
    fetchOsm(bbox, osmPath(profile.slug), { force: opts.force, endpoints: opts.endpoints, log }),
    profile.terrain === 'flat' ? Promise.resolve(0) : fetchDem(bbox, log),
    ...(profile.sources ?? []).map((id) => getSource(id).fetch({ profile, bbox, cacheDir: cdir, force: !!opts.force, log })),
  ]);
  log(`Downloads ready in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      size: { type: 'string' },
      width: { type: 'string' },
      depth: { type: 'string' },
      center: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      endpoint: { type: 'string', multiple: true },
      preview: { type: 'boolean', default: false },
      flat: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-build': { type: 'boolean', default: false },
    },
  });
  const query = positionals.join(' ').trim();
  if (!query && !values.center) {
    const known = listProfiles();
    console.log('Usage: npm run city -- "<place name>" [--size 2000] [--preview]');
    console.log('       npm run city -- <city>   (rebuild)');
    if (known.length) console.log(`Cities so far: ${known.join(', ')}`);
    process.exit(1);
  }

  // An existing profile by slug (or by the slug the name would get), else a new one.
  const existing = listProfiles();
  const asSlug = values.slug ?? (existing.includes(query) ? query : existing.includes(slugify(query)) && !values.center ? slugify(query) : undefined);
  let profile: CityProfile;
  if (asSlug && existing.includes(asSlug)) {
    profile = loadProfile(asSlug);
    console.log(`City: ${profile.name} (cities/${profile.slug}/city.json)`);
  } else {
    const num = (v?: string) => (v === undefined ? undefined : Number(v));
    let center: { lat: number; lon: number } | undefined;
    if (values.center) {
      const [lat, lon] = values.center.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('--center must be "lat,lon", e.g. --center 51.5007,-0.1246');
      center = { lat, lon };
    }
    const size = num(values.size);
    profile = await createProfile({
      query: query || undefined,
      center,
      width: num(values.width) ?? size,
      depth: num(values.depth) ?? size,
      slug: values.slug,
      name: values.name,
    });
    profile = loadProfile(profile.slug);
  }

  await downloadCity(profile, { force: values.force, endpoints: values.endpoint ?? OVERPASS_ENDPOINTS });
  if (values['no-build']) return;
  const t0 = performance.now();
  await buildCity(profile.slug, { flat: values.flat, preview: values.preview });
  console.log(`\nBuilt ${profile.name} in ${((performance.now() - t0) / 1000).toFixed(0)} s.`);
  console.log(`View it: npm run dev, then open http://localhost:5173/?city=${profile.slug}`);
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
