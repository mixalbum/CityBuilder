// Minimal PNG decoder for 8-bit RGB/RGBA images (enough for elevation tiles),
// so the pipeline needs no native image libraries.

import { inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  channels: number;
  data: Uint8Array;
}

export function decodePng(buf: Uint8Array): Image {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('Not a PNG file');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o < buf.length; ) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...buf.subarray(o + 4, o + 8));
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(o + 8);
      height = view.getUint32(o + 12);
      [depth, colour] = [body[8], body[9]];
      interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const channels = colour === 2 ? 3 : colour === 6 ? 4 : 0;
  if (depth !== 8 || !channels || interlace) throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  return { width, height, channels, data };
}
