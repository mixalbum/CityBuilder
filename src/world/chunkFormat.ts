// Chunk layout, RLE codec and region file format shared by the pipeline
// (writer) and the viewer (reader).

export const CHUNK = 32;
export const CHUNK_VOL = CHUNK * CHUNK * CHUNK;
/** Regions group REGION x REGION chunk columns into one file. */
export const REGION = 4;

/** Index of a voxel inside a chunk: x fastest, then z, then y. */
export const voxelIndex = (x: number, y: number, z: number): number => x | (z << 5) | (y << 10);

/** Run-length encode as (runLength - 1, value) byte pairs; runs cap at 256. */
export function rleEncode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length * 2);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (run < 256 && i + run < data.length && data[i + run] === v) run++;
    out[o++] = run - 1;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

export function rleDecode(src: Uint8Array, out: Uint8Array): void {
  let o = 0;
  for (let i = 0; i < src.length; i += 2) {
    const run = src[i] + 1;
    out.fill(src[i + 1], o, o + run);
    o += run;
  }
  if (o !== out.length) throw new Error(`RLE decoded ${o} voxels, expected ${out.length}`);
}

export interface RegionChunk {
  cx: number;
  cy: number;
  cz: number;
  rle: Uint8Array;
}

const MAGIC = 0x31525856; // "VXR1" little-endian

/** Region file: magic u32, count u32, then per chunk cx/cy/cz u16 + length u32 + RLE bytes. */
export function writeRegion(chunks: RegionChunk[]): Uint8Array {
  const total = 8 + chunks.reduce((n, c) => n + 10 + c.rle.length, 0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, chunks.length, true);
  let o = 8;
  for (const c of chunks) {
    view.setUint16(o, c.cx, true);
    view.setUint16(o + 2, c.cy, true);
    view.setUint16(o + 4, c.cz, true);
    view.setUint32(o + 6, c.rle.length, true);
    buf.set(c.rle, o + 10);
    o += 10 + c.rle.length;
  }
  return buf;
}

export function readRegion(buf: ArrayBuffer): RegionChunk[] {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a VXR1 region file');
  const count = view.getUint32(4, true);
  const chunks: RegionChunk[] = [];
  let o = 8;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(o + 6, true);
    chunks.push({
      cx: view.getUint16(o, true),
      cy: view.getUint16(o + 2, true),
      cz: view.getUint16(o + 4, true),
      rle: new Uint8Array(buf, o + 10, len),
    });
    o += 10 + len;
  }
  return chunks;
}

export interface ManifestRegion {
  rx: number;
  rz: number;
  file: string;
  chunks: number;
  bytes: number;
}

export interface Landmark {
  name: string;
  /** Voxel coordinates of the footprint centre at ground level. */
  x: number;
  z: number;
  /** Voxel layer of the ground the landmark stands on. */
  ground: number;
  /** Height in voxels above that ground. */
  height: number;
}

/** An entry in public/cities/index.json: the cities built so far. */
export interface CityIndexEntry {
  slug: string;
  name: string;
  builtAt: string;
}

export interface WorldManifest {
  version: 1;
  /** Which city this is; its origin's latitude drives the sun's path. */
  city?: { slug: string; name: string; lat: number; lon: number };
  chunkSize: number;
  regionSize: number;
  /** World size in voxels [x, y, z]. y is up. */
  size: [number, number, number];
  groundY: number;
  /** Voxel coordinates of the city's origin (the centre of its profile). */
  originVoxel: [number, number];
  /** Ground layer at the origin (terrain makes it differ from groundY). */
  originGround: number;
  gridAngleDeg: number;
  source: 'osm' | 'synthetic';
  generatedAt: string;
  attribution: string;
  landmarks: Landmark[];
  /** Tram routes file ({ lines: [x, y, z, ...][] }), relative to the manifest. */
  trams?: string;
  regions: ManifestRegion[];
}
