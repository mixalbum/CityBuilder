import { M } from '../../src/world/palette';
import { GROUND_Y } from '../config';
import type { Building } from '../model/features';
import { parseLength, resolveHeight } from '../model/heights';
import { makeRng, type Rng } from '../util/rng';
import { distanceToEdge, rasterizeMask, type Mask } from '../voxel/rasterize';
import type { VoxelWorld } from '../voxel/world';
import { chooseStyle, type FacadeStyle } from './facades';
import { baseLift, type Terrain } from './elevation';
import { roofTint, tintStyle, wallTint } from './colours';
import { addShapedRoof, ALWAYS_SHAPED, parseRoofShape } from './roofShapes';
import { addRoofDetails } from './roofs';

export interface BuildingStats {
  rendered: number;
  skipped: number;
  styles: Record<string, number>;
  heightSources: Record<string, number>;
}


const forEachCell = (mask: Mask, dist: Uint16Array, cb: (x: number, z: number, d: number, lx: number, lz: number) => void) => {
  for (let lz = 0; lz < mask.d; lz++)
    for (let lx = 0; lx < mask.w; lx++) {
      const d = dist[lz * mask.w + lx];
      if (d) cb(mask.x0 + lx, mask.z0 + lz, d, lx, lz);
    }
};

/** Street furniture-scale footprints: tram stop shelters, platforms, jetties. */
function generateMinor(world: VoxelWorld, type: string, mask: Mask, dist: Uint16Array, g: number): boolean {
  if (type === 'Tram Stop') {
    // Raised platform, posts along the edge and a canopy over the middle.
    forEachCell(mask, dist, (x, z, d, lx, lz) => {
      world.set(x, g, z, M.PLATFORM);
      if (d === 1 && (lx + lz) % 7 === 0) for (let y = g + 1; y <= g + 3; y++) world.set(x, y, z, M.FRAME_DARK);
      if (d >= 1) world.set(x, g + 4, z, d === 1 ? M.FRAME_DARK : M.GLASS_GREY);
    });
    return true;
  }
  if (type === 'Train Platform') {
    forEachCell(mask, dist, (x, z) => world.set(x, g, z, M.PLATFORM));
    return true;
  }
  if (type === 'Jetty') {
    forEachCell(mask, dist, (x, z) => world.set(x, g - 1, z, M.TIMBER_DECK));
    return true;
  }
  return false;
}

/**
 * A convex corner where two straight walls meet: both walls continue for at
 * least two cells. Stair-steps on curved or diagonal walls are exposed on two
 * sides too, but would otherwise all render as corner piers.
 */
function isCorner(distAt: (lx: number, lz: number) => number, lx: number, lz: number, inset: number, zs: number, xs: number): boolean {
  const wallAlongX = distAt(lx - 2 * xs, lz) > inset && distAt(lx - 2 * xs, lz + zs) <= inset;
  const wallAlongZ = distAt(lx, lz - 2 * zs) > inset && distAt(lx + xs, lz - 2 * zs) <= inset;
  return wallAlongX && wallAlongZ;
}

/** A few chimneys poking through a pitched roof of `layers` layers. */
function addChimneys(world: VoxelWorld, mask: Mask, dist: Uint16Array, topY: number, layers: number, rng: Rng): void {
  forEachCell(mask, dist, (x, z, d) => {
    if (d >= 3 && rng() < 0.004) for (let k = 1; k <= Math.min(layers, Math.floor(d / 2)) + 2; k++) world.set(x, topY + k, z, M.RED_BRICK);
  });
}

/** Per-building facade overrides, used by hand-tuned landmarks. */
export type StyleOverrides = Map<Building, (rng: Rng) => FacadeStyle>;

export function generateBuildings(world: VoxelWorld, buildings: Building[], terrain: Terrain, overrides?: StyleOverrides): BuildingStats {
  const stats: BuildingStats = { rendered: 0, skipped: 0, styles: {}, heightSources: {} };
  const styles = new Map<string, { style: FacadeStyle; rng: Rng }>();

  for (const b of buildings) {
    if (b.hidden) continue;
    const mask = rasterizeMask(b.rings, world.sizeX, world.sizeZ);
    if (!mask) {
      stats.skipped++;
      continue;
    }
    const dist = distanceToEdge(mask);
    const minorType = b.tags['com:footprint_type'];
    const g = GROUND_Y + baseLift(b, mask, terrain);
    if (minorType && generateMinor(world, minorType, mask, dist, g)) continue;

    const { height, minHeight, source } = resolveHeight(b.tags);
    const y0 = g + Math.round(minHeight);
    const y1 = Math.min(world.sizeY - 10, g + Math.round(height) - 1);
    if (y1 < y0) continue;

    // Tiers of one structure share a style, chosen from the whole structure's height.
    const override = overrides?.get(b);
    const key = `${b.structureId ?? b.id}${override ? ':landmark' : ''}`;
    if (!styles.has(key)) {
      const rng = makeRng(key);
      const structureHeight = parseFloat(b.tags['com:structure_height'] ?? '') || height;
      const base = override ? override(rng) : chooseStyle(b.tags, structureHeight, rng);
      // Tagged colours and materials recolour generic styles; landmarks keep their own.
      styles.set(key, { style: override ? base : tintStyle(base, wallTint(b.tags), roofTint(b.tags)), rng });
    }
    const { style, rng } = styles.get(key)!;
    // Real massing already contains setbacks and plant rooms.
    const realMassing = b.structureId !== undefined;
    const H = y1 - y0 + 1;
    const insets = Array.from({ length: H + 1 }, (_, yRel) => (realMassing ? 0 : style.inset(yRel, H)));
    const { w, d } = mask;
    const distAt = (lx: number, lz: number) => (lx < 0 || lz < 0 || lx >= w || lz >= d ? 0 : dist[lz * w + lx]);
    // Shaped roofs: pitched ones on low and mid-rise buildings, domes and spires on anything.
    const shape = parseRoofShape(b.tags['roof:shape']);
    const pitched = shape !== undefined && shape !== 'flat' && (H < 40 || ALWAYS_SHAPED.has(shape));
    const pitchedRoof = typeof style.pitchedRoof === 'function' ? style.pitchedRoof(b.tags['roof:shape']!) : style.pitchedRoof;
    const domed = shape === 'dome' || shape === 'onion';
    const roofMaterial = pitched
      ? (roofTint(b.tags) ?? pitchedRoof ?? (domed ? rng.pick([M.COPPER_GREEN, M.ROOF_SLATE, M.GOLD]) : rng.pick([M.ROOF_TERRACOTTA, M.ROOF_SLATE, M.ROOF_TIN])))
      : style.roof;

    forEachCell(mask, dist, (x, z, dc, lx, lz) => {
      // Bluestone foundations where the slope falls away below the surveyed base.
      if (y0 === g) for (let y = terrain.ground(x, z); y < g; y++) world.set(x, y, z, M.BLUESTONE);
      for (let y = y0; y <= y1; y++) {
        const yRel = y - y0;
        const inset = insets[yRel];
        if (dc <= inset) continue;
        let m: number;
        if (y === y1 || dc <= insets[yRel + 1]) {
          m = roofMaterial;
        } else if (dc - inset === 1) {
          const outN = distAt(lx, lz - 1) <= inset, outS = distAt(lx, lz + 1) <= inset;
          const outW = distAt(lx - 1, lz) <= inset, outE = distAt(lx + 1, lz) <= inset;
          const ns = outN || outS, ew = outW || outE;
          m = style.wall({ yRel, fromGround: y - g, H, along: ns ? x : z, alongAxis: ns ? 'x' : 'z', corner: ns && ew && isCorner(distAt, lx, lz, inset, outN ? -1 : 1, outW ? -1 : 1) });
        } else {
          m = style.interior;
        }
        world.set(x, y, z, m);
      }
      if (!pitched && style.parapet !== undefined && dc - insets[H - 1] === 1) world.set(x, y1 + 1, z, style.parapet);
    });

    if (pitched) {
      const roofH = parseLength(b.tags['roof:height']);
      const layers = addShapedRoof(world, mask, dist, y1, shape!, roofMaterial, roofH);
      if (style.rooftop !== 'none' && (shape === 'hipped' || shape === 'gabled')) addChimneys(world, mask, dist, y1, layers, rng);
    }
    else if (style.rooftop !== 'none')
      addRoofDetails(world, {
        mask,
        dist,
        topY: y1,
        topInset: insets[H - 1],
        H,
        style,
        rng,
        plantRoom: !realMassing,
      });
    stats.rendered++;
    stats.styles[style.name] = (stats.styles[style.name] ?? 0) + 1;
    stats.heightSources[realMassing ? 'footprints' : source] = (stats.heightSources[realMassing ? 'footprints' : source] ?? 0) + 1;
  }
  return stats;
}
