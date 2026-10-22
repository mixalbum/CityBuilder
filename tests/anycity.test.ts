import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { M } from '../src/world/palette';
import { profileBBox } from '../pipeline/build';
import { extentAround, slugify, validateProfile, type CityProfile } from '../pipeline/city/profile';
import { nearestMaterial, parseColour, roofTint, tintStyle, wallTint, WALL_MATERIALS } from '../pipeline/gen/colours';
import { coastlineSea } from '../pipeline/gen/coast';
import { gridToTerrain } from '../pipeline/gen/elevation';
import type { FacadeStyle } from '../pipeline/gen/facades';
import { pickAutoLandmarks } from '../pipeline/gen/landmarks/auto';
import { addShapedRoof, parseRoofShape } from '../pipeline/gen/roofShapes';
import { estimateGridAngle, Projector } from '../pipeline/geo/project';
import { mergeOsm, splitBBox, tileBBox, type BBox } from '../pipeline/fetch/overpass';
import { terrariumHeight } from '../pipeline/fetch/dem';
import { areaKind, RoadClassifier, type Area, type Building, type Ring } from '../pipeline/model/features';
import { decodePng } from '../pipeline/util/png';
import { distanceToEdge, rasterizeMask } from '../pipeline/voxel/rasterize';
import { VoxelWorld } from '../pipeline/voxel/world';

const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe('city profiles', () => {
  const ok = { name: 'Test', origin: { lat: 10, lon: 20 }, extent: extentAround(1000) };

  it('accepts a minimal profile and fills the slug', () => {
    expect(validateProfile(ok, 'test').slug).toBe('test');
  });

  it('rejects missing fields, bad extents and oversized areas with readable errors', () => {
    expect(() => validateProfile({ ...ok, name: '' }, 't')).toThrow(/name/);
    expect(() => validateProfile({ ...ok, origin: { lat: 95, lon: 0 } }, 't')).toThrow(/origin/);
    expect(() => validateProfile({ ...ok, extent: { minX: 5, maxX: 0, minN: 0, maxN: 1 } }, 't')).toThrow(/extent/);
    expect(() => validateProfile({ ...ok, extent: extentAround(8000) }, 't')).toThrow(/km²/);
    expect(() => validateProfile({ ...ok, streetWidths: [{ match: '(' }] }, 't')).toThrow(/regular expression/);
  });

  it('makes URL-safe slugs from place names', () => {
    expect(slugify('São Paulo, Brasil')).toBe('sao-paulo-brasil');
    expect(slugify('Zürich Altstadt')).toBe('zurich-altstadt');
  });

  it('downloads a box that covers the extent at any grid rotation', () => {
    const p = validateProfile(ok, 't') as CityProfile;
    const [s, w, n, e] = profileBBox(p);
    const proj = new Projector(p.origin, 37);
    for (const [x, z] of [[-500, -500], [500, 500], [-500, 500], [500, -500]]) {
      const { lat, lon } = proj.toLatLon(x, z);
      expect(lat).toBeGreaterThan(s);
      expect(lat).toBeLessThan(n);
      expect(lon).toBeGreaterThan(w);
      expect(lon).toBeLessThan(e);
    }
  });
});

describe('roads', () => {
  it('sizes roads by class, lanes and width tags', () => {
    const c = new RoadClassifier();
    expect(c.classify({ highway: 'primary' })!.carriageway).toBe(14);
    expect(c.classify({ highway: 'residential', lanes: '4' })!.carriageway).toBeCloseTo(13.2);
    expect(c.classify({ highway: 'residential', width: '9 m' })!.carriageway).toBe(9);
    expect(c.classify({ highway: 'footway' })).toMatchObject({ kind: 'footway', carriageway: 0 });
    expect(c.classify({ highway: 'service' })!.kind).toBe('service');
    expect(c.classify({ highway: 'steps' })).toBeUndefined();
  });

  it("applies a city's own rules first, by name or highway class", () => {
    const c = new RoadClassifier([
      { match: '^Grand ', width: 40, carriageway: 24, kind: 'main' },
      { highway: '^service$', kind: 'lane' },
      { match: 'Lane$', kind: 'lane' },
    ]);
    expect(c.classify({ highway: 'secondary', name: 'Grand Avenue' })).toMatchObject({ width: 40, carriageway: 24 });
    expect(c.classify({ highway: 'service' })!.kind).toBe('lane');
    // Lane rules never cobble a footpath.
    expect(c.classify({ highway: 'footway', name: 'Hosier Lane' })!.kind).toBe('footway');
  });
});

describe('open areas', () => {
  it('classifies parks, woods, sand, squares and piers', () => {
    expect(areaKind({ leisure: 'park' })).toBe('park');
    expect(areaKind({ landuse: 'forest' })).toBe('wood');
    expect(areaKind({ natural: 'beach' })).toBe('sand');
    expect(areaKind({ place: 'square' })).toBe('plaza');
    expect(areaKind({ man_made: 'pier' })).toBe('pier');
    expect(areaKind({ landuse: 'retail' })).toBeUndefined();
  });
});

describe('grid angle', () => {
  const origin = { lat: 0, lon: 0 };
  const proj = new Projector(origin, 0);
  /** Streets on a grid rotated by `deg`, as lat/lon lines. */
  const grid = (deg: number) => {
    const p = new Projector(origin, deg);
    const lines = [];
    for (let k = -3; k <= 3; k++) {
      lines.push({ name: `Street ${k}`, highway: 'residential', points: [p.toLatLon(-400, k * 100), p.toLatLon(400, k * 100)] });
      lines.push({ name: `Avenue ${k}`, highway: 'residential', points: [p.toLatLon(k * 100, -400), p.toLatLon(k * 100, 400)] });
    }
    return lines;
  };

  it('finds the dominant street bearing of an unnamed grid', () => {
    expect(estimateGridAngle(grid(28), proj)).toBeCloseTo(28, 0);
    expect(estimateGridAngle(grid(-12), proj)).toBeCloseTo(-12, 0);
  });

  it('ignores footpaths and needs enough street to trust', () => {
    const paths = grid(10).map((l) => ({ ...l, highway: 'footway' }));
    expect(estimateGridAngle(paths, proj)).toBeUndefined();
  });
});

describe('downloads', () => {
  it('splits a large box into tiles that cover it exactly', () => {
    const box: BBox = [-41.3, 174.76, -41.27, 174.8];
    const tiles = tileBBox(box, 0.014);
    expect(tiles.length).toBe(9);
    expect(Math.min(...tiles.map((t) => t[0]))).toBe(box[0]);
    expect(Math.max(...tiles.map((t) => t[3]))).toBeCloseTo(box[3]);
  });

  it('quarters a slow tile exactly', () => {
    const q = splitBBox([0, 0, 2, 4]);
    expect(q).toHaveLength(4);
    expect(q.reduce((a, [s, w, n, e]) => a + (n - s) * (e - w), 0)).toBe(8);
  });

  it('merges tiles without duplicating elements on their edges', () => {
    const node = (id: number) => ({ type: 'node' as const, id, lat: 0, lon: 0 });
    expect(mergeOsm([{ elements: [node(1), node(2)] }, { elements: [node(2), node(3)] }]).elements.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('decodes PNG elevation tiles (Terrarium encoding)', () => {
    // A 2×1 RGB image: 100 m and -5.5 m.
    const enc = (m: number) => {
      const v = m + 32768;
      return [Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256)];
    };
    const raw = Uint8Array.from([0, ...enc(100), ...enc(-5.5)]);
    const chunk = (type: string, data: Uint8Array) => {
      const b = Buffer.alloc(12 + data.length);
      b.writeUInt32BE(data.length, 0);
      b.write(type, 4, 'ascii');
      Buffer.from(data).copy(b, 8);
      return b;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]);
    const img = decodePng(png);
    expect([img.width, img.height, img.channels]).toEqual([2, 1, 3]);
    expect(terrariumHeight(img, 0, 0)).toBeCloseTo(100);
    expect(terrariumHeight(img, 1, 0)).toBeCloseTo(-5.5);
  });
});

describe('terrain water levels', () => {
  it('pins each water body flat and makes the lowest the datum', () => {
    const CELL = 8, gw = 21, gd = 21, size = 160;
    // Ground rising eastwards from 10 m to 50 m.
    const grid = new Float32Array(gw * gd).map((_, k) => 10 + (k % gw) * 2);
    const river: Area = { id: 'r', kind: 'water', rings: [rect(0, 0, 24, size)] };
    const pond: Area = { id: 'p', kind: 'water', rings: [rect(120, 60, 150, 90)] };
    const t = gridToTerrain(grid, gw, gd, size, size, [river, pond], { datum: 'water', water: 'own' });
    expect(t.lift(10, 80)).toBe(0); // the river is the datum
    const pondLevel = t.lift(130, 70);
    expect(pondLevel).toBeGreaterThan(20); // a pond up the hill keeps its height
    expect(t.lift(145, 85)).toBe(pondLevel); // and is flat
    void CELL;
  });

  it('treats sea cells as sea level', () => {
    const gw = 11, gd = 11;
    const grid = new Float32Array(gw * gd).fill(30);
    const sea = new Uint8Array(gw * gd).map((_, k) => (k % gw < 3 ? 1 : 0));
    const t = gridToTerrain(grid, gw, gd, 80, 80, [], { datum: 'water', water: 'own' }, sea);
    expect(t.isSea(2, 40)).toBe(true);
    expect(t.lift(2, 40)).toBe(0);
    expect(t.lift(70, 40)).toBeGreaterThan(20);
  });
});

describe('coastline sea', () => {
  it('floods the sea side of a coastline (land on the left of its direction)', () => {
    // A coastline running north (towards -z) at x = 50: land to the west, sea to the east.
    const sea = coastlineSea([[[50, 99], [50, 0]]], 100, 100)!;
    expect(sea[50 * 100 + 80]).toBe(1);
    expect(sea[50 * 100 + 20]).toBe(0);
    expect(sea[99 * 100 + 99]).toBe(1);
  });

  it('closes a bay against the world edge', () => {
    // An L-shaped shore: coming down from the north edge, then out to the east edge.
    const sea = coastlineSea([[[30, 0], [30, 60], [99, 60]]], 100, 100)!;
    // Walking south then east with the land on the left: the north-east corner is land, the rest sea.
    expect(sea[20 * 100 + 70]).toBe(0);
    expect(sea[80 * 100 + 70]).toBe(1);
    expect(sea[80 * 100 + 10]).toBe(1);
  });

  it('returns nothing without coastlines in the world', () => {
    expect(coastlineSea([], 50, 50)).toBeUndefined();
    expect(coastlineSea([[[-10, -10], [-5, -20]]], 50, 50)).toBeUndefined();
  });
});

describe('roof shapes and colours', () => {
  const footprint = (w: number, d: number) => {
    const mask = rasterizeMask([rect(10, 10, 10 + w, 10 + d)], 64, 64)!;
    return { mask, dist: distanceToEdge(mask) };
  };
  const top = (world: VoxelWorld, x: number, z: number) => {
    for (let y = world.sizeY - 1; y >= 0; y--) if (world.get(x, y, z)) return y;
    return -1;
  };

  it('parses OSM roof:shape values and aliases', () => {
    expect(parseRoofShape('gabled')).toBe('gabled');
    expect(parseRoofShape('Pyramid')).toBe('pyramidal');
    expect(parseRoofShape('onion')).toBe('onion');
    expect(parseRoofShape('something')).toBeUndefined();
  });

  it('gables slope across the short axis only', () => {
    const world = new VoxelWorld(64, 64, 64);
    const { mask, dist } = footprint(30, 12);
    addShapedRoof(world, mask, dist, 20, 'gabled', M.ROOF_SLATE);
    // Same height all along the ridge, lower at the eaves.
    expect(top(world, 15, 16)).toBe(top(world, 35, 16));
    expect(top(world, 25, 10)).toBeLessThan(top(world, 25, 16));
  });

  it('domes rise highest in the middle, with a finial', () => {
    const world = new VoxelWorld(64, 64, 64);
    const { mask, dist } = footprint(20, 20);
    const h = addShapedRoof(world, mask, dist, 20, 'dome', M.COPPER_GREEN);
    expect(h).toBeGreaterThan(5);
    expect(top(world, 20, 20)).toBeGreaterThan(20 + h - 1);
    expect(top(world, 11, 20)).toBeLessThan(top(world, 20, 20) - 4);
  });

  it('honours roof:height', () => {
    const world = new VoxelWorld(64, 64, 64);
    const { mask, dist } = footprint(20, 20);
    expect(addShapedRoof(world, mask, dist, 20, 'pyramidal', M.ROOF_TIN, 4)).toBe(4);
  });

  it('maps tagged colours and materials to the nearest palette material', () => {
    expect(parseColour('#fff')).toBe(0xffffff);
    expect(parseColour('Light Grey')).toBe(0xc8c8c8);
    expect(parseColour('nonsense')).toBeUndefined();
    expect(nearestMaterial(0xa04530, WALL_MATERIALS)).toBe(M.RED_BRICK);
    expect(wallTint({ 'building:colour': 'yellow' })).toBe(M.TINT_YELLOW);
    expect(wallTint({ 'building:material': 'brick' })).toBe(M.RED_BRICK);
    expect(roofTint({ 'roof:material': 'copper' })).toBe(M.COPPER_GREEN);
  });

  it('recolours plain walls but keeps windows', () => {
    const style: FacadeStyle = {
      name: 't', inset: () => 0, interior: M.CONCRETE, roof: M.ROOF_GRAVEL, rooftop: 'none',
      wall: (c) => (c.yRel % 2 ? M.WINDOW_DARK : M.RENDER_CREAM),
    };
    const tinted = tintStyle(style, M.TINT_PINK, M.ROOF_TERRACOTTA);
    const ctx = { fromGround: 0, H: 10, along: 0, alongAxis: 'x' as const, corner: false };
    expect(tinted.wall({ ...ctx, yRel: 0 })).toBe(M.TINT_PINK);
    expect(tinted.wall({ ...ctx, yRel: 1 })).toBe(M.WINDOW_DARK);
    expect(tinted.roof).toBe(M.ROOF_TERRACOTTA);
  });
});

describe('automatic landmarks', () => {
  const b = (id: string, name: string, x: number, tags: Record<string, string> = {}): Building => ({
    id, rings: [rect(x, 0, x + 30, 30)], isPart: false, tags: { building: 'yes', name, ...tags },
  });

  it('prefers tall, linked and civic buildings, spread apart', () => {
    const picks = pickAutoLandmarks(
      [
        b('1', 'Tower One', 0, { height: '180' }),
        b('2', 'Tower One annex', 20, { height: '170' }), // too close to Tower One
        b('3', 'Old Church', 400, { building: 'church', wikidata: 'Q1' }),
        b('4', 'Corner Shop', 800),
        b('5', 'Unnamed', 1200, { name: '' }),
      ],
      2,
    );
    expect(picks.map((p) => p.name)).toEqual(['Tower One', 'Old Church']);
  });

  it('skips names the profile already lists', () => {
    expect(pickAutoLandmarks([b('1', 'Town Hall', 0, { height: '40' })], 5, [{ name: 'Town Hall' }])).toEqual([]);
  });
});
