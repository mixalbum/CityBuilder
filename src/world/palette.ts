// Shared material palette. The pipeline writes these indices into voxel
// chunks and the viewer maps them back to colours, so this file is the single
// source of truth for both. Index 0 is always air.

const DEFS = [
  ['AIR', 0x000000],

  // Ground
  ['DIRT', 0x6b5a45],
  ['ASPHALT', 0x47484b],
  ['FOOTPATH', 0x8e8b86], // bluestone-grey pavers
  ['KERB', 0x6c6b69],
  ['COBBLE', 0x5d5a57], // laneway bluestone cobbles
  ['PAVING_LIGHT', 0xb9b2a5], // plazas
  ['GRASS', 0x5f8f3e],
  ['GRASS_DARK', 0x527f35],
  ['WATER', 0x2f5f73],
  ['RIVER_BANK', 0x5a5650],
  ['TRAM_TRACK', 0x3b3430],
  ['ROAD_LINE', 0xe8e6df],
  ['RAIL_BALLAST', 0x7a7068],
  ['PLATFORM', 0xb4b0a6],
  ['TIMBER_DECK', 0x8a6a4a],
  ['SAND', 0xd8c89a],

  // Walls
  ['RENDER_CREAM', 0xe3d6b8],
  ['RENDER_WHITE', 0xece8df],
  ['RED_BRICK', 0x9c4a35],
  ['BROWN_BRICK', 0x7a4b36],
  ['SANDSTONE', 0xcdb48a],
  ['BLUESTONE', 0x4e4f53],
  ['CONCRETE', 0xa9a7a1],
  ['CONCRETE_DARK', 0x77767a],

  // Tints for OSM building:colour / roof:colour tags (any city)
  ['TINT_YELLOW', 0xd9c27a],
  ['TINT_ORANGE', 0xd08a52],
  ['TINT_PINK', 0xd9a7a0],
  ['TINT_SALMON', 0xc98068],
  ['TINT_RED', 0xa8483a],
  ['TINT_BLUE', 0x5f7f9f],
  ['TINT_LIGHT_BLUE', 0xa9c4d6],
  ['TINT_GREEN', 0x5f8060],
  ['TINT_PALE_GREEN', 0xb5c9a8],
  ['TINT_BLACK', 0x34363a],
  ['TINT_BEIGE', 0xcdbb98],
  ['TINT_GREY', 0x8f9297],
  ['TINT_BROWN_ROOF', 0x6e4a38],
  ['TIMBER', 0x9a7550],

  // Glazing and frames
  ['GLASS_BLUE', 0x3d6f8f],
  ['GLASS_GREEN', 0x4f7e74],
  ['GLASS_GREY', 0x55606b],
  ['GLASS_BRONZE', 0x6b5a48],
  ['GLASS_DARK', 0x2a3138],
  ['GLASS_CLEAR', 0x9cc8dc], // see-through: rendered in the translucent pass
  ['FRAME_ALU', 0xbfc3c6],
  ['FRAME_DARK', 0x3a3d40],
  ['SPANDREL', 0x6e7378],
  ['WINDOW_DARK', 0x30353b],
  ['SHOPFRONT', 0x40525e],

  // Roofs and rooftop clutter
  ['ROOF_GRAVEL', 0x8d8a83],
  ['ROOF_DARK', 0x5b5a58],
  ['ROOF_TIN', 0x9aa2a6],
  ['ROOF_TERRACOTTA', 0xa0533a],
  ['ROOF_SLATE', 0x4a4f57],
  ['PLANT_METAL', 0xa3a8ab],
  ['HELIPAD', 0x3f4446],
  ['HELIPAD_MARK', 0xf2f2f2],

  // Accents (landmarks)
  ['GOLD', 0xd4af37],
  ['COPPER_GREEN', 0x5f9e8a],
  ['OCHRE', 0xc98a4b],
  ['EUREKA_RED', 0xb3262b],
  ['PAVING_OCHRE', 0xb08a63],
  ['LIMESTONE', 0xb9b4a6],
  ['CLOCK_FACE', 0xf4f1e6],

  // Vegetation
  ['TREE_TRUNK', 0x5a4632],
  ['LEAF_1', 0x4f7d2f],
  ['LEAF_2', 0x5e8c36],
  ['LEAF_3', 0x6f9a3c],
] as const;

export type MaterialName = (typeof DEFS)[number][0];

export const M = Object.fromEntries(DEFS.map((d, i) => [d[0], i])) as Record<MaterialName, number>;

export const PALETTE_SRGB: readonly number[] = DEFS.map((d) => d[1]);

export const MATERIAL_NAMES: readonly MaterialName[] = DEFS.map((d) => d[0]);

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-space RGB floats (0..1), 3 per material, for vertex colours. */
export function linearPalette(): Float32Array {
  const out = new Float32Array(256 * 3);
  PALETTE_SRGB.forEach((hex, i) => {
    out[i * 3] = srgbToLinear(((hex >> 16) & 0xff) / 255);
    out[i * 3 + 1] = srgbToLinear(((hex >> 8) & 0xff) / 255);
    out[i * 3 + 2] = srgbToLinear((hex & 0xff) / 255);
  });
  return out;
}

// Night lighting. Shopfronts and clock faces are always lit; a share of
// windows and curtain-wall glass light up in window-sized blocks.
const ALWAYS_LIT = new Set([M.SHOPFRONT, M.CLOCK_FACE]);
const WINDOW_LIT_SHARE = new Map<number, number>([
  [M.WINDOW_DARK, 0.45],
  [M.GLASS_BLUE, 0.3],
  [M.GLASS_GREEN, 0.3],
  [M.GLASS_GREY, 0.3],
  [M.GLASS_BRONZE, 0.3],
  [M.GLASS_DARK, 0.3],
]);

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 1 if the voxel of material `m` at world (x, y, z) glows at night, else 0. */
export function glowAt(m: number, x: number, y: number, z: number): number {
  if (ALWAYS_LIT.has(m)) return 1;
  const share = WINDOW_LIT_SHARE.get(m);
  if (!share) return 0;
  return hash3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3)) < share ? 1 : 0;
}

/** Materials rendered in the translucent pass; they don't hide or shade what's behind them. */
export const TRANSPARENT = new Set([M.GLASS_CLEAR]);
