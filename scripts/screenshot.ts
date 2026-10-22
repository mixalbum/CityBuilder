// Capture viewer screenshots of a city from fixed cameras, for READMEs and for
// checking a build by eye. Every city gets a standard set of views (overview,
// centre, dusk, night, a diorama, and one per landmark); a profile's "views"
// add or replace views by name (e.g. a walk along a known street).
//
//   npm run dev                                         # in another terminal
//   npm run screenshots -- <city>                       # all views → screenshots/<city>/
//   npm run screenshots -- <city> --views overview,diorama
//   npm run screenshots -- <city> --out docs/screenshots/<city> --url http://localhost:5173/
//
// Uses Playwright's Chromium (npx playwright install chromium) or CHROMIUM_PATH.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import type { ViewDef } from '../pipeline/city/profile';
import type { WorldManifest } from '../src/world/chunkFormat';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    out: { type: 'string' },
    views: { type: 'string' },
    width: { type: 'string', default: '1400' },
    height: { type: 'string', default: '900' },
  },
});
const slug = positionals[0];
if (!slug) {
  console.error('Usage: npm run screenshots -- <city> [--views a,b] [--out dir] [--url http://localhost:5173/]');
  process.exit(1);
}
const outDir = values.out ?? join('screenshots', slug);
const only = values.views?.split(',');

const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Standard views scaled to the city's size, plus one per landmark. */
function standardViews(m: WorldManifest): ViewDef[] {
  const span = Math.max(m.size[0], m.size[2]);
  const far = span * 0.42;
  const views: ViewDef[] = [
    { name: 'overview', target: 'origin', offset: [far * 0.8, far * 0.8, far] },
    { name: 'centre', target: 'origin', offset: [160, 110, 200] },
    { name: 'dusk', target: 'origin', offset: [far * 0.45, far * 0.27, far * 0.56], time: 18.3 },
    { name: 'night', target: 'origin', offset: [far * 0.45, far * 0.27, far * 0.56], time: 21.5 },
    { name: 'diorama', target: 'origin', offset: [1, 1, 1], mode: 'diorama', zoom: Math.min(2, 1400 / span) },
  ];
  for (const l of m.landmarks) {
    const d = Math.max(60, l.height * 1.4);
    views.push({ name: `lm-${kebab(l.name)}`, landmark: l.name, offset: [d * 0.7, d * 0.45, d * 0.8], lift: 0.4 });
  }
  return views;
}

async function main(): Promise<void> {
  const base = values.url!.endsWith('/') ? values.url! : `${values.url}/`;
  const res = await fetch(`${base}cities/${slug}/manifest.json`).catch(() => undefined);
  if (!res?.ok || !res.headers.get('content-type')?.includes('json'))
    throw new Error(`No built city "${slug}" at ${base}. Start the viewer (npm run dev) and build the city (npm run city -- ${slug}).`);
  const manifest = (await res.json()) as WorldManifest;

  // The profile's own views replace standard ones of the same name.
  const profilePath = join('cities', slug, 'city.json');
  const custom: ViewDef[] = existsSync(profilePath) ? ((JSON.parse(readFileSync(profilePath, 'utf8')) as { views?: ViewDef[] }).views ?? []) : [];
  const byName = new Map<string, ViewDef>();
  for (const v of [...standardViews(manifest), ...custom]) byName.set(v.name, v);
  const views = [...byName.values()].filter((v) => !only || only.includes(v.name));
  if (!views.length) throw new Error(`No views match. Available: ${[...byName.keys()].join(', ')}`);

  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: Number(values.width), height: Number(values.height) } });
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`${base}?city=${encodeURIComponent(slug)}`);
  await page.waitForFunction(() => !document.querySelector('.hud .progress')?.textContent, null, { timeout: 900_000, polling: 1000 });

  for (const v of views) {
    const ok = await page.evaluate((v) => {
      const w = window as any;
      const m = w.manifest;
      let tx: number, ty: number, tz: number;
      w.getTrams?.() && (w.getTrams().speed = 0);
      if (v.tramNear && w.getTrams?.()?.count) {
        const t = w.getTrams();
        const [nx, nz] = [m.originVoxel[0] + v.tramNear[0], m.originVoxel[1] + v.tramNear[1]];
        let best = 0, bestD = Infinity;
        for (let i = 0; i < t.count; i++) {
          const p = t.positionOf(i);
          const d = Math.hypot(p.x - nx, p.z - nz);
          if (d < bestD) [best, bestD] = [i, d];
        }
        const p = t.positionOf(best);
        [tx, ty, tz] = [p.x, p.y + 2, p.z];
      } else if (v.landmark) {
        const l = m.landmarks.find((x: any) => x.name === v.landmark);
        if (!l) return false;
        [tx, ty, tz] = [l.x, (l.ground ?? m.groundY) + l.height * (v.lift ?? 0.4), l.z];
      } else {
        [tx, ty, tz] = [m.originVoxel[0], (m.originGround ?? m.groundY) + 2, m.originVoxel[1]];
      }
      if (v.shift) [tx, ty, tz] = [tx + v.shift[0], ty + v.shift[1], tz + v.shift[2]];
      w.controls.setMode('orbit');
      w.controls.target.set(tx, ty, tz);
      w.city.camera.position.set(tx + v.offset[0], ty + v.offset[1], tz + v.offset[2]);
      w.controls.update(0);
      w.setTime?.(v.time ?? 16.5);
      if (v.mode) {
        w.controls.setMode(v.mode);
        if (v.zoom) (w.city.ortho.zoom = v.zoom), w.city.ortho.updateProjectionMatrix();
        const keys: string[] = v.keys ?? [];
        for (const code of keys) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        for (let t = 0; t < (v.seconds ?? 0); t += 0.05) w.controls.update(0.05);
        for (const code of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
        w.controls.update(0);
      }
      return true;
    }, v);
    if (!ok) {
      console.warn(`Skipped ${v.name}: no landmark "${v.landmark}" in this build`);
      continue;
    }
    // Let the loader build full detail around the new view, then wait for two
    // fresh frames: software-rendered GPUs can take seconds per frame.
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await page.waitForFunction('window.loader.idle()', null, { timeout: 600_000, polling: 500 });
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await page.screenshot({ path: join(outDir, `${v.name}.jpg`), type: 'jpeg', quality: 85, timeout: 180_000 });
    console.log(`Saved ${join(outDir, v.name)}.jpg`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
