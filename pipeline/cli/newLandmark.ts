// Start a hand-made landmark model for a city:
//
//   npm run new-landmark -- wellington "Old St Paul's"
//   npm run new-landmark -- wellington "Beehive" --id beehive
//
// Finds the building by its OSM name in the city's downloaded map data,
// writes cities/<city>/landmarks/<id>.ts from a template that already claims
// that building, registers it in the city's landmarks/index.ts and adds it
// to the viewer's jump list in city.json. Rebuild to see it, then edit the
// model (see docs/LANDMARKS.md).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { osmPath } from '../build';
import { cityDir, loadProfile } from '../city/profile';
import { estimateGridAngle, Projector } from '../geo/project';
import { osmLines } from '../model/features';
import type { OsmData } from '../model/osm';
import { isMain } from '../util/isMain';

const camel = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
    .replace(/^(\d)/, '_$1');

function template(id: string, name: string, where: string): string {
  const q = JSON.stringify(name).slice(1, -1).replace(/'/g, "\\'");
  return `// ${name}: describe it here (date, architect, style, materials).
// Started with \`npm run new-landmark\`; see docs/LANDMARKS.md for the kit.
// ${where}

import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const ${id}: LandmarkModel = {
  name: '${q}',
  // The building(s) this model takes over: by OSM name. Alternatives:
  // structureAt: [gridX, gridN] (a point inside it) or rect: [x0, x1, n0, n1] in grid metres.
  select: { names: ['${q}'] },

  // A facade for the claimed footprint. Delete this to keep the generic style.
  style: () => classical({ name: '${id}', wall: M.SANDSTONE, trim: M.RENDER_CREAM, base: M.BLUESTONE, baseHeight: 4, bay: 4, storey: 4 }),

  // Remove some of the footprint for build() to replace, e.g. everything above 40 m:
  // drop: (t) => t.minH >= 40,

  build(k, site) {
    if (Number.isNaN(site.x0)) return; // not found in this build
    const cx = Math.round((site.x0 + site.x1) / 2);
    const cz = Math.round((site.z0 + site.z1) / 2);
    const top = Math.max(...site.tiers.map((t) => t.y1)); // highest layer of the claimed building

    // Ideas (k.y(m) is the layer m metres above the landmark's base):
    // k.dome(cx, cz, top + 1, 8, 10, M.COPPER_GREEN);                      // dome, radius 8, 10 high
    // k.spire(cx, cz, top + 1, top + 30, 4, M.ROOF_SLATE);                 // spire 30 m tall
    // k.clockFaces(cx, cz, k.y(20), 3);                                    // clocks on a 7-wide tower
    // k.columns('x', site.z1 + 2, site.x0, site.x1, 4, k.base, k.y(10), 1, M.SANDSTONE); // portico
    // k.gable(site.x0, site.z0, site.x1, site.z1, top + 1, 'x', M.ROOF_TERRACOTTA);       // pitched roof
    void cx;
    void cz;
    void top;
  },
};
`;
}

function main(): void {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { id: { type: 'string' } } });
  const [slug, ...rest] = positionals;
  const query = rest.join(' ').trim();
  if (!slug || !query) {
    console.error('Usage: npm run new-landmark -- <city> "<building name>" [--id camelCaseId]');
    process.exit(1);
  }
  const profile = loadProfile(slug);
  const path = osmPath(slug);
  if (!existsSync(path)) throw new Error(`No map data for ${slug} yet: run npm run city -- ${slug} first.`);
  const osm = JSON.parse(readFileSync(path, 'utf8')) as OsmData;

  // Buildings whose name matches exactly, else contains the query.
  const named = osm.elements.filter((e) => e.type !== 'node' && (e.tags?.building || e.tags?.['building:part']) && e.tags?.name);
  const q = query.toLowerCase();
  let hits = named.filter((e) => e.tags!.name!.toLowerCase() === q);
  if (!hits.length) hits = named.filter((e) => e.tags!.name!.toLowerCase().includes(q));
  const names = [...new Set(hits.map((e) => e.tags!.name!))];
  if (!names.length) {
    console.error(`No building named like "${query}" in ${slug}'s map data. Check the name on openstreetmap.org.`);
    process.exit(1);
  }
  if (names.length > 1) {
    console.error(`Several buildings match "${query}":\n  ${names.slice(0, 20).join('\n  ')}\nUse the exact name.`);
    process.exit(1);
  }
  const name = names[0];

  // Where it is, in the grid metres select.structureAt / rect use.
  const pts = hits.flatMap((e) => (e.type === 'way' ? e.geometry : e.type === 'relation' ? e.members.flatMap((m) => m.geometry ?? []) : []));
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const angle = profile.gridAngleDeg ?? estimateGridAngle(osmLines(osm), new Projector(profile.origin, 0), profile.gridStreets) ?? 0;
  const [gx, gn] = new Projector(profile.origin, angle).toGrid(lat, lon);
  const where = `Footprint centre: ${lat.toFixed(6)}, ${lon.toFixed(6)} (grid ${gx.toFixed(0)}, ${gn.toFixed(0)} m from the origin).`;

  const id = values.id ?? camel(name);
  const dir = join(cityDir(slug), 'landmarks');
  const file = join(dir, `${id}.ts`);
  if (existsSync(file)) throw new Error(`${file} already exists`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, template(id, name, where));

  // Register the model.
  const indexPath = join(dir, 'index.ts');
  let index = existsSync(indexPath)
    ? readFileSync(indexPath, 'utf8')
    : `// ${profile.name}'s hand-made landmark models (see docs/LANDMARKS.md).\n\nimport type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';\n\nexport const models: LandmarkModel[] = [\n];\n`;
  index = index.replace(/(import type \{ LandmarkModel \}[^\n]*\n)/, `$1import { ${id} } from './${id}';\n`);
  index = index.replace(/(export const models: LandmarkModel\[\] = \[\n?)([\s\S]*?)(\];)/, (_, open: string, body: string, close: string) => `${open}${body}${body && !body.endsWith('\n') ? '\n' : ''}  ${id},\n${close}`);
  writeFileSync(indexPath, index);

  // Add it to the jump list.
  const profilePath = join(cityDir(slug), 'city.json');
  const raw = JSON.parse(readFileSync(profilePath, 'utf8')) as { landmarks?: { name: string }[] };
  if (!(raw.landmarks ?? []).some((l) => l.name === name)) {
    raw.landmarks = [...(raw.landmarks ?? []), { name }];
    writeFileSync(profilePath, JSON.stringify(raw, null, 2) + '\n');
  }
  console.log(`Created ${file} for "${name}".\n${where}\nRebuild with: npm run build:world -- ${slug}`);
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
