// Global terrain from the AWS / Mapzen "Terrain Tiles" (Terrarium encoding):
// free, keyless 256 px elevation tiles covering the whole planet. At zoom 14
// a pixel is ~9.5 m at the equator (~7 m at 40° latitude), plenty for a city's
// hills once smoothed. Tiles are cached in data/cache/dem/ and shared by
// every city.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, type Image } from '../util/png';
import { fetchBytesWithRetry } from './http';
import type { BBox } from './overpass';

export const DEM_ZOOM = 14;
const TILE_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const CACHE = join('data', 'cache', 'dem');
const PARALLEL = 8;

const tilePath = (z: number, x: number, y: number) => join(CACHE, String(z), String(x), `${y}.png`);

/** Fractional Web Mercator tile coordinates of a point. */
export function lonLatToTile(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

function tilesFor(bbox: BBox, z: number): [number, number][] {
  const [s, w, n, e] = bbox;
  const [x0, y0] = lonLatToTile(n, w, z).map(Math.floor);
  const [x1, y1] = lonLatToTile(s, e, z).map(Math.floor);
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

/** Download the elevation tiles covering `bbox` (cached). Returns how many were fetched. */
export async function fetchDem(bbox: BBox, log: (msg: string) => void = console.log, z = DEM_ZOOM): Promise<number> {
  const missing = tilesFor(bbox, z).filter(([x, y]) => !existsSync(tilePath(z, x, y)));
  if (!missing.length) {
    log('Terrain: elevation tiles cached');
    return 0;
  }
  log(`Terrain: downloading ${missing.length} elevation tiles ...`);
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const [x, y] = missing[next++];
      const bytes = await fetchBytesWithRetry(TILE_URL(z, x, y), {}, 5, (m) => log(`  dem ${x}/${y}: ${m}`));
      mkdirSync(dirname(tilePath(z, x, y)), { recursive: true });
      writeFileSync(tilePath(z, x, y), bytes);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return missing.length;
}

/** Terrarium encoding: metres = R * 256 + G + B / 256 - 32768. */
export function terrariumHeight(img: Image, px: number, py: number): number {
  const i = (py * img.width + px) * img.channels;
  return img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256 - 32768;
}

/**
 * Elevation sampler over cached tiles: metres above sea level at a lat/lon,
 * bilinearly interpolated. Returns undefined if the tiles are not cached.
 */
export function loadDem(bbox: BBox, z = DEM_ZOOM): ((lat: number, lon: number) => number) | undefined {
  const tiles = new Map<string, Image>();
  for (const [x, y] of tilesFor(bbox, z)) {
    const p = tilePath(z, x, y);
    if (!existsSync(p)) return undefined;
    tiles.set(`${x},${y}`, decodePng(readFileSync(p)));
  }
  const px = (gx: number, gy: number): number => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const img = tiles.get(`${tx},${ty}`);
    if (!img) return NaN;
    return terrariumHeight(img, gx - tx * 256, gy - ty * 256);
  };
  return (lat, lon) => {
    const [fx, fy] = lonLatToTile(lat, lon, z);
    const gx = fx * 256 - 0.5, gy = fy * 256 - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0;
    const v00 = px(x0, y0), v10 = px(x0 + 1, y0), v01 = px(x0, y0 + 1), v11 = px(x0 + 1, y0 + 1);
    // At the edge of the cached area fall back to the nearest valid pixel.
    const vals = [v00, v10, v01, v11];
    if (vals.some(Number.isNaN)) return vals.find((v) => !Number.isNaN(v)) ?? 0;
    return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
  };
}
