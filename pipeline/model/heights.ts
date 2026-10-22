import type { Tags } from './osm';

export const LEVEL_HEIGHT = 3.4;
export const GROUND_FLOOR_HEIGHT = 4.5;

/** Parse an OSM length: "12", "12 m", "12,5", "40 ft", "40'", "12'6\"". Returns metres. */
export function parseLength(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const s = raw.trim().replace(',', '.');
  const feetInches = /^(\d+(?:\.\d+)?)'\s*(?:(\d+(?:\.\d+)?)")?$/.exec(s);
  if (feetInches) return (parseFloat(feetInches[1]) * 12 + parseFloat(feetInches[2] ?? '0')) * 0.0254;
  const m = /^(-?\d+(?:\.\d+)?)\s*(m|ft|feet)?$/i.exec(s);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return m[2] && m[2].toLowerCase() !== 'm' ? v * 0.3048 : v;
}

function parseLevels(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const v = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Height of the top of `levels` storeys: a tall ground floor plus standard floors. */
export function levelsToHeight(levels: number): number {
  if (levels <= 0) return 0;
  return GROUND_FLOOR_HEIGHT + (levels - 1) * LEVEL_HEIGHT;
}

/** Typical heights (metres) by OSM building type, for buildings without height or levels. */
const TYPE_DEFAULTS: Record<string, number> = {
  house: 7, detached: 7, semidetached_house: 8, terrace: 9, bungalow: 5, cabin: 4, hut: 3,
  garage: 3, garages: 3, carport: 3, shed: 3, roof: 6, kiosk: 4, toilets: 3, service: 4,
  greenhouse: 4, transformer_tower: 6, container: 3,
  church: 20, chapel: 12, cathedral: 30, mosque: 15, temple: 12, synagogue: 15,
  train_station: 15, retail: 8, supermarket: 8, industrial: 10, warehouse: 10, parking: 12,
  school: 10, hospital: 20, stadium: 25, grandstand: 12,
};

/** Height for untagged buildings of no known type: about three storeys. */
export const DEFAULT_HEIGHT = 10;

let fallbackHeight = DEFAULT_HEIGHT;

/**
 * Set the height used for buildings with no height, levels or known type,
 * from the city profile (e.g. 12 m for Melbourne's 2-4 storey Victorian stock).
 */
export function setDefaultHeight(metres: number | undefined): void {
  fallbackHeight = metres ?? DEFAULT_HEIGHT;
}

export interface ResolvedHeight {
  height: number;
  minHeight: number;
  source: 'height' | 'levels' | 'default';
}

/** Precedence: height tag > building:levels > per-type default. */
export function resolveHeight(tags: Tags): ResolvedHeight {
  let height = parseLength(tags.height);
  let source: ResolvedHeight['source'] = 'height';
  if (height === undefined) {
    const levels = parseLevels(tags['building:levels']);
    if (levels !== undefined && levels > 0) {
      const roofLevels = parseLevels(tags['roof:levels']) ?? 0;
      height = levelsToHeight(levels) + roofLevels * LEVEL_HEIGHT;
      source = 'levels';
    }
  }
  if (height === undefined) {
    height = TYPE_DEFAULTS[tags.building ?? ''] ?? fallbackHeight;
    source = 'default';
  }

  let minHeight = parseLength(tags.min_height);
  if (minHeight === undefined) {
    const minLevel = parseLevels(tags['building:min_level']);
    minHeight = minLevel ? levelsToHeight(minLevel) : 0;
  }
  return { height: Math.max(height, minHeight + 1), minHeight, source };
}
