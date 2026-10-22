// City of Melbourne 2023 Building Footprints → Building features.
//
// Each structure is split into stacked tiers: a tier's polygon occupies the
// elevation range [footprint_min_elevation, footprint_max_elevation] (AHD
// metres), usually resting on the tier below. Extruding each tier over its own
// range reproduces podiums, towers, setbacks and overhangs.

import { M } from '../../src/world/palette';
import type { WorldFrame } from '../geo/project';
import type { VoxelWorld } from '../voxel/world';
import type { Terrain } from '../gen/elevation';
import { drawThickLine, fillPolygon } from '../voxel/rasterize';
import { pointInRings, type Building, type Ring } from './features';
import type { Tags } from './osm';

export interface FootprintProps {
  structure_id: string;
  footprint_type: string;
  roof_type: string | null;
  footprint_min_elevation: number | null;
  footprint_max_elevation: number | null;
  structure_min_elevation: number | null;
  structure_max_elevation: number | null;
}

interface Geometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface FootprintCollection {
  features: { geometry: Geometry | null; properties: FootprintProps }[];
}

/** Footprint types that are not buildings, or are drawn from OSM instead. */
const SKIP_TYPES = new Set(['Bridge', 'Ramp', 'Tunnel']);

const ROOF_SHAPES: Record<string, string> = { Hip: 'hipped', Gable: 'gabled', Pyramid: 'pyramidal', Shed: 'skillion' };

/** OSM tags worth inheriting from the building a footprint sits in. */
const INHERITED = ['name', 'building', 'start_date', 'building:material', 'heritage', 'amenity', 'roof:material'];

/** Bucketed bounding-box index for point-in-building lookups. */
class BuildingIndex {
  private readonly cells = new Map<string, { b: Building; bbox: number[] }[]>();
  private static readonly SIZE = 64;

  constructor(buildings: Building[]) {
    for (const b of buildings) {
      if (b.isPart) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const r of b.rings)
        for (const [x, z] of r) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        }
      const entry = { b, bbox: [x0, z0, x1, z1] };
      const S = BuildingIndex.SIZE;
      for (let cz = Math.floor(z0 / S); cz <= Math.floor(z1 / S); cz++)
        for (let cx = Math.floor(x0 / S); cx <= Math.floor(x1 / S); cx++) {
          const k = `${cx},${cz}`;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k)!.push(entry);
        }
    }
  }

  /** The smallest building containing the point (most specific match). */
  find(x: number, z: number): Building | undefined {
    const S = BuildingIndex.SIZE;
    let best: Building | undefined;
    let bestArea = Infinity;
    for (const { b, bbox } of this.cells.get(`${Math.floor(x / S)},${Math.floor(z / S)}`) ?? []) {
      const [x0, z0, x1, z1] = bbox;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const area = (x1 - x0) * (z1 - z0);
      if (area < bestArea && pointInRings(x, z, b.rings)) {
        best = b;
        bestArea = area;
      }
    }
    return best;
  }
}

function ringCentroid(ring: Ring): [number, number] {
  let x = 0, z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

/**
 * Convert footprints to Building features, inheriting names and dates from the
 * OSM building under each tier. Heights are metres above the structure base.
 */
export function footprintsToBuildings(fc: FootprintCollection, frame: WorldFrame, osm: Building[]): Building[] {
  const index = new BuildingIndex(osm);
  const out: Building[] = [];
  fc.features.forEach((f, i) => {
    const p = f.properties;
    if (!f.geometry || SKIP_TYPES.has(p.footprint_type)) return;
    const base = p.structure_min_elevation;
    const bottom = p.footprint_min_elevation ?? base;
    const top = p.footprint_max_elevation;
    const structTop = p.structure_max_elevation;
    if (base == null || bottom == null || top == null || structTop == null) return;

    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    const rings: Ring[] = polys.flatMap((poly) => poly.map((ring) => ring.map(([lon, lat]) => frame.latLonToVoxel(lat, lon))));
    if (!rings.length || rings[0].length < 3) return;

    const tags: Tags = {};
    const [cx, cz] = ringCentroid(rings[0]);
    const host = index.find(cx, cz);
    if (host) for (const k of INHERITED) if (host.tags[k] !== undefined) tags[k] = host.tags[k];
    tags.building ??= 'yes';
    tags.height = Math.max(1, top - base).toFixed(1);
    const minHeight = bottom - base;
    if (minHeight >= 1) tags.min_height = minHeight.toFixed(1);
    tags['com:structure_height'] = Math.max(1, structTop - base).toFixed(1);
    tags['com:base_elevation'] = base.toFixed(1);
    tags['com:footprint_type'] = p.footprint_type;
    if (p.roof_type && ROOF_SHAPES[p.roof_type]) tags['roof:shape'] = ROOF_SHAPES[p.roof_type];

    out.push({ id: `com${p.structure_id}-${i}`, rings, tags, isPart: false, structureId: `com${p.structure_id}` });
  });
  return out;
}

/**
 * Keep OSM buildings only where the footprints have no coverage: an OSM
 * building is dropped when more than `threshold` of its cells are covered.
 */
export function osmOutsideCoverage(osm: Building[], footprints: Building[], sizeX: number, sizeZ: number, threshold = 0.2): Building[] {
  const covered = new Uint8Array(sizeX * sizeZ);
  for (const b of footprints) fillPolygon(b.rings, sizeX, sizeZ, (x, z) => (covered[z * sizeX + x] = 1));
  // Grow coverage by a voxel so slivers along shared walls don't survive.
  for (const b of footprints)
    for (const r of b.rings) drawThickLine(r, 2, sizeX, sizeZ, (x, z) => (covered[z * sizeX + x] = 1));
  return osm.filter((b) => {
    let total = 0, hit = 0;
    fillPolygon(b.rings, sizeX, sizeZ, (x, z) => {
      total++;
      hit += covered[z * sizeX + x];
    });
    return total > 0 && hit / total <= threshold;
  });
}

/**
 * Drop buildings standing mostly on road carriageway. Outlines of underground
 * stations are often tagged without any level or layer, and the street they
 * run under is the giveaway. Call after the ground layer is generated.
 */
export function notOnRoads(buildings: Building[], world: VoxelWorld, terrain: Terrain, threshold = 0.3): Building[] {
  return buildings.filter((b) => {
    let total = 0, road = 0;
    fillPolygon(b.rings, world.sizeX, world.sizeZ, (x, z) => {
      total++;
      const m = world.get(x, terrain.surface(x, z), z);
      if (m === M.ASPHALT || m === M.TRAM_TRACK || m === M.KERB) road++;
    });
    return total > 0 && road / total <= threshold;
  });
}
