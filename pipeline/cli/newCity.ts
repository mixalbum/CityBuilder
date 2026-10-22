// Create a city profile without downloading or building anything, so it can
// be tuned first (extent, street widths, landmarks):
//
//   npm run new-city -- "Wellington, New Zealand"
//   npm run new-city -- "Barcelona Eixample" --size 1800
//   npm run new-city -- --center 35.6595,139.7005 --name "Shibuya" --size 1200

import { parseArgs } from 'node:util';
import { createProfile } from '../city/geocode';
import { isMain } from '../util/isMain';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      size: { type: 'string' },
      width: { type: 'string' },
      depth: { type: 'string' },
      center: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
    },
  });
  const query = positionals.join(' ').trim();
  if (!query && !values.center) {
    console.error('Usage: npm run new-city -- "<place name>" [--size <m>] [--center lat,lon] [--name <text>] [--slug <id>]');
    process.exit(1);
  }
  const num = (v?: string) => (v === undefined ? undefined : Number(v));
  const center = values.center ? (([lat, lon]) => ({ lat, lon }))(values.center.split(',').map(Number)) : undefined;
  const p = await createProfile({
    query: query || undefined,
    center,
    width: num(values.width) ?? num(values.size),
    depth: num(values.depth) ?? num(values.size),
    name: values.name,
    slug: values.slug,
  });
  console.log(`Edit cities/${p.slug}/city.json if you like, then: npm run city -- ${p.slug}`);
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
