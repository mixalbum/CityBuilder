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

/** Pick a facade style from height, construction year and building type. */
export function chooseStyle(tags: Tags, height: number, rng: Rng): FacadeStyle {
  const year = yearOf(tags);
  const type = tags.building ?? '';
  if (type === 'warehouse' || type === 'industrial') return warehouse(rng);
  if (height >= 60) return glassTower(rng, year !== undefined ? year >= 1955 && year < 1985 : rng() < 0.2);
  if (year !== undefined && year >= 1920 && year <= 1945) return artDeco(rng);
  if (year !== undefined && year >= 1955) return glassTower(rng, year < 1985);
  if (height <= 28) return victorian(rng);
  return rng() < 0.3 ? artDeco(rng) : glassTower(rng, true);
}
