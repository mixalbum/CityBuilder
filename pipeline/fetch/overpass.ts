// Download a city's OpenStreetMap data from the Overpass API.
//
// Speed and reliability: the area is split into tiles that are spread over
// several Overpass servers at once, one query per server at a time (the
// servers limit concurrent queries per user). A server that fails rests for a
// growing cool-down while its tile goes to another. Results are merged and
// de-duplicated by element id.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OsmData, OsmElement } from '../model/osm';
import { USER_AGENT } from './http';

export type BBox = [south: number, west: number, north: number, east: number];

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Tiles are at most this many degrees of latitude/longitude across (~1 km). */
const TILE_DEG = 0.01;

export function buildQuery(bbox: BBox): string {
  const b = bbox.map((v) => v.toFixed(6)).join(',');
  // A short declared timeout and the default memory allowance get a query
  // scheduled sooner; big areas are split into tiles instead.
  return `[out:json][timeout:120];
(
  way["building"](${b});
  relation["building"](${b});
  way["building:part"](${b});
  relation["building:part"](${b});
  way["highway"](${b});
  way["railway"~"^(rail|tram|light_rail)$"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["waterway"="riverbank"](${b});
  relation["waterway"="riverbank"](${b});
  way["leisure"~"^(park|garden|pitch|playground)$"](${b});
  relation["leisure"~"^(park|garden)$"](${b});
  way["landuse"~"^(grass|recreation_ground|village_green|cemetery|forest|meadow)$"](${b});
  relation["landuse"~"^(grass|recreation_ground|forest)$"](${b});
  way["natural"~"^(wood|scrub|grassland|beach|sand)$"](${b});
  way["place"="square"](${b});
  node["natural"="tree"](${b});
  way["natural"="tree_row"](${b});
  way["man_made"~"^(bridge|pier)$"](${b});
);
out geom;`;
}

/** Just the streets that define a grid, for estimating its angle cheaply. */
export function streetQuery(bbox: BBox): string {
  const b = bbox.map((v) => v.toFixed(6)).join(',');
  return `[out:json][timeout:60];way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street)$"](${b});out geom;`;
}

/** Split a bbox into tiles no larger than `size` degrees on a side. */
export function tileBBox(bbox: BBox, size = TILE_DEG): BBox[] {
  const [s, w, n, e] = bbox;
  const rows = Math.max(1, Math.ceil((n - s) / size));
  const cols = Math.max(1, Math.ceil((e - w) / size));
  const out: BBox[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push([s + ((n - s) * r) / rows, w + ((e - w) * c) / cols, s + ((n - s) * (r + 1)) / rows, w + ((e - w) * (c + 1)) / cols]);
  return out;
}

/** Merge tile results, keeping one copy of elements that cross tile edges. */
export function mergeOsm(parts: OsmData[]): OsmData {
  const seen = new Set<string>();
  const elements: OsmElement[] = [];
  for (const p of parts)
    for (const el of p.elements) {
      const k = `${el.type}${el.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      elements.push(el);
    }
  return { elements };
}

interface Server {
  url: string;
  host: string;
  busy: boolean;
  /** Not used again before this time (ms), after a failure. */
  coolUntil: number;
  failures: number;
}

/** One request to one server. Overpass sometimes answers 200 with an error remark. */
async function query(server: Server, q: string): Promise<OsmData> {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: 'data=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
  const data = JSON.parse(text) as OsmData & { remark?: string };
  if (data.remark && /error|timed out|out of memory/i.test(data.remark)) throw new Error(data.remark.slice(0, 160));
  return data;
}

/** One small query, tried on each server in turn until one answers. */
export async function quickQuery(q: string, urls: string[] = OVERPASS_ENDPOINTS, log: (msg: string) => void = console.log): Promise<OsmData> {
  let lastErr: unknown;
  for (let round = 0; round < 3; round++)
    for (const url of urls) {
      const server: Server = { url, host: new URL(url).host, busy: false, coolUntil: 0, failures: 0 };
      try {
        return await query(server, q);
      } catch (err) {
        lastErr = err;
        log(`  ${server.host}: ${String(err).slice(0, 120)}`);
      }
    }
  throw lastErr;
}

/**
 * Fetch every tile, spreading them over the servers: each server runs one
 * query at a time (Overpass limits concurrent queries per user), a server that
 * fails rests for a growing cool-down, and a failed tile goes back in the queue
 * for another server. Gives up on a tile after `maxAttempts` failures.
 */
async function fetchTiles(
  tiles: BBox[],
  urls: string[],
  log: (msg: string) => void,
  tileDir: string,
  maxAttempts = 10,
): Promise<OsmData[]> {
  const servers: Server[] = urls.map((url) => ({ url, host: new URL(url).host, busy: false, coolUntil: 0, failures: 0 }));
  const results: OsmData[] = new Array(tiles.length);
  // Tiles finished by an earlier, interrupted run are reused.
  const tilePath = (t: BBox) => join(tileDir, `${t.map((v) => v.toFixed(5)).join('_')}.json`);
  mkdirSync(tileDir, { recursive: true });
  const queue: number[] = [];
  tiles.forEach((t, i) => {
    if (existsSync(tilePath(t))) results[i] = JSON.parse(readFileSync(tilePath(t), 'utf8')) as OsmData;
    else queue.push(i);
  });
  if (queue.length < tiles.length) log(`  resuming: ${tiles.length - queue.length} of ${tiles.length} tiles already downloaded`);
  const attempts = new Array(tiles.length).fill(0);
  let done = tiles.length - queue.length;
  let fatal: Error | undefined;
  const running = new Set<Promise<void>>();

  while ((queue.length || running.size) && !fatal) {
    const now = Date.now();
    const free = servers.filter((s) => !s.busy && s.coolUntil <= now);
    while (queue.length && free.length) {
      const server = free.shift()!;
      const i = queue.shift()!;
      server.busy = true;
      const job = query(server, buildQuery(tiles[i]))
        .then((data) => {
          results[i] = data;
          writeFileSync(tilePath(tiles[i]), JSON.stringify(data));
          server.failures = 0;
          log(`  tile ${++done}/${tiles.length}: ${data.elements.length} elements (${server.host})`);
        })
        .catch((err) => {
          server.failures++;
          const wait = Math.min(120, 5 * 2 ** (server.failures - 1));
          server.coolUntil = Date.now() + wait * 1000;
          log(`  ${server.host}: ${String(err).slice(0, 140)} (resting ${wait}s)`);
          if (++attempts[i] >= maxAttempts) fatal = new Error(`Tile ${i + 1} failed ${maxAttempts} times; the Overpass servers may be overloaded. Try again later, or pass --endpoint <url>.`);
          else queue.push(i);
        })
        .finally(() => {
          server.busy = false;
          running.delete(job);
        });
      running.add(job);
    }
    // Wait for a job to finish or a server to come off its cool-down.
    const nextCool = Math.min(...servers.filter((s) => !s.busy).map((s) => s.coolUntil), Infinity);
    const sleep = new Promise<void>((r) => setTimeout(r, Number.isFinite(nextCool) ? Math.max(200, nextCool - Date.now()) : 1000));
    await Promise.race([...running, sleep]);
  }
  await Promise.allSettled([...running]);
  if (fatal) throw fatal;
  return results;
}

export interface FetchOsmOptions {
  endpoints?: string[];
  force?: boolean;
  log?: (msg: string) => void;
}

/**
 * Download OSM data for `bbox` to `path` (with a .meta.json beside it so a
 * changed extent triggers a fresh download). Returns the element count.
 */
export async function fetchOsm(bbox: BBox, path: string, opts: FetchOsmOptions = {}): Promise<number> {
  const log = opts.log ?? console.log;
  const metaPath = path.replace(/\.json$/, '.meta.json');
  const key = bbox.map((v) => v.toFixed(5)).join(',');
  if (!opts.force && existsSync(path) && existsSync(metaPath)) {
    // Any earlier download covering this box will do.
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { bbox: string; elements: number };
    const [s, w, n, e] = meta.bbox.split(',').map(Number);
    const eps = 1e-5;
    if (s <= bbox[0] + eps && w <= bbox[1] + eps && n >= bbox[2] - eps && e >= bbox[3] - eps) {
      log(`OSM: using cached ${path} (${meta.elements} elements)`);
      return meta.elements;
    }
  }
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const tiles = tileBBox(bbox);
  log(`OSM: downloading ${tiles.length} tile${tiles.length > 1 ? 's' : ''} via ${endpoints.map((e) => new URL(e).host).join(', ')} ...`);
  const t0 = performance.now();
  const tileDir = join(dirname(path), 'tiles');
  if (opts.force) rmSync(tileDir, { recursive: true, force: true });
  const parts = await fetchTiles(tiles, endpoints, log, tileDir);
  const merged = mergeOsm(parts);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged));
  writeFileSync(metaPath, JSON.stringify({ bbox: key, elements: merged.elements.length, fetchedAt: new Date().toISOString() }));
  rmSync(tileDir, { recursive: true, force: true });
  log(`OSM: ${merged.elements.length} elements in ${((performance.now() - t0) / 1000).toFixed(0)} s → ${path}`);
  return merged.elements.length;
}
