// MagicaVoxel .vox export (file version 150). Pure TypeScript so the pipeline
// CLI and the browser viewer share it.
//
// Coordinates: the world is y-up with z running south; MagicaVoxel is z-up.
// Exports map world (x, y, z) to vox (x, north, y) so east stays +x and north
// is +y. Areas larger than a 256³ model are split into tiles, placed by a
// scene graph (nTRN/nGRP/nSHP) and centred on the export area.

import { M, PALETTE_SRGB, TRANSPARENT } from './palette';

/** MagicaVoxel's maximum model size per axis. */
export const VOX_MODEL_MAX = 256;
/** MagicaVoxel's world is limited to about ±1024 voxels per axis. */
export const VOX_WORLD_MAX = 2048;

export interface VoxelSource {
  get(x: number, y: number, z: number): number;
}

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  /** Exclusive upper bounds. */
  x1: number;
  y1: number;
  z1: number;
}

export interface VoxModel {
  /** Size in vox axes (x, y, z-up). */
  size: [number, number, number];
  /** Model centre in vox world coordinates, for its transform node. */
  translation: [number, number, number];
  /** Packed (x, y, z, colourIndex) quadruples in model space. */
  voxels: Uint8Array;
}

export interface ExportOptions {
  /** Drop voxels hidden on all six sides by opaque neighbours (default true). */
  hollow?: boolean;
}

export interface ExportStats {
  models: number;
  voxels: number;
  dropped: number;
  bytes: number;
}

const OPAQUE = new Uint8Array(256).map((_, m) => (m !== 0 && !TRANSPARENT.has(m) ? 1 : 0));

/** Collect the box's voxels into ≤256³ vox models. */
export function collectModels(src: VoxelSource, box: Box, opts: ExportOptions = {}): { models: VoxModel[]; dropped: number } {
  const hollow = opts.hollow ?? true;
  const W = box.x1 - box.x0, H = box.y1 - box.y0, D = box.z1 - box.z0;
  if (W <= 0 || H <= 0 || D <= 0) throw new Error('Empty export box');
  if (Math.max(W, D, H) > VOX_WORLD_MAX) throw new Error(`Export box exceeds MagicaVoxel's ${VOX_WORLD_MAX}-voxel world limit`);

  const models: VoxModel[] = [];
  let dropped = 0;
  const hidden = (x: number, y: number, z: number) =>
    OPAQUE[src.get(x + 1, y, z)] && OPAQUE[src.get(x - 1, y, z)] &&
    OPAQUE[src.get(x, y + 1, z)] && OPAQUE[src.get(x, y - 1, z)] &&
    OPAQUE[src.get(x, y, z + 1)] && OPAQUE[src.get(x, y, z - 1)];

  // Tiles in vox axes: vx = world x, vy = north (reversed world z), vz = world y.
  for (let tz = 0; tz < H; tz += VOX_MODEL_MAX)
    for (let ty = 0; ty < D; ty += VOX_MODEL_MAX)
      for (let tx = 0; tx < W; tx += VOX_MODEL_MAX) {
        const sx = Math.min(VOX_MODEL_MAX, W - tx), sy = Math.min(VOX_MODEL_MAX, D - ty), sz = Math.min(VOX_MODEL_MAX, H - tz);
        const out: number[] = [];
        for (let vz = 0; vz < sz; vz++)
          for (let vy = 0; vy < sy; vy++)
            for (let vx = 0; vx < sx; vx++) {
              const x = box.x0 + tx + vx;
              const y = box.y0 + tz + vz;
              const z = box.z1 - 1 - (ty + vy);
              const m = src.get(x, y, z);
              if (!m) continue;
              if (hollow && OPAQUE[m] && hidden(x, y, z)) {
                dropped++;
                continue;
              }
              out.push(vx, vy, vz, m);
            }
        if (!out.length) continue;
        models.push({
          size: [sx, sy, sz],
          // Centre the whole export on the vox origin.
          translation: [tx + Math.floor(sx / 2) - Math.floor(W / 2), ty + Math.floor(sy / 2) - Math.floor(D / 2), tz + Math.floor(sz / 2)],
          voxels: Uint8Array.from(out),
        });
      }
  return { models, dropped };
}

/** Growable little-endian byte buffer. */
class Bytes {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.length + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  ascii(s: string) {
    this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.i32(b.length);
    this.bytes(b);
  }
  dict(d: Record<string, string>) {
    const entries = Object.entries(d);
    this.i32(entries.length);
    for (const [k, v] of entries) {
      this.str(k);
      this.str(v);
    }
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}

/** One chunk with no children: id, content size, children size 0, content. */
function chunk(id: string, write: (b: Bytes) => void): Uint8Array {
  const content = new Bytes();
  write(content);
  const out = new Bytes();
  out.ascii(id);
  out.i32(content.length);
  out.i32(0);
  out.bytes(content.result());
  return out.result();
}

/** Serialise models as a .vox file with the city palette and glass material. */
export function writeVox(models: VoxModel[]): Uint8Array {
  const children: Uint8Array[] = [];
  for (const m of models) {
    children.push(chunk('SIZE', (b) => m.size.forEach((v) => b.i32(v))));
    children.push(
      chunk('XYZI', (b) => {
        b.i32(m.voxels.length / 4);
        b.bytes(m.voxels);
      }),
    );
  }

  // Scene graph: root transform → group → (transform → shape) per model.
  children.push(chunk('nTRN', (b) => { b.i32(0); b.dict({}); b.i32(1); b.i32(-1); b.i32(-1); b.i32(1); b.dict({}); }));
  const firstChild = 2;
  children.push(
    chunk('nGRP', (b) => {
      b.i32(1);
      b.dict({});
      b.i32(models.length);
      models.forEach((_, i) => b.i32(firstChild + i * 2));
    }),
  );
  models.forEach((m, i) => {
    const trn = firstChild + i * 2;
    children.push(chunk('nTRN', (b) => { b.i32(trn); b.dict({}); b.i32(trn + 1); b.i32(-1); b.i32(0); b.i32(1); b.dict({ _t: m.translation.join(' ') }); }));
    children.push(chunk('nSHP', (b) => { b.i32(trn + 1); b.dict({}); b.i32(1); b.i32(i); b.dict({}); }));
  });

  // Palette: colour index i (1–255) is RGBA entry i - 1; our material ids are the indices.
  children.push(
    chunk('RGBA', (b) => {
      const rgba = new Uint8Array(256 * 4);
      for (let i = 1; i < 256; i++) {
        const hex = PALETTE_SRGB[i] ?? 0x808080;
        rgba.set([(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255], (i - 1) * 4);
      }
      b.bytes(rgba);
    }),
  );
  for (const m of TRANSPARENT)
    children.push(chunk('MATL', (b) => { b.i32(m); b.dict({ _type: '_glass', _trans: '0.6', _rough: '0.1', _ior: '0.5' }); }));
  // Warm emissive lamps and clock faces for MagicaVoxel's renderer.
  children.push(chunk('MATL', (b) => { b.i32(M.CLOCK_FACE); b.dict({ _type: '_emit', _emit: '0.4', _flux: '1' }); }));

  const out = new Bytes();
  out.ascii('VOX ');
  out.i32(150);
  out.ascii('MAIN');
  out.i32(0);
  out.i32(children.reduce((n, c) => n + c.length, 0));
  for (const c of children) out.bytes(c);
  return out.result();
}

/** Export a world box as .vox bytes. */
export function exportVox(src: VoxelSource, box: Box, opts: ExportOptions = {}): { bytes: Uint8Array; stats: ExportStats } {
  const { models, dropped } = collectModels(src, box, opts);
  const bytes = writeVox(models);
  const voxels = models.reduce((n, m) => n + m.voxels.length / 4, 0);
  return { bytes, stats: { models: models.length, voxels, dropped, bytes: bytes.length } };
}

/** Minimal reader for tests and tooling: models, palette and scene translations. */
export function readVox(data: Uint8Array): {
  version: number;
  models: { size: [number, number, number]; voxels: Uint8Array }[];
  palette: Uint8Array | undefined;
  translations: string[];
  materials: Map<number, Record<string, string>>;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const id = (o: number) => String.fromCharCode(...data.subarray(o, o + 4));
  if (id(0) !== 'VOX ') throw new Error('Not a .vox file');
  const models: { size: [number, number, number]; voxels: Uint8Array }[] = [];
  const translations: string[] = [];
  const materials = new Map<number, Record<string, string>>();
  let palette: Uint8Array | undefined;
  let size: [number, number, number] = [0, 0, 0];
  const readDict = (o: number): [Record<string, string>, number] => {
    const d: Record<string, string> = {};
    const n = view.getInt32(o, true);
    o += 4;
    for (let i = 0; i < n; i++) {
      const kl = view.getInt32(o, true);
      const k = new TextDecoder().decode(data.subarray(o + 4, o + 4 + kl));
      o += 4 + kl;
      const vl = view.getInt32(o, true);
      d[k] = new TextDecoder().decode(data.subarray(o + 4, o + 4 + vl));
      o += 4 + vl;
    }
    return [d, o];
  };
  let o = 8 + 12; // header, then MAIN's header
  while (o < data.length) {
    const cid = id(o), n = view.getInt32(o + 4, true), m = view.getInt32(o + 8, true);
    const c = o + 12;
    if (cid === 'SIZE') size = [view.getInt32(c, true), view.getInt32(c + 4, true), view.getInt32(c + 8, true)];
    else if (cid === 'XYZI') models.push({ size, voxels: data.slice(c + 4, c + 4 + view.getInt32(c, true) * 4) });
    else if (cid === 'RGBA') palette = data.slice(c, c + 1024);
    else if (cid === 'MATL') materials.set(view.getInt32(c, true), readDict(c + 4)[0]);
    else if (cid === 'nTRN') {
      const frameAt = readDict(c + 4)[1] + 16; // skip child, reserved, layer and frame count
      const [frame] = readDict(frameAt);
      if (frame._t) translations.push(frame._t);
    }
    o = c + n + m;
  }
  return { version: view.getInt32(4, true), models, palette, translations, materials };
}
