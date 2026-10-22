// OSM colour and material tags → palette materials. building:colour and
// roof:colour accept CSS colour names or hex codes; building:material and
// roof:material name what the wall or roof is made of. Each is mapped to the
// nearest material in the shared palette.

import { M, PALETTE_SRGB } from '../../src/world/palette';
import type { Tags } from '../model/osm';
import type { FacadeStyle } from './facades';

const CSS: Record<string, number> = {
  white: 0xffffff, whitesmoke: 0xf5f5f5, ivory: 0xfffff0, snow: 0xfffafa, linen: 0xfaf0e6, cream: 0xf3e9cf,
  beige: 0xe8dcc0, wheat: 0xf5deb3, tan: 0xd2b48c, khaki: 0xc3b091, burlywood: 0xdeb887, sandybrown: 0xf4a460,
  yellow: 0xe8d36a, gold: 0xd4af37, lightyellow: 0xfaf3c0, orange: 0xe0883a, peru: 0xcd853f, chocolate: 0xd2691e,
  brown: 0x7a4b36, sienna: 0xa0522d, saddlebrown: 0x8b4513, maroon: 0x7a2a28, darkred: 0x8b1a1a, red: 0xb03a2e,
  firebrick: 0xb22222, indianred: 0xcd5c5c, salmon: 0xe08a74, pink: 0xe8b4b8, lightpink: 0xf0c8c8, coral: 0xe07a5f,
  terracotta: 0xc0603e, brick: 0x9c4a35,
  grey: 0x9a9a9a, gray: 0x9a9a9a, lightgrey: 0xc8c8c8, lightgray: 0xc8c8c8, silver: 0xbfbfbf, gainsboro: 0xdcdcdc,
  darkgrey: 0x6a6a6a, darkgray: 0x6a6a6a, dimgray: 0x5a5a5a, dimgrey: 0x5a5a5a, slategray: 0x708090, slategrey: 0x708090,
  black: 0x2a2a2a, anthracite: 0x3b3f44,
  blue: 0x3d6f8f, lightblue: 0x9cc8dc, skyblue: 0x87c0e0, navy: 0x2a3a5a, steelblue: 0x4682b4, teal: 0x3d7f7f,
  green: 0x5f8a4a, darkgreen: 0x3d5a32, lightgreen: 0x9cc89a, olive: 0x7a7a3a, olivedrab: 0x6b8e23, seagreen: 0x2e8b57,
  turquoise: 0x40c0b0, purple: 0x6a4a7a, violet: 0x9a7ab0,
};

/** Parse an OSM colour value: a CSS name, #rgb or #rrggbb. */
export function parseColour(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (s in CSS) return CSS[s];
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!hex) return undefined;
  const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  return parseInt(h, 16);
}

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Perceptually weighted ("redmean") colour distance. */
function distance(a: number, b: number): number {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

export const WALL_MATERIALS = [
  M.RENDER_CREAM, M.RENDER_WHITE, M.RED_BRICK, M.BROWN_BRICK, M.SANDSTONE, M.CONCRETE, M.CONCRETE_DARK, M.LIMESTONE,
  M.BLUESTONE, M.OCHRE, M.TINT_YELLOW, M.TINT_ORANGE, M.TINT_PINK, M.TINT_SALMON, M.TINT_RED, M.TINT_BLUE,
  M.TINT_GREEN, M.TINT_PALE_GREEN, M.TINT_LIGHT_BLUE, M.TINT_BLACK, M.TINT_BEIGE, M.TINT_GREY, M.TIMBER,
];
export const ROOF_MATERIALS = [
  M.ROOF_TERRACOTTA, M.ROOF_SLATE, M.ROOF_TIN, M.ROOF_DARK, M.ROOF_GRAVEL, M.COPPER_GREEN, M.GOLD, M.TINT_RED, M.TINT_BROWN_ROOF,
  M.TINT_BLUE, M.TINT_GREEN, M.TINT_BLACK, M.RENDER_WHITE,
];

export function nearestMaterial(colour: number, among: readonly number[]): number {
  let best = among[0], bestD = Infinity;
  for (const m of among) {
    const d = distance(colour, PALETTE_SRGB[m]);
    if (d < bestD) [best, bestD] = [m, d];
  }
  return best;
}

const BUILDING_MATERIALS: Record<string, number> = {
  brick: M.RED_BRICK, stone: M.SANDSTONE, sandstone: M.SANDSTONE, limestone: M.LIMESTONE, granite: M.CONCRETE,
  concrete: M.CONCRETE, plaster: M.RENDER_WHITE, render: M.RENDER_CREAM, wood: M.TIMBER, timber_framing: M.TIMBER,
  metal: M.ROOF_TIN, marble: M.RENDER_WHITE, bluestone: M.BLUESTONE,
};
const ROOF_MATS: Record<string, number> = {
  roof_tiles: M.ROOF_TERRACOTTA, tile: M.ROOF_TERRACOTTA, tiles: M.ROOF_TERRACOTTA, slate: M.ROOF_SLATE,
  metal: M.ROOF_TIN, metal_sheet: M.ROOF_TIN, tin: M.ROOF_TIN, copper: M.COPPER_GREEN, zinc: M.ROOF_SLATE,
  concrete: M.CONCRETE, gravel: M.ROOF_GRAVEL, tar_paper: M.ROOF_DARK, asphalt: M.ROOF_DARK, glass: M.GLASS_CLEAR,
  thatch: M.TINT_BEIGE, grass: M.GRASS, wood: M.TIMBER, stone: M.SANDSTONE, gold: M.GOLD,
};

/** Wall material from building:colour or building:material, if tagged. */
export function wallTint(tags: Tags): number | undefined {
  const c = parseColour(tags['building:colour']);
  if (c !== undefined) return nearestMaterial(c, WALL_MATERIALS);
  return BUILDING_MATERIALS[tags['building:material'] ?? ''];
}

/** Roof material from roof:colour or roof:material, if tagged. */
export function roofTint(tags: Tags): number | undefined {
  const c = parseColour(tags['roof:colour']);
  if (c !== undefined) return nearestMaterial(c, ROOF_MATERIALS);
  return ROOF_MATS[tags['roof:material'] ?? ''];
}

/** Base wall materials a style may use, which a tagged colour replaces; windows and glass keep theirs. */
const BASE_WALLS = new Set<number>([M.RENDER_CREAM, M.RENDER_WHITE, M.RED_BRICK, M.BROWN_BRICK, M.SANDSTONE, M.CONCRETE, M.CONCRETE_DARK, M.LIMESTONE]);

/** A style whose plain wall surfaces take the building's tagged colour. */
export function tintStyle(style: FacadeStyle, wall: number | undefined, roof: number | undefined): FacadeStyle {
  if (wall === undefined && roof === undefined) return style;
  return {
    ...style,
    wall: wall === undefined ? style.wall : (c) => {
      const m = style.wall(c);
      return BASE_WALLS.has(m) ? wall : m;
    },
    roof: roof ?? style.roof,
    pitchedRoof: roof ?? style.pitchedRoof,
  };
}
