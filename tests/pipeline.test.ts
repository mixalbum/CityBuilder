import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorld } from '../pipeline/build';
import { loadProfile } from '../pipeline/city/profile';
import { EXTENTS, GRID_ANGLE_DEG_DEFAULT, MAIN_STREETS, ORIGIN } from '../pipeline/fixtures/melbourne';
import { generateSyntheticOsm } from '../pipeline/fixtures/synthetic';
import { Projector, WorldFrame, estimateGridAngle } from '../pipeline/geo/project';
import { assembleRings, extractFeatures, hideOutlinesWithParts, isUnderground, osmLines, type Building } from '../pipeline/model/features';
import { footprintsToBuildings, osmOutsideCoverage, type FootprintCollection } from '../pipeline/model/footprints';
import { parseLength, resolveHeight } from '../pipeline/model/heights';
import { distanceToEdge, drawThickLine, fillPolygon, rasterizeMask } from '../pipeline/voxel/rasterize';
import { VoxelWorld } from '../pipeline/voxel/world';

describe('projection', () => {
  const p = new Projector(ORIGIN, GRID_ANGLE_DEG_DEFAULT);

  it('round-trips grid metres through lat/lon', () => {
    for (const [x, n] of [[0, 0], [600, 800], [-1100, -400], [123.4, -56.7]]) {
      const { lat, lon } = p.toLatLon(x, n);
      const [gx, gn] = p.toGrid(lat, lon);
      expect(gx).toBeCloseTo(x, 6);
      expect(gn).toBeCloseTo(n, 6);
    }
  });

  it('recovers the grid angle from street geometry', () => {
    const angle = estimateGridAngle(osmLines(generateSyntheticOsm()), new Projector(ORIGIN, 0), MAIN_STREETS);
    expect(angle).toBeCloseTo(GRID_ANGLE_DEG_DEFAULT, 1);
  });

  it('keeps Collins St axis-aligned in voxel space', () => {
    const frame = new WorldFrame(p, EXTENTS.full);
    const f = extractFeatures(generateSyntheticOsm(), frame);
    const collins = f.roads.find((r) => r.name === 'Collins Street')!;
    const zs = collins.line.map(([, z]) => z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1);
  });
});

describe('rasterization', () => {
  it('fills a square by voxel centres', () => {
    let n = 0;
    fillPolygon([[[2, 2], [12, 2], [12, 7], [2, 7]]], 100, 100, () => n++);
    expect(n).toBe(50);
  });

  it('leaves holes empty (even-odd)', () => {
    let n = 0;
    const outer: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const inner: [number, number][] = [[3, 3], [7, 3], [7, 7], [3, 7]];
    fillPolygon([outer, inner], 100, 100, () => n++);
    expect(n).toBe(100 - 16);
  });

  it('clips to the world', () => {
    let n = 0;
    fillPolygon([[[-5, -5], [5, -5], [5, 5], [-5, 5]]], 100, 100, () => n++);
    expect(n).toBe(25);
  });

  it('draws thick lines without duplicates', () => {
    const seen = new Set<string>();
    let n = 0;
    drawThickLine([[10, 10], [30, 10], [30, 30]], 4, 100, 100, (x, z) => {
      seen.add(`${x},${z}`);
      n++;
    });
    expect(n).toBe(seen.size);
    expect(seen.has('20,10')).toBe(true);
    expect(seen.has('20,13')).toBe(false);
  });

  it('measures distance to edge for setbacks', () => {
    const mask = rasterizeMask([[[0, 0], [6, 0], [6, 6], [0, 6]]], 100, 100)!;
    const d = distanceToEdge(mask);
    expect(d[0]).toBe(1);
    expect(d[1 * 6 + 1]).toBe(2);
    expect(d[2 * 6 + 2]).toBe(3);
  });
});

describe('heights', () => {
  it('parses OSM lengths', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12.5 m')).toBe(12.5);
    expect(parseLength('12,5')).toBe(12.5);
    expect(parseLength('100 ft')).toBeCloseTo(30.48);
    expect(parseLength("10'6\"")).toBeCloseTo(3.2004);
    expect(parseLength('tall')).toBeUndefined();
  });

  it('prefers height over levels over defaults', () => {
    expect(resolveHeight({ building: 'yes', height: '50', 'building:levels': '3' })).toMatchObject({ height: 50, source: 'height' });
    expect(resolveHeight({ building: 'yes', 'building:levels': '3' })).toMatchObject({ height: 4.5 + 2 * 3.4, source: 'levels' });
    expect(resolveHeight({ building: 'yes' })).toMatchObject({ height: 10, source: 'default' });
    expect(resolveHeight({ building: 'house' }).height).toBe(7);
  });

  it('handles min_height for raised parts', () => {
    expect(resolveHeight({ 'building:part': 'yes', height: '40', min_height: '30' })).toMatchObject({ height: 40, minHeight: 30 });
  });
});

describe('features', () => {
  it('assembles relation member ways into closed rings', () => {
    const a = { lat: 0, lon: 0 }, b = { lat: 0, lon: 1 }, c = { lat: 1, lon: 1 }, d = { lat: 1, lon: 0 };
    const rings = assembleRings([[a, b], [c, b], [c, d, a]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][4]);
  });

  it('hides outlines that have building:part children', () => {
    const sq = (x: number): [number, number][] => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]];
    const bs: Building[] = [
      { id: 'outline', rings: [sq(0)], tags: { building: 'yes' }, isPart: false },
      { id: 'part', rings: [sq(2).map(([x, z]) => [x, z / 2] as [number, number])], tags: { 'building:part': 'yes' }, isPart: true },
      { id: 'other', rings: [sq(50)], tags: { building: 'yes' }, isPart: false },
    ];
    const out = hideOutlinesWithParts(bs);
    expect(out.find((b) => b.id === 'outline')!.hidden).toBe(true);
    expect(out.find((b) => b.id === 'other')!.hidden).toBeUndefined();
  });
});

describe('underground detection', () => {
  it('treats negative levels, layers and tunnels as underground', () => {
    expect(isUnderground({ 'building:part': 'yes', level: '-3' })).toBe(true);
    expect(isUnderground({ level: '-2;-1' })).toBe(true);
    expect(isUnderground({ level: '-1;0' })).toBe(false);
    expect(isUnderground({ layer: '-1' })).toBe(true);
    expect(isUnderground({ tunnel: 'yes' })).toBe(true);
    expect(isUnderground({ building: 'yes' })).toBe(false);
  });
});

describe('City of Melbourne footprints', () => {
  const frame = new WorldFrame(new Projector(ORIGIN, GRID_ANGLE_DEG_DEFAULT), EXTENTS.small);
  // A 20 x 20 m podium with a 10 x 10 m tower tier on top, near the origin.
  const square = (x0: number, n0: number, s: number) =>
    [[x0, n0], [x0 + s, n0], [x0 + s, n0 + s], [x0, n0 + s], [x0, n0]].map(([x, n]) => {
      const { lat, lon } = frame.projector.toLatLon(x, n);
      return [lon, lat];
    });
  const tier = (coords: number[][], min: number, max: number) => ({
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {
      structure_id: '42', footprint_type: 'Structure', roof_type: 'Flat',
      footprint_min_elevation: min, footprint_max_elevation: max,
      structure_min_elevation: 10, structure_max_elevation: 110,
    },
  });
  const fc: FootprintCollection = { features: [tier(square(20, 20, 20), 10, 30), tier(square(25, 25, 10), 30, 110)] };
  const osmHost: Building = {
    id: 'w1',
    rings: [square(15, 15, 30).map(([lon, lat]) => frame.latLonToVoxel(lat, lon))],
    tags: { building: 'office', name: 'Test Tower', start_date: '1990', height: '999' },
    isPart: false,
  };

  it('converts tiers to heights above the structure base and inherits OSM tags', () => {
    const [podium, tower] = footprintsToBuildings(fc, frame, [osmHost]);
    expect(podium.tags).toMatchObject({ height: '20.0', name: 'Test Tower', start_date: '1990', building: 'office' });
    expect(podium.tags.min_height).toBeUndefined();
    expect(tower.tags).toMatchObject({ height: '100.0', min_height: '20.0', 'com:structure_height': '100.0' });
    expect(podium.structureId).toBe(tower.structureId);
  });

  it('keeps OSM buildings only outside footprint coverage', () => {
    const tiers = footprintsToBuildings(fc, frame, [osmHost]);
    const away: Building = { ...osmHost, id: 'w2', rings: [square(-120, -120, 20).map(([lon, lat]) => frame.latLonToVoxel(lat, lon))] };
    const kept = osmOutsideCoverage([osmHost, away], tiers, frame.sizeX, frame.sizeZ);
    expect(kept.map((b) => b.id)).toEqual(['w2']);
  });
});

describe('voxel world', () => {
  it('stores sparse voxels across chunk borders', () => {
    const w = new VoxelWorld(100, 64, 100);
    w.set(31, 0, 31, 5);
    w.set(32, 33, 32, 7);
    w.set(-1, 0, 0, 9); // out of bounds: ignored
    expect(w.get(31, 0, 31)).toBe(5);
    expect(w.get(32, 33, 32)).toBe(7);
    expect(w.get(-1, 0, 0)).toBe(0);
    expect([...w.entries()].map((e) => [e.cx, e.cy, e.cz])).toEqual(
      expect.arrayContaining([[0, 0, 0], [1, 1, 1]]),
    );
  });
});

describe('build', () => {
  const hashWorld = (w: VoxelWorld) => {
    const h = createHash('sha256');
    for (const k of [...w.chunks.keys()].sort((a, b) => a - b)) h.update(String(k)).update(w.chunks.get(k)!);
    return h.digest('hex');
  };

  it('is deterministic and writes a manifest', () => {
    const run = () =>
      buildWorld({
        profile: loadProfile('melbourne'),
        osm: 'synthetic',
        extent: EXTENTS.small,
        out: mkdtempSync(join(tmpdir(), 'citybuilder-')),
        log: () => {},
      });
    const a = run();
    const b = run();
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.manifest.regions.length).toBeGreaterThan(0);
    expect(a.manifest.source).toBe('synthetic');
    expect(a.manifest.landmarks.map((l) => l.name)).toContain('Flinders Street Station');
  }, 60_000);
});
