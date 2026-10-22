// Normalise raw OSM elements into the typed features the generators use.
// All coordinates are in voxel space (x, z) as floats.

import type { StreetWidthRule } from '../city/profile';
import type { WorldFrame } from '../geo/project';
import { parseLength } from './heights';
import type { OsmData, OsmPoint, Tags } from './osm';

export type Pt = [number, number];
export type Ring = Pt[];

export interface Building {
  id: string;
  /** Outer and inner rings, filled with the even-odd rule. */
  rings: Ring[];
  tags: Tags;
  isPart: boolean;
  /** Outline replaced by its building:part children: kept for names, not rendered. */
  hidden?: boolean;
  /** Set on City of Melbourne tiers: tiers of one structure share a style. */
  structureId?: string;
}

/** main/little/other: asphalt with footpaths; lane: cobbled; service: narrow asphalt; footway: paving. */
export type RoadKind = 'main' | 'little' | 'other' | 'lane' | 'service' | 'footway';

export interface Road {
  id: string;
  line: Ring;
  kind: RoadKind;
  /** Full corridor width including footpaths, in metres. */
  width: number;
  /** Carriageway width; the rest of the corridor is footpath. */
  carriageway: number;
  name?: string;
  bridge: boolean;
}

export interface Rail {
  id: string;
  line: Ring;
  kind: 'tram' | 'rail';
}

export type AreaKind = 'water' | 'park' | 'grass' | 'plaza' | 'wood' | 'sand' | 'pier';

/** What kind of open area a closed OSM shape is, if any. */
export function areaKind(tags: Tags): AreaKind | undefined {
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'water';
  if (tags.man_made === 'pier') return 'pier';
  if (tags.landuse === 'forest' || tags.natural === 'wood' || tags.natural === 'scrub') return 'wood';
  if (tags.natural === 'beach' || tags.natural === 'sand') return 'sand';
  if (['park', 'garden', 'playground'].includes(tags.leisure ?? '')) return 'park';
  if (tags.leisure === 'pitch' || tags.natural === 'grassland') return 'grass';
  if (['grass', 'recreation_ground', 'village_green', 'cemetery', 'meadow'].includes(tags.landuse ?? '')) return 'grass';
  if ((tags.highway === 'pedestrian' && tags.area === 'yes') || tags.place === 'square') return 'plaza';
  return undefined;
}

export interface Area {
  id: string;
  rings: Ring[];
  kind: AreaKind;
}

export interface Tree {
  id: string;
  x: number;
  z: number;
  tags: Tags;
}

export interface Pier {
  id: string;
  line: Ring;
  width: number;
}

export interface Features {
  buildings: Building[];
  roads: Road[];
  rails: Rail[];
  areas: Area[];
  trees: Tree[];
  piers: Pier[];
}

const SKIP_HIGHWAYS = new Set(['steps', 'corridor', 'proposed', 'construction', 'elevator', 'platform', 'bus_stop', 'raceway', 'abandoned']);
const FOOTWAY_HIGHWAYS = new Set(['footway', 'pedestrian', 'path', 'cycleway', 'bridleway', 'track']);

/** Carriageway widths by OSM highway class, in metres, when lanes and width are untagged. */
const CLASS_CARRIAGEWAY: Record<string, number> = {
  motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 6,
  residential: 7, unclassified: 7, living_street: 5, road: 7, busway: 7,
};
/** Footpath width each side by class. */
const CLASS_FOOTPATH: Record<string, number> = { motorway: 1, trunk: 2, motorway_link: 1, trunk_link: 1 };

/** Underground stations, tunnels and car parks: skipped entirely. */
export function isUnderground(tags: Tags): boolean {
  // `level` may be a list or range ("-3;-2", "-2--1"); underground when every level is negative.
  const levels = (tags.level ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  return (
    tags.tunnel === 'yes' ||
    tags.tunnel === 'building_passage' ||
    tags.location === 'underground' ||
    parseInt(tags.layer ?? '0', 10) < 0 ||
    (levels.length > 0 && Math.max(...levels) < 0)
  );
}

interface CompiledRule {
  name?: RegExp;
  highway?: RegExp;
  rule: StreetWidthRule;
}

/** Sizes roads: a city's own rules first, then OSM width/lanes tags, then the highway class. */
export class RoadClassifier {
  private readonly rules: CompiledRule[];

  constructor(rules: StreetWidthRule[] = []) {
    this.rules = rules.map((rule) => ({
      rule,
      name: rule.match !== undefined ? new RegExp(rule.match) : undefined,
      highway: rule.highway !== undefined ? new RegExp(rule.highway) : undefined,
    }));
  }

  classify(tags: Tags): { kind: RoadKind; width: number; carriageway: number } | undefined {
    const hw = tags.highway;
    if (!hw || SKIP_HIGHWAYS.has(hw) || tags.area === 'yes') return undefined;
    const name = tags.name ?? '';
    const tagged = parseLength(tags.width);
    const footway = FOOTWAY_HIGHWAYS.has(hw);
    for (const { rule, name: re, highway } of this.rules) {
      if (re && !re.test(name)) continue;
      if (highway && !highway.test(hw)) continue;
      // Lane rules never turn footpaths into cobbled lanes.
      if (footway && (rule.kind ?? 'main') === 'lane') continue;
      const width = rule.width ?? tagged ?? 4;
      return { kind: rule.kind ?? 'main', width, carriageway: rule.carriageway ?? width };
    }
    if (footway) return { kind: 'footway', width: tagged ?? (hw === 'pedestrian' ? 6 : 3), carriageway: 0 };
    if (hw === 'service') {
      const w = tagged ?? (tags.service === 'parking_aisle' || tags.service === 'driveway' ? 3 : 4);
      return { kind: 'service', width: w, carriageway: w };
    }
    const lanes = parseInt(tags.lanes ?? '', 10);
    const carriageway = tagged ?? (lanes > 0 ? lanes * 3.3 : CLASS_CARRIAGEWAY[hw] ?? 6);
    const footpath = CLASS_FOOTPATH[hw] ?? (carriageway >= 12 ? 4 : 3);
    return { kind: carriageway >= 12 ? 'main' : 'other', width: carriageway + 2 * footpath, carriageway };
  }
}

const key = (p: OsmPoint): string => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** Join relation member ways end-to-end into closed rings. */
export function assembleRings(ways: OsmPoint[][]): OsmPoint[][] {
  const pool = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const rings: OsmPoint[][] = [];
  while (pool.length) {
    const ring = pool.shift()!;
    while (key(ring[0]) !== key(ring[ring.length - 1])) {
      const end = key(ring[ring.length - 1]);
      const i = pool.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end);
      if (i < 0) break; // unclosed: the fill treats it as closed anyway
      const next = pool.splice(i, 1)[0];
      if (key(next[0]) !== end) next.reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export function pointInRings(x: number, z: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

function ringsBBox(rings: Ring[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rings)
    for (const [x, z] of r) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  return [x0, z0, x1, z1];
}

/**
 * OSM convention: when a building outline has building:part children, the
 * parts describe its 3D shape and the outline should not be rendered.
 */
export function hideOutlinesWithParts(buildings: Building[]): Building[] {
  const parts = buildings.filter((b) => b.isPart);
  if (!parts.length) return buildings;
  const probes = parts.map((p) => {
    const ring = p.rings[0];
    let cx = 0, cz = 0;
    for (const [x, z] of ring) {
      cx += x;
      cz += z;
    }
    return [cx / ring.length, cz / ring.length] as Pt;
  });
  return buildings.map((b) => {
    if (b.isPart) return b;
    const [x0, z0, x1, z1] = ringsBBox(b.rings);
    const hasPart = probes.some(([x, z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && pointInRings(x, z, b.rings));
    return hasPart ? { ...b, hidden: true } : b;
  });
}

export function extractFeatures(osm: OsmData, frame: WorldFrame, roads = new RoadClassifier()): Features {
  const toRing = (pts: OsmPoint[]): Ring => pts.map((p) => frame.latLonToVoxel(p.lat, p.lon));
  const f: Features = { buildings: [], roads: [], rails: [], areas: [], trees: [], piers: [] };

  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    const id = `${el.type[0]}${el.id}`;

    if (el.type === 'node') {
      if (tags.natural === 'tree') {
        const [x, z] = frame.latLonToVoxel(el.lat, el.lon);
        f.trees.push({ id, x, z, tags });
      }
      continue;
    }

    let rings: Ring[];
    let line: Ring | undefined;
    if (el.type === 'way') {
      if (el.geometry.length < 2) continue;
      line = toRing(el.geometry);
      rings = [line];
    } else {
      const ways = el.members.filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry!);
      rings = assembleRings(ways).map(toRing);
      if (!rings.length) continue;
    }

    if (isUnderground(tags)) continue;

    const isBuilding = tags.building !== undefined && tags.building !== 'no';
    const isPart = tags['building:part'] !== undefined && tags['building:part'] !== 'no';
    if (isBuilding || isPart) {
      f.buildings.push({ id, rings, tags, isPart: isPart && !isBuilding });
      continue;
    }

    const closed = el.type === 'relation' || (line !== undefined && line.length > 3 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]);
    const area = closed ? areaKind(tags) : undefined;
    if (area) {
      f.areas.push({ id, rings, kind: area });
    } else if (line && tags.man_made === 'pier') {
      // A pier drawn as a line: a 4 m deck (or its tagged width).
      f.piers.push({ id, line, width: parseLength(tags.width) ?? 4 });
    } else if (line && tags.highway) {
      const c = roads.classify(tags);
      if (c) f.roads.push({ id, line, ...c, name: tags.name, bridge: tags.bridge === 'yes' });
    } else if (line && (tags.railway === 'tram' || tags.railway === 'light_rail' || tags.railway === 'rail')) {
      f.rails.push({ id, line, kind: tags.railway === 'rail' ? 'rail' : 'tram' });
    } else if (line && tags.natural === 'tree_row') {
      // Expand tree rows into individual trees every 9 m.
      for (let i = 1; i < line.length; i++) {
        const [x0, z0] = line[i - 1];
        const [x1, z1] = line[i];
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 9));
        for (let k = 0; k < n; k++)
          f.trees.push({ id: `${id}-${i}-${k}`, x: x0 + ((x1 - x0) * k) / n, z: z0 + ((z1 - z0) * k) / n, tags });
      }
    }
  }

  f.buildings = hideOutlinesWithParts(f.buildings);
  f.trees.push(...woodlandTrees(f.areas));
  return f;
}

/** Highway lines with their names and classes, for estimating the grid angle. */
/** Scatter trees through woods and forests, about one every 9 m, jittered deterministically. */
export function woodlandTrees(areas: Area[]): Tree[] {
  const out: Tree[] = [];
  const SP = 9;
  for (const a of areas) {
    if (a.kind !== 'wood') continue;
    const [x0, z0, x1, z1] = ringsBBox(a.rings);
    for (let z = Math.floor(z0 / SP) * SP; z <= z1; z += SP)
      for (let x = Math.floor(x0 / SP) * SP; x <= x1; x += SP) {
        const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
        const jx = x + (h % 7) - 3, jz = z + ((h >> 8) % 7) - 3;
        if (pointInRings(jx, jz, a.rings)) out.push({ id: `${a.id}-${x}-${z}`, x: jx, z: jz, tags: { natural: 'tree' } });
      }
  }
  return out;
}

export function osmLines(osm: OsmData): { name: string; highway: string; points: OsmPoint[] }[] {
  const out: { name: string; highway: string; points: OsmPoint[] }[] = [];
  for (const el of osm.elements)
    if (el.type === 'way' && el.tags?.highway && !isUnderground(el.tags))
      out.push({ name: el.tags.name ?? '', highway: el.tags.highway, points: el.geometry });
  return out;
}
