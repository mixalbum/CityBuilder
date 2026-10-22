import { describe, expect, it } from 'vitest';
import { M } from '../src/world/palette';
import { GROUND_Y } from '../pipeline/config';
import { EXTENTS, GRID_ANGLE_DEG_DEFAULT, ORIGIN } from '../pipeline/fixtures/melbourne';
import { baseLift, buildTerrain, Terrain } from '../pipeline/gen/elevation';
import { generateGround } from '../pipeline/gen/terrain';
import { Projector, WorldFrame } from '../pipeline/geo/project';
import type { Building, Features, Ring } from '../pipeline/model/features';
import type { FootprintCollection } from '../pipeline/model/footprints';
import { rasterizeMask } from '../pipeline/voxel/rasterize';
import { VoxelWorld } from '../pipeline/voxel/world';

const frame = new WorldFrame(new Projector(ORIGIN, GRID_ANGLE_DEG_DEFAULT), EXTENTS.small);
const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** A footprint (5 m square) at a grid position with a given ground elevation. */
function footprint(id: string, gx: number, gn: number, elevation: number) {
  const corner = (dx: number, dn: number) => {
    const { lat, lon } = frame.projector.toLatLon(gx + dx, gn + dn);
    return [lon, lat];
  };
  return {
    geometry: { type: 'Polygon' as const, coordinates: [[corner(0, 0), corner(5, 0), corner(5, 5), corner(0, 5), corner(0, 0)]] },
    properties: {
      structure_id: id, footprint_type: 'Structure', roof_type: 'Flat',
      footprint_min_elevation: elevation, footprint_max_elevation: elevation + 10,
      structure_min_elevation: elevation, structure_max_elevation: elevation + 10,
    },
  };
}

// A slope rising 20 m from south to north across the small extent.
const fc: FootprintCollection = { features: [] };
for (let gx = -150; gx <= 150; gx += 30)
  for (let gn = -150; gn <= 150; gn += 30) fc.features.push(footprint(`${gx},${gn}`, gx, gn, 10 + (gn + 150) / 15));

describe('terrain', () => {
  it('is flat without samples', () => {
    const t = Terrain.flat(10, 10);
    expect(t.lift(3, 3)).toBe(0);
    expect(t.surface(3, 3)).toBe(1);
    expect(t.ground(3, 3)).toBe(GROUND_Y);
  });

  it('interpolates surveyed ground and follows the slope', () => {
    const { terrain, samples } = buildTerrain(fc, frame, []);
    expect(samples).toBe(fc.features.length);
    const [nx, nz] = frame.gridToVoxel(0, 120);
    const [sx, sz] = frame.gridToVoxel(0, -120);
    expect(terrain.lift(nx, nz)).toBeGreaterThan(terrain.lift(sx, sz) + 10);
    const [cx, cz] = frame.gridToVoxel(0, 0);
    expect(terrain.lift(cx, cz)).toBeGreaterThanOrEqual(18);
    expect(terrain.lift(cx, cz)).toBeLessThanOrEqual(22);
  });

  it('pins water to the river level', () => {
    const [cx, cz] = frame.gridToVoxel(0, 0);
    const river = { id: 'w', kind: 'water' as const, rings: [rect(cx - 20, cz - 10, cx + 20, cz + 10)] };
    const { terrain } = buildTerrain(fc, frame, [river]);
    expect(terrain.lift(cx, cz)).toBe(0);
    expect(terrain.lift(cx, cz - 40)).toBeGreaterThan(5);
  });

  it('seats buildings on their surveyed base, or the lowest ground under them', () => {
    const { terrain } = buildTerrain(fc, frame, []);
    const [cx, cz] = frame.gridToVoxel(0, 0);
    const ring = rect(cx - 10, cz - 30, cx + 10, cz + 30);
    const mask = rasterizeMask([ring], frame.sizeX, frame.sizeZ)!;
    const surveyed: Building = { id: 'a', rings: [ring], tags: { 'com:base_elevation': '14.6' }, isPart: false };
    const osmOnly: Building = { id: 'b', rings: [ring], tags: {}, isPart: false };
    expect(baseLift(surveyed, mask, terrain)).toBe(15);
    expect(baseLift(osmOnly, mask, terrain)).toBe(terrain.lift(cx, cz + 30));
  });

  it('lays the street surface on the terrain with subsoil beneath', () => {
    const { terrain } = buildTerrain(fc, frame, []);
    const world = new VoxelWorld(frame.sizeX, 64, frame.sizeZ);
    const features: Features = { buildings: [], roads: [], rails: [], areas: [], trees: [], piers: [], coastlines: [] };
    generateGround(world, features, terrain);
    const [cx, cz] = frame.gridToVoxel(0, 100);
    const s = terrain.surface(cx, cz);
    expect(world.get(cx, s, cz)).toBe(M.FOOTPATH);
    expect(world.get(cx, s - 1, cz)).toBe(M.DIRT);
    expect(world.get(cx, s + 1, cz)).toBe(0);
  });
});
