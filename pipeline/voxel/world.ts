import { CHUNK, CHUNK_VOL, voxelIndex } from '../../src/world/chunkFormat';

/** Sparse voxel store: 32³ chunks of palette indices, created on first write. */
export class VoxelWorld {
  readonly chunks = new Map<number, Uint8Array>();
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunksZ: number;

  constructor(
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
  ) {
    this.chunksX = Math.ceil(sizeX / CHUNK);
    this.chunksY = Math.ceil(sizeY / CHUNK);
    this.chunksZ = Math.ceil(sizeZ / CHUNK);
  }

  private key(cx: number, cy: number, cz: number): number {
    return (cy * this.chunksZ + cz) * this.chunksX + cx;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    const c = this.chunks.get(this.key(x >> 5, y >> 5, z >> 5));
    return c ? c[voxelIndex(x & 31, y & 31, z & 31)] : 0;
  }

  set(x: number, y: number, z: number, m: number): void {
    if (!this.inBounds(x, y, z)) return;
    const k = this.key(x >> 5, y >> 5, z >> 5);
    let c = this.chunks.get(k);
    if (!c) {
      if (m === 0) return;
      c = new Uint8Array(CHUNK_VOL);
      this.chunks.set(k, c);
    }
    c[voxelIndex(x & 31, y & 31, z & 31)] = m;
  }

  /** Set only where the voxel is currently air. */
  setIfAir(x: number, y: number, z: number, m: number): void {
    if (this.get(x, y, z) === 0) this.set(x, y, z, m);
  }

  fillColumn(x: number, z: number, y0: number, y1: number, m: number): void {
    for (let y = y0; y <= y1; y++) this.set(x, y, z, m);
  }

  fillBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, m);
  }

  /** Non-empty chunks with their chunk coordinates. */
  *entries(): Generator<{ cx: number; cy: number; cz: number; data: Uint8Array }> {
    for (const [k, data] of this.chunks) {
      if (!data.some((v) => v !== 0)) continue;
      const cx = k % this.chunksX;
      const rest = (k - cx) / this.chunksX;
      const cz = rest % this.chunksZ;
      const cy = (rest - cz) / this.chunksZ;
      yield { cx, cy, cz, data };
    }
  }
}
