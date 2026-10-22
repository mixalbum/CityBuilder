// City of Melbourne "2023 Building Footprints" (CC BY): every structure in the
// municipality split into height tiers with surveyed elevations. Gives real
// podium/tower massing and, from each structure's base, the ground's slope.
// A model for adapters to other cities' open building data.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchWithRetry } from '../fetch/http';
import { buildTerrain } from '../gen/elevation';
import { footprintsToBuildings, notOnRoads, osmOutsideCoverage, type FootprintCollection } from '../model/footprints';
import type { DataSource } from './types';

const DATASET = 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/2023-building-footprints';
const FILE = 'com-footprints.geojson';

export const melbourneFootprints: DataSource = {
  id: 'melbourne-footprints',
  attribution: 'Building footprints © City of Melbourne (CC BY)',
  description: 'City of Melbourne 2023 Building Footprints: surveyed tiers and ground elevations',

  async fetch({ bbox, cacheDir, force, log }) {
    const path = join(cacheDir, FILE);
    if (existsSync(path) && !force) {
      log(`Footprints: using cached ${path}`);
      return;
    }
    const [s, w, n, e] = bbox;
    const where = `in_bbox(geo_point_2d,${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)})`;
    log('Footprints: downloading City of Melbourne building footprints ...');
    const text = await fetchWithRetry(`${DATASET}/exports/geojson?where=${encodeURIComponent(where)}`, {}, 8, (m) => log(`  footprints: ${m}`));
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path, text);
    log(`Footprints: ${(JSON.parse(text) as FootprintCollection).features.length} footprints → ${path}`);
  },

  load({ cacheDir, frame }) {
    const path = join(cacheDir, FILE);
    if (!existsSync(path)) return undefined;
    const fc = JSON.parse(readFileSync(path, 'utf8')) as FootprintCollection;
    return {
      terrain: (areas) => buildTerrain(fc, frame, areas),
      buildings: (osm, world, terrain) => {
        const tiers = footprintsToBuildings(fc, frame, osm);
        const outside = osmOutsideCoverage(osm.filter((b) => !b.hidden), tiers, frame.sizeX, frame.sizeZ);
        const kept = notOnRoads(outside, world, terrain);
        return {
          buildings: [...tiers, ...kept],
          summary:
            `${tiers.length} City of Melbourne tiers, plus ${kept.length} OSM buildings outside their coverage ` +
            `(${outside.length - kept.length} dropped as standing on roads)`,
        };
      },
    };
  },
};
