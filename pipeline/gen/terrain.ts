// Ground layer: subsoil, footpaths, roads, parks, water and tram tracks,
// laid over the terrain. A column's street surface is at terrain.surface();
// water sits at its body's level with stone walls up to the banks.

import { M } from '../../src/world/palette';
import type { Features, Road } from '../model/features';
import { drawThickLine, fillPolygon } from '../voxel/rasterize';
import type { VoxelWorld } from '../voxel/world';
import type { Terrain } from './elevation';

const cellNoise = (x: number, z: number): number => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 8;

const ROAD_ORDER: Record<Road['kind'], number> = { footway: 0, service: 1, lane: 2, little: 3, other: 4, main: 5 };
const DECK = new Set([M.ASPHALT, M.FOOTPATH, M.KERB, M.COBBLE]);

/** Surface layer for a road cell: the terrain, or a bridge deck's own height. */
type Level = (x: number, z: number) => number;

function drawRoads(world: VoxelWorld, roads: Road[], levelFor: (r: Road) => Level): void {
  const { sizeX, sizeZ } = world;
  const sorted = [...roads].sort((a, b) => ROAD_ORDER[a.kind] - ROAD_ORDER[b.kind]);
  // Corridors first, then every carriageway, so a crossing street's
  // footpath never paints over an intersection.
  for (const r of sorted) {
    const m = r.kind === 'lane' ? M.COBBLE : M.FOOTPATH;
    const y = levelFor(r);
    drawThickLine(r.line, r.width, sizeX, sizeZ, (x, z) => world.set(x, y(x, z), z, m));
  }
  for (const r of sorted) {
    if (r.kind === 'lane' || r.carriageway <= 0) continue;
    const y = levelFor(r);
    drawThickLine(r.line, r.carriageway, sizeX, sizeZ, (x, z) => world.set(x, y(x, z), z, M.ASPHALT));
  }
}

/** A bridge deck ramps linearly between the terrain heights at its two ends. */
function deckLevel(r: Road, terrain: Terrain): Level {
  const [ax, az] = r.line[0];
  const [bx, bz] = r.line[r.line.length - 1];
  const s0 = terrain.surface(ax, az), s1 = terrain.surface(bx, bz);
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  return (x, z) => {
    const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (z + 0.5 - az) * dz) / len2));
    return Math.round(s0 + (s1 - s0) * t);
  };
}

/** The walkable surface of a column: a bridge deck above the terrain if there is one. */
export function surfaceAt(world: VoxelWorld, terrain: Terrain, x: number, z: number): number {
  const s = terrain.surface(x, z);
  if (world.get(x, s, z) !== 0) return s;
  for (let y = s + 1; y <= s + 12; y++) if (DECK.has(world.get(x, y, z))) return y;
  return s;
}

/** Footpath cells touching asphalt become kerb. */
function addKerbs(world: VoxelWorld, terrain: Terrain): void {
  const { sizeX, sizeZ } = world;
  const at = (x: number, z: number) => world.get(x, surfaceAt(world, terrain, x, z), z);
  const kerbs: [number, number][] = [];
  for (let z = 1; z < sizeZ - 1; z++)
    for (let x = 1; x < sizeX - 1; x++) {
      if (at(x, z) !== M.FOOTPATH) continue;
      if (at(x - 1, z) === M.ASPHALT || at(x + 1, z) === M.ASPHALT || at(x, z - 1) === M.ASPHALT || at(x, z + 1) === M.ASPHALT)
        kerbs.push([x, z]);
    }
  for (const [x, z] of kerbs) world.set(x, surfaceAt(world, terrain, x, z), z, M.KERB);
}

export function generateGround(world: VoxelWorld, f: Features, terrain: Terrain): void {
  const { sizeX, sizeZ } = world;
  const S = (x: number, z: number) => terrain.surface(x, z);

  // Subsoil only as deep as any exposed face: down to the lowest neighbour
  // (or the bottom, at the world's edge), so slopes have no holes.
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++) {
      const L = terrain.lift(x, z);
      const edge = x === 0 || z === 0 || x === sizeX - 1 || z === sizeZ - 1;
      const low = edge ? 0 : Math.min(L, terrain.lift(x - 1, z), terrain.lift(x + 1, z), terrain.lift(x, z - 1), terrain.lift(x, z + 1));
      for (let y = low; y <= L; y++) world.set(x, y, z, M.DIRT);
      world.set(x, L + 1, z, M.FOOTPATH);
    }

  for (const a of f.areas) {
    if (a.kind === 'park' || a.kind === 'grass' || a.kind === 'wood')
      fillPolygon(a.rings, sizeX, sizeZ, (x, z) => world.set(x, S(x, z), z, cellNoise(x, z) < (a.kind === 'wood' ? 6 : 3) ? M.GRASS_DARK : M.GRASS));
    else if (a.kind === 'plaza') fillPolygon(a.rings, sizeX, sizeZ, (x, z) => world.set(x, S(x, z), z, M.PAVING_LIGHT));
    else if (a.kind === 'sand') fillPolygon(a.rings, sizeX, sizeZ, (x, z) => world.set(x, S(x, z), z, M.SAND));
  }

  drawRoads(world, f.roads.filter((r) => !r.bridge), () => S);

  // Water sits at its body's level (terrain pins every water column flat),
  // with stone walls rising to each bank's surface.
  const isWater = new Uint8Array(sizeX * sizeZ);
  const water: [number, number][] = [];
  const flood = (x: number, z: number) => {
    if (isWater[z * sizeX + x]) return;
    const L = terrain.lift(x, z);
    world.set(x, L + 1, z, 0);
    world.set(x, L, z, M.WATER);
    isWater[z * sizeX + x] = 1;
    water.push([x, z]);
  };
  for (const a of f.areas) if (a.kind === 'water') fillPolygon(a.rings, sizeX, sizeZ, flood);
  if (terrain.sea) for (let z = 0; z < sizeZ; z++) for (let x = 0; x < sizeX; x++) if (terrain.isSea(x, z)) flood(x, z);
  for (const [x, z] of water)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ || isWater[nz * sizeX + nx]) continue;
      for (let y = terrain.lift(x, z) + 1; y <= S(nx, nz); y++) if (world.get(nx, y, nz) !== 0) world.set(nx, y, nz, M.RIVER_BANK);
    }

  // Piers: timber decks a metre above the water, out from the bank.
  const pierDeck = (x: number, z: number) => {
    const y = isWater[z * sizeX + x] ? terrain.lift(x, z) + 1 : S(x, z);
    world.set(x, y, z, M.TIMBER_DECK);
  };
  for (const a of f.areas) if (a.kind === 'pier') fillPolygon(a.rings, sizeX, sizeZ, pierDeck);
  for (const p of f.piers) drawThickLine(p.line, p.width, sizeX, sizeZ, pierDeck);

  drawRoads(world, f.roads.filter((r) => r.bridge), (r) => deckLevel(r, terrain));
  addKerbs(world, terrain);

  for (const r of f.rails) {
    const lay = (m: number) => (x: number, z: number) => {
      const y = surfaceAt(world, terrain, x, z);
      if (world.get(x, y, z) !== 0) world.set(x, y, z, m);
    };
    if (r.kind === 'rail') drawThickLine(r.line, 4.5, sizeX, sizeZ, lay(M.RAIL_BALLAST));
    drawThickLine(r.line, r.kind === 'tram' ? 2 : 1.5, sizeX, sizeZ, lay(M.TRAM_TRACK));
  }
}
