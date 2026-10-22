// Hand-tuned landmarks. Each model claims the footprint tiers of its building,
// restyles them and/or replaces some with modelled forms (domes, spires,
// lattices), so placement and massing stay true to the data. Models live with
// their city, in cities/<slug>/landmarks/index.ts.

import { GROUND_Y } from '../../config';
import type { WorldFrame } from '../../geo/project';
import { pointInRings, type Building } from '../../model/features';
import { resolveHeight } from '../../model/heights';
import { baseLift, type Terrain } from '../elevation';
import { distanceToEdge, rasterizeMask } from '../../voxel/rasterize';
import type { VoxelWorld } from '../../voxel/world';
import type { StyleOverrides } from '../buildings';
import { Kit } from './kit';
import type { LandmarkModel, Site, SiteTier } from './types';

export type { LandmarkModel, Site, SiteTier } from './types';

export interface LandmarkPlan {
  /** Buildings to generate: everything except dropped landmark tiers. */
  buildings: Building[];
  overrides: StyleOverrides;
  sites: Site[];
}

function centroid(b: Building): [number, number] {
  const r = b.rings[0];
  let x = 0, z = 0;
  for (const [px, pz] of r) {
    x += px;
    z += pz;
  }
  return [x / r.length, z / r.length];
}

function selectTiers(model: LandmarkModel, candidates: Building[], frame: WorldFrame): Building[] {
  const { structureAt, names, rect } = model.select;
  if (structureAt) {
    const [x, z] = frame.gridToVoxel(...structureAt);
    const ids = new Set(candidates.filter((b) => b.structureId && pointInRings(x, z, b.rings)).map((b) => b.structureId));
    return candidates.filter((b) => b.structureId && ids.has(b.structureId));
  }
  if (names) {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    return candidates.filter((b) => wanted.has((b.tags.name ?? '').toLowerCase()));
  }
  if (rect) {
    const [ax, az] = frame.gridToVoxel(rect[0], rect[3]);
    const [bx, bz] = frame.gridToVoxel(rect[1], rect[2]);
    return candidates.filter((b) => {
      const [x, z] = centroid(b);
      return x >= ax && x <= bx && z >= az && z <= bz;
    });
  }
  return [];
}

export function planLandmarks(
  buildings: Building[],
  frame: WorldFrame,
  world: VoxelWorld,
  terrain: Terrain,
  models: LandmarkModel[],
): LandmarkPlan {
  const claimed = new Set<Building>();
  const dropped = new Set<Building>();
  const overrides: StyleOverrides = new Map();
  const sites: Site[] = [];
  // Street furniture (tram stops, platforms) stays generic.
  const candidates = buildings.filter((b) => !b.hidden && !['Tram Stop', 'Train Platform', 'Jetty'].includes(b.tags['com:footprint_type'] ?? ''));

  for (const model of models) {
    const tiers: SiteTier[] = [];
    for (const b of selectTiers(model, candidates, frame)) {
      if (claimed.has(b)) continue;
      const mask = rasterizeMask(b.rings, world.sizeX, world.sizeZ);
      if (!mask) continue;
      claimed.add(b);
      const { height, minHeight } = resolveHeight(b.tags);
      const g = GROUND_Y + baseLift(b, mask, terrain);
      tiers.push({
        b,
        mask,
        dist: distanceToEdge(mask),
        minH: minHeight,
        h: height,
        y0: g + Math.round(minHeight),
        y1: g + Math.round(height) - 1,
        roof: b.tags['roof:shape'],
        dropped: false,
      });
    }
    const site: Site = { model, tiers, base: GROUND_Y, x0: NaN, z0: NaN, x1: NaN, z1: NaN };
    if (tiers.length) site.base = Math.min(...tiers.map((t) => t.y0 - Math.round(t.minH)));
    for (const t of tiers) {
      site.x0 = Math.min(Number.isNaN(site.x0) ? Infinity : site.x0, t.mask.x0);
      site.z0 = Math.min(Number.isNaN(site.z0) ? Infinity : site.z0, t.mask.z0);
      site.x1 = Math.max(Number.isNaN(site.x1) ? -Infinity : site.x1, t.mask.x0 + t.mask.w - 1);
      site.z1 = Math.max(Number.isNaN(site.z1) ? -Infinity : site.z1, t.mask.z0 + t.mask.d - 1);
      t.dropped = model.drop?.(t) ?? false;
      if (t.dropped) dropped.add(t.b);
      else if (model.style) overrides.set(t.b, (rng) => model.style!(rng, site));
    }
    sites.push(site);
  }
  return { buildings: buildings.filter((b) => !dropped.has(b)), overrides, sites };
}

export function buildLandmarks(world: VoxelWorld, frame: WorldFrame, sites: Site[], terrain: Terrain, log: (msg: string) => void = () => {}): void {
  for (const site of sites) {
    site.model.build?.(new Kit(world, frame, terrain, site.base), site);
    const dropped = site.tiers.filter((t) => t.dropped).length;
    log(`  ${site.model.name}: ${site.tiers.length} tiers claimed, ${dropped} replaced`);
  }
}
