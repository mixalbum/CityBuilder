// Shared facade builders for the CBD's 19th-century public buildings.

import { M } from '../../../src/world/palette';
import type { FacadeStyle } from '../facades';

export interface ClassicalOpts {
  name: string;
  wall: number;
  /** Pilasters, quoins, cornice and string courses. */
  trim: number;
  /** Rusticated ground storey, in metres; 0 for none. */
  baseHeight?: number;
  base?: number;
  /** Window bay width and storey height in voxels. */
  bay?: number;
  storey?: number;
  roof?: number;
  pitchedRoof?: FacadeStyle['pitchedRoof'];
  parapet?: number;
  window?: number;
}

/**
 * Classical facade: a rusticated base with arched openings, then storeys of
 * pilastered bays with round-headed windows, under a cornice.
 */
export function classical(o: ClassicalOpts): FacadeStyle {
  const bay = o.bay ?? 5;
  const storey = o.storey ?? 5;
  const baseH = o.baseHeight ?? 0;
  const base = o.base ?? o.wall;
  const win = o.window ?? M.WINDOW_DARK;
  const mid = Math.floor(bay / 2);
  return {
    name: o.name,
    interior: M.CONCRETE_DARK,
    roof: o.roof ?? M.ROOF_SLATE,
    pitchedRoof: o.pitchedRoof ?? M.ROOF_SLATE,
    parapet: o.parapet ?? o.trim,
    rooftop: 'none',
    inset: () => 0,
    wall({ yRel, fromGround, H, along, corner }) {
      if (corner || yRel >= H - 2) return o.trim;
      const a = along % bay;
      if (fromGround < baseH) {
        // Rusticated base: banded stone pierced by arches.
        if (a >= 1 && a <= bay - 2 && fromGround >= 1 && fromGround <= baseH - 2) return fromGround === baseH - 2 && a !== mid ? base : win;
        return fromGround % 2 === 0 ? base : o.wall;
      }
      if (a === 0) return o.trim; // pilaster
      const row = (fromGround - baseH) % storey;
      if (row === 0) return o.trim; // string course
      if (a >= 1 && a <= bay - 2 && row >= 1 && row <= storey - 2) return row === storey - 2 && a !== mid ? o.wall : win;
      return o.wall;
    },
  };
}
