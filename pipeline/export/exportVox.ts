// Export part of a built city (public/cities/<slug>) as a MagicaVoxel .vox file.
//
//   npm run export:vox -- melbourne --landmark "Flinders Street Station"   # 240 m square around it
//   npm run export:vox -- melbourne --landmark "Eureka Tower" --radius 60
//   npm run export:vox -- melbourne --bbox 1200,900,1500,1100              # voxel x0,z0,x1,z1
//   npm run export:vox -- melbourne --centre                               # 240 m around the city's origin
//   npm run export:vox -- melbourne --all                                  # the whole city (very large)
//   npm run export:vox -- melbourne --landmark "St Paul's Cathedral" --solid   # keep hidden interior voxels

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { CHUNK, CHUNK_VOL, readRegion, rleDecode, voxelIndex, type WorldManifest } from '../../src/world/chunkFormat';
import { exportVox, VOX_WORLD_MAX, type Box, type VoxelSource } from '../../src/world/vox';
import { isMain } from '../util/isMain';

/** Lazily decoded chunks from the baked region files. */
export class BakedWorld implements VoxelSource {
  readonly manifest: WorldManifest;
  private readonly rle = new Map<string, Uint8Array>();
  private readonly decoded = new Map<string, Uint8Array>();

  constructor(dir: string) {
    this.manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as WorldManifest;
    for (const r of this.manifest.regions) {
      const buf = readFileSync(join(dir, r.file));
      for (const c of readRegion(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer))
        this.rle.set(`${c.cx},${c.cy},${c.cz}`, c.rle);
    }
  }

  get(x: number, y: number, z: number): number {
    const [sx, sy, sz] = this.manifest.size;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    const k = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = this.decoded.get(k);
    if (!c) {
      const rle = this.rle.get(k);
      if (!rle) return 0;
      c = new Uint8Array(CHUNK_VOL);
      rleDecode(rle, c);
      this.decoded.set(k, c);
    }
    return c[voxelIndex(x & 31, y & 31, z & 31)];
  }

  /** Highest non-empty layer in the box, so exports aren't padded with sky. */
  topIn(box: Omit<Box, 'y0' | 'y1'>): number {
    let top = 0;
    for (const k of this.rle.keys()) {
      const [cx, cy, cz] = k.split(',').map(Number);
      if ((cx + 1) * CHUNK <= box.x0 || cx * CHUNK >= box.x1 || (cz + 1) * CHUNK <= box.z0 || cz * CHUNK >= box.z1) continue;
      top = Math.max(top, (cy + 1) * CHUNK);
    }
    return Math.min(top, this.manifest.size[1]);
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      world: { type: 'string' },
      centre: { type: 'boolean', default: false },
      landmark: { type: 'string' },
      radius: { type: 'string', default: '120' },
      bbox: { type: 'string' },
      all: { type: 'boolean', default: false },
      solid: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  const city = positionals[0];
  if (!city && !values.world) throw new Error('Usage: npm run export:vox -- <city> --landmark <name> | --centre | --bbox x0,z0,x1,z1 | --all');
  const world = new BakedWorld(values.world ?? join('public', 'cities', city));
  const [sx, , sz] = world.manifest.size;

  let area: { x0: number; z0: number; x1: number; z1: number };
  let name: string;
  if (values.landmark) {
    const l = world.manifest.landmarks.find((m) => m.name.toLowerCase() === values.landmark!.toLowerCase());
    if (!l) throw new Error(`Unknown landmark "${values.landmark}". Known: ${world.manifest.landmarks.map((m) => m.name).join(', ')}`);
    const r = parseInt(values.radius!, 10);
    area = { x0: l.x - r, z0: l.z - r, x1: l.x + r, z1: l.z + r };
    name = slug(l.name);
  } else if (values.bbox) {
    const [x0, z0, x1, z1] = values.bbox.split(',').map(Number);
    area = { x0, z0, x1, z1 };
    name = `bbox-${x0}-${z0}-${x1}-${z1}`;
  } else if (values.centre) {
    const [ox, oz] = world.manifest.originVoxel;
    const r = parseInt(values.radius!, 10);
    area = { x0: ox - r, z0: oz - r, x1: ox + r, z1: oz + r };
    name = `${world.manifest.city?.slug ?? 'city'}-centre`;
  } else if (values.all) {
    area = { x0: 0, z0: 0, x1: sx, z1: sz };
    name = world.manifest.city?.slug ?? 'city';
  } else throw new Error('Choose an area: --landmark <name>, --centre, --bbox x0,z0,x1,z1 or --all');

  // Clamp to the world and to MagicaVoxel's world size.
  area = { x0: Math.max(0, area.x0), z0: Math.max(0, area.z0), x1: Math.min(sx, area.x1), z1: Math.min(sz, area.z1) };
  if (area.x1 - area.x0 > VOX_WORLD_MAX || area.z1 - area.z0 > VOX_WORLD_MAX) {
    console.warn(`Area exceeds MagicaVoxel's ${VOX_WORLD_MAX}-voxel world; trimming to the central ${VOX_WORLD_MAX}.`);
    const trim = (a: number, b: number) => {
      const c = Math.floor((a + b) / 2);
      return b - a > VOX_WORLD_MAX ? [c - VOX_WORLD_MAX / 2, c + VOX_WORLD_MAX / 2] : [a, b];
    };
    [area.x0, area.x1] = trim(area.x0, area.x1);
    [area.z0, area.z1] = trim(area.z0, area.z1);
  }
  const box: Box = { ...area, y0: 0, y1: world.topIn(area) };

  const t0 = performance.now();
  const { bytes, stats } = exportVox(world, box, { hollow: !values.solid });
  const out = values.out ?? join('exports', `${name}.vox`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(
    `Wrote ${out}: ${box.x1 - box.x0}×${box.z1 - box.z0}×${box.y1} voxels area, ${stats.models} models, ` +
      `${stats.voxels.toLocaleString()} voxels (${stats.dropped.toLocaleString()} hidden ones dropped), ` +
      `${(stats.bytes / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}
