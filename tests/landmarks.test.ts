import { describe, expect, it } from 'vitest';
import { M } from '../src/world/palette';
import { EXTENTS, GRID_ANGLE_DEG_DEFAULT, ORIGIN } from '../pipeline/fixtures/melbourne';
import { generateBuildings } from '../pipeline/gen/buildings';
import { Terrain } from '../pipeline/gen/elevation';
import type { FacadeStyle } from '../pipeline/gen/facades';
import { planLandmarks, type LandmarkModel } from '../pipeline/gen/landmarks';
import { Kit, radialDistance, ribDistance } from '../pipeline/gen/landmarks/kit';
import { Projector, WorldFrame } from '../pipeline/geo/project';
import type { Building, Ring } from '../pipeline/model/features';
import { VoxelWorld } from '../pipeline/voxel/world';

const frame = new WorldFrame(new Projector(ORIGIN, GRID_ANGLE_DEG_DEFAULT), EXTENTS.small);
const newWorld = () => new VoxelWorld(frame.sizeX, 128, frame.sizeZ);
const count = (w: VoxelWorld, m?: number) => {
  let n = 0;
  for (const c of w.chunks.values()) for (const v of c) if (m === undefined ? v !== 0 : v === m) n++;
  return n;
};
const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe('modelling kit', () => {
  it('measures distance by footprint shape', () => {
    expect(radialDistance(3, 4, 'circle')).toBe(5);
    expect(radialDistance(3, 4, 'square')).toBe(4);
    expect(radialDistance(3, 3, 'octagon')).toBeCloseTo(6 / Math.SQRT2);
    expect(ribDistance(0, 4)).toBeCloseTo(0);
    expect(ribDistance(Math.PI / 4, 4)).toBeCloseTo(0.5);
  });

  it('lathes solid cylinders and hollow shells', () => {
    const solid = newWorld();
    new Kit(solid, frame).lathe(50, 50, 10, 19, () => 5, M.SANDSTONE);
    const perLayer = count(solid) / 10;
    expect(perLayer).toBeGreaterThan(Math.PI * 25 * 0.85);
    expect(perLayer).toBeLessThan(Math.PI * 25 * 1.15);

    const shell = newWorld();
    new Kit(shell, frame).lathe(50, 50, 10, 19, () => 5, M.SANDSTONE, { shell: 1.2 });
    expect(count(shell)).toBeLessThan(count(solid) * 0.6);
    expect(shell.get(50, 15, 50)).toBe(0); // hollow inside
  });

  it('ends spires in a single point', () => {
    const w = newWorld();
    new Kit(w, frame).spire(50.5, 50.5, 10, 30, 4, M.LIMESTONE);
    let top = 0;
    for (let y = 0; y < 40; y++) if (w.get(50, y, 50)) top = y;
    expect(top).toBe(30);
    expect(w.get(51, 30, 50)).toBe(0);
  });

  it('builds gable roofs that rise to a ridge', () => {
    const w = newWorld();
    new Kit(w, frame).gable(10, 10, 20, 30, 40, 'z', M.ROOF_SLATE);
    expect(w.get(15, 45, 20)).toBe(M.ROOF_SLATE); // ridge along z at the middle
    expect(w.get(10, 41, 20)).toBe(0); // eaves stay low
  });
});

describe('corner detection', () => {
  const marker: FacadeStyle = {
    name: 'test',
    interior: M.CONCRETE,
    roof: M.ROOF_GRAVEL,
    rooftop: 'none',
    inset: () => 0,
    wall: ({ corner }) => (corner ? M.GOLD : M.SANDSTONE),
  };
  const build = (ring: Ring) => {
    const w = newWorld();
    const b: Building = { id: 'b', rings: [ring], tags: { building: 'yes', height: '10' }, isPart: false };
    generateBuildings(w, [b], Terrain.flat(w.sizeX, w.sizeZ), new Map([[b, () => marker]]));
    return w;
  };

  it('marks the four corners of a rectangle', () => {
    const w = build(rect(20, 20, 40, 30));
    const layers = 10 - 1; // the top layer is roof
    expect(count(w, M.GOLD)).toBe(4 * layers);
  });

  it('does not turn the stair-steps of a diagonal wall into corners', () => {
    const w = build([[60, 40], [80, 60], [60, 80], [40, 60]]); // diamond
    expect(count(w, M.GOLD) / 9).toBeLessThanOrEqual(4);
    expect(count(w, M.SANDSTONE)).toBeGreaterThan(0);
  });
});

describe('landmark planning', () => {
  const tier = (id: string, ring: Ring, tags: Record<string, string>, structureId?: string): Building => ({
    id, rings: [ring], tags: { building: 'yes', ...tags }, isPart: false, structureId,
  });
  const [ox, oz] = frame.gridToVoxel(0, 0);
  const podium = tier('podium', rect(ox - 10, oz - 10, ox + 10, oz + 10), { height: '20' }, 's1');
  const spire = tier('spire', rect(ox - 2, oz - 2, ox + 2, oz + 2), { height: '90', min_height: '20' }, 's1');
  const named = tier('named', rect(ox + 40, oz + 40, ox + 60, oz + 60), { height: '15', name: 'Test Hall' }, 's2');
  const other = tier('other', rect(ox - 60, oz - 60, ox - 40, oz - 40), { height: '12' }, 's3');
  const all = [podium, spire, named, other];
  const style = (): FacadeStyle => ({ name: 'x', interior: 1, roof: 1, rooftop: 'none', inset: () => 0, wall: () => 1 });

  it('claims whole structures, drops replaced tiers and restyles the rest', () => {
    const model: LandmarkModel = { name: 'Tower', select: { structureAt: [0, 0] }, drop: (t) => t.minH >= 20, style };
    const plan = planLandmarks(all, frame, newWorld(), Terrain.flat(frame.sizeX, frame.sizeZ), [model]);
    expect(plan.sites[0].tiers.map((t) => t.b.id).sort()).toEqual(['podium', 'spire']);
    expect(plan.buildings).not.toContain(spire);
    expect(plan.buildings).toContain(podium);
    expect(plan.overrides.has(podium)).toBe(true);
    expect(plan.overrides.has(other)).toBe(false);
  });

  it('selects by name and by rectangle, each tier at most once', () => {
    const byName: LandmarkModel = { name: 'Hall', select: { names: ['test hall'] } };
    const byRect: LandmarkModel = { name: 'Area', select: { rect: [-80, 80, -80, 80] } };
    const plan = planLandmarks(all, frame, newWorld(), Terrain.flat(frame.sizeX, frame.sizeZ), [byName, byRect]);
    expect(plan.sites[0].tiers.map((t) => t.b.id)).toEqual(['named']);
    expect(plan.sites[1].tiers.map((t) => t.b.id).sort()).toEqual(['other', 'podium', 'spire']);
    expect(plan.sites[1].x0).toBeLessThan(plan.sites[1].x1);
  });
});
