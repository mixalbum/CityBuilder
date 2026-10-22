import type { Tags } from '../../model/osm';
import type { Rng } from '../../util/rng';
import { artDeco } from './artDeco';
import { glassTower } from './glassTower';
import type { FacadeStyle } from './types';
import { victorian } from './victorian';
import { warehouse } from './warehouse';

export type { FacadeStyle, WallCtx } from './types';

function yearOf(tags: Tags): number | undefined {
  const m = /(\d{4})/.exec(tags.start_date ?? '');
  return m ? parseInt(m[1], 10) : undefined;
}

/** Building types that are stone or masonry whatever their height (spires and towers included). */
const MASONRY = new Set(['church', 'cathedral', 'chapel', 'basilica', 'mosque', 'synagogue', 'temple', 'monastery', 'castle', 'palace', 'tower', 'bell_tower', 'religious']);

/** Pick a facade style from height, construction year and building type. */
export function chooseStyle(tags: Tags, height: number, rng: Rng): FacadeStyle {
  const year = yearOf(tags);
  // Parts carry their building's type in parent:building (see hideOutlinesWithParts).
  const type = tags.building && tags.building !== 'yes' ? tags.building : (tags['parent:building'] ?? tags.building ?? '');
  if (type === 'warehouse' || type === 'industrial') return warehouse(rng);
  // Churches, castles and anything historic or old: masonry, never glass.
  if (MASONRY.has(type) || tags.amenity === 'place_of_worship' || tags.historic || (year !== undefined && year < 1900))
    return year !== undefined && year >= 1920 && year <= 1945 ? artDeco(rng) : victorian(rng);
  if (height >= 60) return glassTower(rng, year !== undefined ? year >= 1955 && year < 1985 : rng() < 0.2);
  if (year !== undefined && year >= 1920 && year <= 1945) return artDeco(rng);
  if (year !== undefined && year >= 1955) return glassTower(rng, year < 1985);
  if (height <= 28) return victorian(rng);
  return rng() < 0.3 ? artDeco(rng) : glassTower(rng, true);
}
