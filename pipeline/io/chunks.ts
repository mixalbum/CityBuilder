import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHUNK,
  REGION,
  rleEncode,
  writeRegion,
  type ManifestRegion,
  type RegionChunk,
  type WorldManifest,
} from '../../src/world/chunkFormat';
import type { VoxelWorld } from '../voxel/world';

/** Write the world as RLE chunks grouped into region files, plus manifest.json. */
export function writeWorld(
  world: VoxelWorld,
  outDir: string,
  meta: Omit<WorldManifest, 'version' | 'chunkSize' | 'regionSize' | 'size' | 'regions'>,
): WorldManifest {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^r_\d+_\d+\.bin$/.test(f)) rmSync(join(outDir, f));

  const byRegion = new Map<string, RegionChunk[]>();
  let top = 0;
  for (const { cx, cy, cz, data } of world.entries()) {
    top = Math.max(top, (cy + 1) * CHUNK);
    const k = `${Math.floor(cx / REGION)}_${Math.floor(cz / REGION)}`;
    if (!byRegion.has(k)) byRegion.set(k, []);
    byRegion.get(k)!.push({ cx, cy, cz, rle: rleEncode(data) });
  }

  const regions: ManifestRegion[] = [];
  for (const [k, chunks] of [...byRegion].sort(([a], [b]) => a.localeCompare(b))) {
    chunks.sort((a, b) => a.cy - b.cy || a.cz - b.cz || a.cx - b.cx);
    const bytes = writeRegion(chunks);
    const file = `r_${k}.bin`;
    writeFileSync(join(outDir, file), bytes);
    const [rx, rz] = k.split('_').map(Number);
    regions.push({ rx, rz, file, chunks: chunks.length, bytes: bytes.length });
  }

  const manifest: WorldManifest = {
    version: 1,
    chunkSize: CHUNK,
    regionSize: REGION,
    // The world is built tall and sparse; record the height actually used.
    size: [world.sizeX, Math.min(world.sizeY, top), world.sizeZ],
    regions,
    ...meta,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}
