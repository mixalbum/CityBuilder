// Build one city's voxel world from its profile and cached downloads, and
// write it to public/cities/<slug>/ for the viewer. `npm run city` runs the
// downloads first; this stage works offline.
//
//   npm run build:world -- <slug>             # e.g. melbourne
//   npm run build:world -- <slug> --flat      # ignore terrain
//   npm run build:world -- <slug> --preview   # only the middle 600 m, for quick iteration
//   npm run build:world -- melbourne --synthetic   # offline stand-in grid (no downloads; for CI and demos)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CityIndexEntry, Landmark } from '../src/world/chunkFormat';
import { cacheDir, extentAround, loadLandmarkModels, loadProfile, outDir, type CityProfile } from './city/profile';
import { DEM_ATTRIBUTION, GROUND_Y, MAX_WORLD_HEIGHT, OSM_ATTRIBUTION, type Extent } from './config';
import { loadDem } from './fetch/dem';
import type { BBox } from './fetch/overpass';
import { generateSyntheticOsm } from './fixtures/synthetic';
import { generateBuildings } from './gen/buildings';
import { demTerrain, Terrain } from './gen/elevation';
import { buildLandmarks, planLandmarks, type LandmarkModel } from './gen/landmarks';
import { pickAutoLandmarks } from './gen/landmarks/auto';
import { findLandmarks } from './gen/landmarks/find';
import { generateGround } from './gen/terrain';
import { tramLines } from './gen/tramLines';
import { generateTrees } from './gen/vegetation';
import { estimateGridAngle, Projector, WorldFrame } from './geo/project';
import { writeWorld } from './io/chunks';
import { extractFeatures, osmLines, RoadClassifier } from './model/features';
import { setDefaultHeight } from './model/heights';
import type { OsmData } from './model/osm';
import { getSource, type LoadedSource } from './sources';
import { isMain } from './util/isMain';
import { VoxelWorld } from './voxel/world';

export interface BuildOptions {
  profile: CityProfile;
  /** OSM data, or a path to it. Defaults to the city's cached download. 'synthetic' uses the offline stand-in grid. */
  osm?: OsmData | string;
  /** Override the profile's extent (e.g. a preview). */
  extent?: Extent;
  /** Skip terrain and build on flat ground. */
  flat?: boolean;
  /** Hand-made landmark models; defaults to none (the CLI loads the city's). */
  models?: LandmarkModel[];
  out?: string;
  log?: (msg: string) => void;
}

export const osmPath = (slug: string) => join(cacheDir(slug), 'osm.json');

/**
 * Lat/lon box to download for a profile. The grid angle is unknown until the
 * streets arrive, so unless the profile fixes it, cover the extent at any rotation.
 */
export function profileBBox(profile: CityProfile, extent = profile.extent, angleDeg?: number): BBox {
  const angle = angleDeg ?? profile.gridAngleDeg;
  if (angle !== undefined) return new Projector(profile.origin, angle).bbox(extent);
  const r = Math.max(Math.hypot(extent.minX, extent.minN), Math.hypot(extent.maxX, extent.maxN), Math.hypot(extent.minX, extent.maxN), Math.hypot(extent.maxX, extent.minN));
  return new Projector(profile.origin, 0).bbox({ minX: -r, maxX: r, minN: -r, maxN: r });
}

export function buildWorld(opts: BuildOptions) {
  const { profile } = opts;
  const log = opts.log ?? console.log;
  const extent = opts.extent ?? profile.extent;
  setDefaultHeight(profile.defaultHeight);

  let osm: OsmData;
  const synthetic = opts.osm === 'synthetic';
  if (synthetic) {
    osm = generateSyntheticOsm();
    log(`Using the SYNTHETIC stand-in grid (${osm.elements.length} elements): not real map data.`);
  } else if (typeof opts.osm === 'object') {
    osm = opts.osm;
  } else {
    const path = opts.osm ?? osmPath(profile.slug);
    if (!existsSync(path)) throw new Error(`No map data at ${path}. Download it with: npm run city -- ${profile.slug}`);
    osm = JSON.parse(readFileSync(path, 'utf8')) as OsmData;
    log(`Loaded ${osm.elements.length} OSM elements from ${path}`);
  }

  const estimated = estimateGridAngle(osmLines(osm), new Projector(profile.origin, 0), profile.gridStreets);
  const angle = profile.gridAngleDeg ?? estimated ?? 0;
  log(`Grid angle: ${angle.toFixed(2)}° (${profile.gridAngleDeg !== undefined ? 'from city.json' : estimated !== undefined ? 'estimated from streets' : 'default'})`);
  const frame = new WorldFrame(new Projector(profile.origin, angle), extent);

  const t0 = performance.now();
  const features = extractFeatures(osm, frame, new RoadClassifier(profile.streetWidths));
  log(
    `Features: ${features.buildings.length} buildings, ${features.roads.length} roads, ${features.rails.length} rails, ` +
      `${features.areas.length} areas, ${features.trees.length} trees`,
  );

  // Optional data sources (surveyed footprints, terrain).
  const cdir = cacheDir(profile.slug);
  const sources: { id: string; attribution: string; data: LoadedSource }[] = [];
  if (!synthetic)
    for (const id of profile.sources ?? []) {
      const s = getSource(id);
      const data = s.load({ profile, cacheDir: cdir, frame, log });
      if (data) sources.push({ id, attribution: s.attribution, data });
      else log(`Source ${id}: nothing downloaded yet, skipped (run npm run city -- ${profile.slug})`);
    }

  // Terrain: a source's survey, else the global elevation model, else flat.
  let terrain = Terrain.flat(frame.sizeX, frame.sizeZ);
  let usedDem = false;
  const mode = opts.flat ? 'flat' : (profile.terrain ?? 'auto');
  const surveyed = sources.find((s) => s.data.terrain);
  if (mode === 'auto' && surveyed) {
    const built = surveyed.data.terrain!(features.areas);
    terrain = built.terrain;
    log(`Terrain: ${built.samples} surveyed ground points from ${surveyed.id}, 0–${terrain.maxLift()} m`);
  } else if (mode !== 'flat' && !synthetic) {
    const dem = loadDem(profileBBox(profile, extent, angle));
    if (dem) {
      terrain = demTerrain(dem, (x, z) => frame.projector.toLatLon(x + extent.minX, extent.maxN - z), frame.sizeX, frame.sizeZ, features.areas);
      usedDem = true;
      log(`Terrain: elevation model, 0–${terrain.maxLift()} m above the lowest water${terrain.sea ? ' (sea from bathymetry)' : ''}`);
    } else log('Terrain: no elevation tiles downloaded, building flat (run npm run city to fetch them)');
  }

  const world = new VoxelWorld(frame.sizeX, MAX_WORLD_HEIGHT, frame.sizeZ);
  generateGround(world, features, terrain);

  let buildings = features.buildings;
  const replacing = sources.find((s) => s.data.buildings);
  if (replacing) {
    const r = replacing.data.buildings!(features.buildings, world, terrain);
    buildings = r.buildings;
    log(`Buildings from ${replacing.id}: ${r.summary}`);
  }
  const t1 = performance.now();
  const models = opts.models ?? [];
  const plan = planLandmarks(buildings, frame, world, terrain, models);
  const stats = generateBuildings(world, plan.buildings, terrain, plan.overrides);
  const t2 = performance.now();
  const planted = generateTrees(world, features.trees, terrain);
  if (models.length) {
    log('Landmarks:');
    buildLandmarks(world, frame, plan.sites, terrain, log);
  }
  const t3 = performance.now();

  // Jump list: the profile's landmarks plus automatically picked notable buildings.
  // Hidden OSM outlines still carry names, so search them as well.
  const named = [...buildings, ...features.buildings];
  const defs = [...(profile.landmarks ?? []), ...pickAutoLandmarks(named, profile.autoLandmarks ?? 10, profile.landmarks)];
  const landmarks: Landmark[] = findLandmarks(world, frame, named, defs, terrain);
  log(`Ground ${(t1 - t0).toFixed(0)} ms, buildings ${(t2 - t1).toFixed(0)} ms, trees and landmarks ${(t3 - t2).toFixed(0)} ms`);
  log(`Buildings rendered: ${stats.rendered} (styles ${JSON.stringify(stats.styles)}, heights from ${JSON.stringify(stats.heightSources)})`);
  log(`Trees planted: ${planted}; landmarks: ${landmarks.map((l) => l.name).join(', ') || 'none'}`);

  const trams = tramLines(features.rails, world, terrain);
  if (trams.length) log(`Tram lines: ${trams.length} routes, ${((trams.reduce((n, l) => n + l.length / 3, 0) * 3) / 1000).toFixed(1)} km`);

  const out = opts.out ?? outDir(profile.slug);
  const origin = frame.gridToVoxel(0, 0);
  const manifest = writeWorld(world, out, {
    city: { slug: profile.slug, name: profile.name, lat: profile.origin.lat, lon: profile.origin.lon },
    trams: 'trams.json',
    groundY: GROUND_Y,
    originVoxel: origin,
    originGround: terrain.ground(...origin),
    gridAngleDeg: angle,
    source: synthetic ? 'synthetic' : 'osm',
    generatedAt: new Date().toISOString(),
    attribution: synthetic
      ? 'Synthetic stand-in data (not real map data)'
      : [OSM_ATTRIBUTION, ...sources.map((s) => s.attribution), ...(usedDem ? [DEM_ATTRIBUTION] : [])].join(' · '),
    landmarks,
  });
  writeFileSync(join(out, 'trams.json'), JSON.stringify({ lines: trams }));
  const totalBytes = manifest.regions.reduce((n, r) => n + r.bytes, 0);
  const totalChunks = manifest.regions.reduce((n, r) => n + r.chunks, 0);
  log(`Wrote ${manifest.regions.length} regions, ${totalChunks} chunks, ${(totalBytes / 1e6).toFixed(1)} MB to ${out}`);
  return { manifest, world };
}

/** Record a built city in public/cities/index.json, which the viewer's city picker reads. */
export function updateCityIndex(profile: CityProfile, root = join('public', 'cities')): void {
  const path = join(root, 'index.json');
  let index: CityIndexEntry[] = [];
  if (existsSync(path)) index = JSON.parse(readFileSync(path, 'utf8')) as CityIndexEntry[];
  index = index.filter((c) => c.slug !== profile.slug && existsSync(join(root, c.slug, 'manifest.json')));
  index.push({ slug: profile.slug, name: profile.name, builtAt: new Date().toISOString() });
  index.sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(root, { recursive: true });
  writeFileSync(path, JSON.stringify(index, null, 1));
}

/** Build a city from its cached downloads (the CLI behind build:world and city). */
export async function buildCity(
  slug: string,
  flags: { flat?: boolean; preview?: boolean; synthetic?: boolean; log?: (msg: string) => void } = {},
) {
  const profile = loadProfile(slug);
  const models = await loadLandmarkModels(slug);
  const result = buildWorld({
    profile,
    models,
    osm: flags.synthetic ? 'synthetic' : undefined,
    flat: flags.flat,
    extent: flags.preview ? extentAround(600) : undefined,
    log: flags.log,
  });
  updateCityIndex(profile);
  return result;
}

if (isMain(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      flat: { type: 'boolean', default: false },
      preview: { type: 'boolean', default: false },
      synthetic: { type: 'boolean', default: false },
    },
  });
  const slug = positionals[0];
  if (!slug) {
    console.error('Usage: npm run build:world -- <city> [--flat] [--preview] [--synthetic]');
    process.exit(1);
  }
  buildCity(slug, values).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
