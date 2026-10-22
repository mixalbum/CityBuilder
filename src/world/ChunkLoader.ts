import * as THREE from 'three';
import { CHUNK, CHUNK_VOL, readRegion, rleDecode, voxelIndex, type ManifestRegion, type RegionChunk, type WorldManifest } from './chunkFormat';
import type { MeshData } from './mesher';
import type { MeshRequest } from './mesher.worker';

/** Regions nearer than this (voxels) show full detail once it's built. */
export const LOD_SWITCH = 500;
/** Build full detail for regions within this distance of the camera. */
const DETAIL_RADIUS = 650;
/** Regions meshed in full detail at once; keeps the UI responsive. */
const DETAIL_IN_FLIGHT = 2;
import type { Box, VoxelSource } from './vox';
import { createCityMaterial } from '../render/Materials';

type Key = string;
const chunkKey = (cx: number, cy: number, cz: number): Key => `${cx},${cy},${cz}`;
const regionKey = (rx: number, rz: number): Key => `${rx},${rz}`;

interface RegionState {
  info: ManifestRegion;
  chunks: Key[];
  meshes: MeshData[];
  pending: number;
  /** All neighbouring regions are loaded, so meshes are seamless. */
  ready: boolean;
  coarse: 'none' | 'queued' | 'done';
  detail: 'none' | 'queued' | 'done';
  lod?: THREE.LOD;
}

/** Concatenate chunk meshes (positions already region-local) into one geometry. */
function mergeMeshes(meshes: MeshData[]): THREE.BufferGeometry {
  const verts = meshes.reduce((n, m) => n + m.vertexCount, 0);
  const tris = meshes.reduce((n, m) => n + m.indices.length, 0);
  const positions = new Uint16Array(verts * 3);
  const normals = new Int8Array(verts * 3);
  const colors = new Uint8Array(verts * 3);
  const glow = new Uint8Array(verts);
  const indices = new Uint32Array(tris);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    colors.set(m.colors, vo * 3);
    glow.set(m.glow, vo);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    vo += m.vertexCount;
    io += m.indices.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geo.setAttribute('glow', new THREE.BufferAttribute(glow, 1, true));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Fixed-size pool of mesher workers with a simple job queue. */
class WorkerPool {
  private readonly idle: Worker[] = [];
  private readonly queue: { req: MeshRequest; resolve: (m: MeshData) => void }[] = [];
  private readonly inflight = new Map<number, (m: MeshData) => void>();
  private nextJob = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ jobId: number; mesh: MeshData }>) => {
        this.inflight.get(e.data.jobId)!(e.data.mesh);
        this.inflight.delete(e.data.jobId);
        this.idle.push(w);
        this.pump();
      };
      this.idle.push(w);
    }
  }

  run(req: DistributiveOmit<MeshRequest, 'jobId'>): Promise<MeshData> {
    return new Promise((resolve) => {
      this.queue.push({ req: { ...req, jobId: this.nextJob++ } as MeshRequest, resolve });
      this.pump();
    });
  }

  get busy(): boolean {
    return this.queue.length > 0 || this.inflight.size > 0;
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const { req, resolve } = this.queue.shift()!;
      this.inflight.set(req.jobId, resolve);
      this.idle.pop()!.postMessage(req);
    }
  }
}

/**
 * Streams region files nearest-first. Once a region's neighbours are loaded
 * (so faces and AO are seamless across borders) it gets a coarse 2x mesh;
 * regions near the camera then get full detail, chunk by chunk, merged into
 * one mesh per region. Each region is a THREE.LOD switching between the two.
 */
export class ChunkLoader {
  readonly group = new THREE.Group();
  private readonly city = createCityMaterial();
  readonly material = this.city.material;
  /** Night factor uniform (0 day, 1 night) shared by every region mesh. */
  readonly night = this.city.night;
  /** Translucent glass (Melbourne Central's cone, arcade skylights). */
  readonly glassMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false });
  onProgress?: (loaded: number, total: number) => void;

  private readonly rle = new Map<Key, Uint8Array>();
  private readonly regions = new Map<Key, RegionState>();
  private readonly loaded = new Set<Key>();
  private readonly pool = new WorkerPool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
  private meshed = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly manifest: WorldManifest,
  ) {
    for (const info of manifest.regions)
      this.regions.set(regionKey(info.rx, info.rz), { info, chunks: [], meshes: [], pending: 0, ready: false, coarse: 'none', detail: 'none' });
  }

  /**
   * Read access to the loaded voxels (for .vox export), decoding chunks on
   * demand. Also reports the top of the non-empty chunks over an area.
   */
  voxelSource(): VoxelSource & { topIn(area: Omit<Box, 'y0' | 'y1'>): number } {
    const decoded = new Map<Key, Uint8Array>();
    const rle = this.rle;
    return {
      get(x, y, z) {
        if (x < 0 || y < 0 || z < 0) return 0;
        const k = chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK));
        let c = decoded.get(k);
        if (!c) {
          const src = rle.get(k);
          if (!src) return 0;
          c = new Uint8Array(CHUNK_VOL);
          rleDecode(src, c);
          decoded.set(k, c);
        }
        return c[voxelIndex(x & 31, y & 31, z & 31)];
      },
      topIn(area) {
        let top = 0;
        for (const k of rle.keys()) {
          const [cx, cy, cz] = k.split(',').map(Number);
          if ((cx + 1) * CHUNK <= area.x0 || cx * CHUNK >= area.x1 || (cz + 1) * CHUNK <= area.z0 || cz * CHUNK >= area.z1) continue;
          top = Math.max(top, (cy + 1) * CHUNK);
        }
        return top;
      },
    };
  }

  /** Load every region, nearest to `focus` (voxel x, z) first. */
  async loadAll(focus: [number, number], concurrency = 6): Promise<void> {
    const span = this.manifest.regionSize * CHUNK;
    const order = [...this.regions.values()].sort(
      (a, b) =>
        Math.hypot((a.info.rx + 0.5) * span - focus[0], (a.info.rz + 0.5) * span - focus[1]) -
        Math.hypot((b.info.rx + 0.5) * span - focus[0], (b.info.rz + 0.5) * span - focus[1]),
    );
    let next = 0;
    const worker = async () => {
      while (next < order.length) await this.loadRegion(order[next++]);
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  private async loadRegion(r: RegionState): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${r.info.file}`);
    if (!res.ok) throw new Error(`Failed to load ${r.info.file}: HTTP ${res.status}`);
    for (const c of readRegion(await res.arrayBuffer())) {
      const k = chunkKey(c.cx, c.cy, c.cz);
      this.rle.set(k, c.rle);
      r.chunks.push(k);
    }
    this.loaded.add(regionKey(r.info.rx, r.info.rz));
    // This region, or a neighbour waiting on it, may now be ready.
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.regions.get(regionKey(r.info.rx + dx, r.info.rz + dz));
        if (n && !n.ready && this.neighboursLoaded(n)) {
          n.ready = true;
          this.meshCoarse(n);
        }
      }
  }

  private neighboursLoaded(r: RegionState): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const k = regionKey(r.info.rx + dx, r.info.rz + dz);
        if (this.regions.has(k) && !this.loaded.has(k)) return false;
      }
    return true;
  }

  private get span(): number {
    return this.manifest.regionSize * CHUNK;
  }

  /** Coarse mesh of the whole region, from its chunks plus the neighbouring chunk columns. */
  private meshCoarse(r: RegionState): void {
    r.coarse = 'queued';
    const n = this.manifest.regionSize;
    const cx0 = r.info.rx * n - 1, cx1 = (r.info.rx + 1) * n, cz0 = r.info.rz * n - 1, cz1 = (r.info.rz + 1) * n;
    const chunks: RegionChunk[] = [];
    let top = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const k of this.regions.get(regionKey(r.info.rx + dx, r.info.rz + dz))?.chunks ?? []) {
          const [cx, cy, cz] = k.split(',').map(Number);
          if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) continue;
          chunks.push({ cx, cy, cz, rle: this.rle.get(k)! });
          if (cx > cx0 && cx < cx1 && cz > cz0 && cz < cz1) top = Math.max(top, cy + 1);
        }
    const x0 = r.info.rx * this.span, z0 = r.info.rz * this.span;
    this.pool.run({ kind: 'region', x0, z0, span: this.span, height: top * CHUNK, chunks }).then((m) => {
      r.coarse = 'done';
      const lod = new THREE.LOD();
      lod.autoUpdate = false; // switched from update(), which knows the viewpoint
      lod.position.set(x0 + this.span / 2, 20, z0 + this.span / 2);
      lod.name = `region ${r.info.rx},${r.info.rz}`;
      lod.updateMatrixWorld();
      lod.addLevel(this.regionObject([m], 'coarse'), 0);
      r.lod = lod;
      this.group.add(lod);
      this.onProgress?.(++this.meshed, this.regions.size);
    });
  }

  /** Full-detail meshes of every chunk in the region, merged on completion. */
  private meshDetail(r: RegionState): void {
    r.detail = 'queued';
    r.pending = r.chunks.length;
    const ox = r.info.rx * this.span, oz = r.info.rz * this.span;
    for (const k of r.chunks) {
      const [cx, cy, cz] = k.split(',').map(Number);
      const neighbours: (Uint8Array | null)[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) neighbours.push(this.rle.get(chunkKey(cx + dx, cy + dy, cz + dz)) ?? null);
      const offset: [number, number, number] = [cx * CHUNK - ox, cy * CHUNK, cz * CHUNK - oz];
      this.pool.run({ kind: 'chunk', offset, origin: [cx * CHUNK, cy * CHUNK, cz * CHUNK], neighbours }).then((m) => {
        if (m.vertexCount || m.transparent) r.meshes.push(m);
        if (--r.pending === 0) this.finishDetail(r);
      });
    }
  }

  private finishDetail(r: RegionState): void {
    const detail = this.regionObject(r.meshes, 'detail');
    r.meshes = [];
    r.detail = 'done';
    // Coarse beyond the switch distance, detail nearer.
    r.lod!.levels[0].distance = LOD_SWITCH;
    r.lod!.addLevel(detail, 0);
    // Keep the workers busy without waiting for the next frame.
    this.update(this.viewpoint);
  }

  /** Opaque and glass meshes of a region, in region-local coordinates under the LOD centre. */
  private regionObject(meshes: MeshData[], name: string): THREE.Object3D {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(-this.span / 2, -20, -this.span / 2);
    const opaque = new THREE.Mesh(mergeMeshes(meshes), this.material);
    opaque.castShadow = true;
    opaque.receiveShadow = true;
    group.add(opaque);
    const glass = mergeMeshes(meshes.flatMap((m) => (m.transparent ? [m.transparent] : [])));
    if (glass.index!.count) {
      const pane = new THREE.Mesh(glass, this.glassMaterial);
      pane.renderOrder = 1; // after opaque geometry
      group.add(pane);
    }
    return group;
  }

  private readonly viewpoint = new THREE.Vector3(Infinity, 0, 0);
  /** Stand-in camera for THREE.LOD, which reads only its world matrix and zoom. */
  private readonly lodCamera = Object.assign(new THREE.Object3D(), { zoom: 1 });

  /**
   * Pick each region's level of detail by its distance from `viewpoint` and
   * schedule full detail for those nearby; call once per frame. The viewpoint
   * is the camera for perspective views, and the target for orthographic
   * ones, whose camera sits far away.
   */
  update(viewpoint: THREE.Vector3): void {
    this.viewpoint.copy(viewpoint);
    this.lodCamera.position.copy(viewpoint);
    this.lodCamera.updateMatrixWorld();
    let inFlight = 0;
    const wanted: { r: RegionState; d: number }[] = [];
    for (const r of this.regions.values()) {
      r.lod?.update(this.lodCamera as unknown as THREE.Camera);
      if (r.detail === 'queued') inFlight++;
      if (r.coarse !== 'done' || r.detail !== 'none') continue;
      const d = viewpoint.distanceTo(r.lod!.position);
      if (d < DETAIL_RADIUS) wanted.push({ r, d });
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const { r } of wanted.slice(0, Math.max(0, DETAIL_IN_FLIGHT - inFlight))) this.meshDetail(r);
    this.pendingDetail = wanted.length;
  }

  private pendingDetail = 0;

  /** True when every region has its coarse mesh and nearby detail is built. */
  idle(): boolean {
    return this.meshed === this.regions.size && this.pendingDetail === 0 && !this.pool.busy;
  }

  /** Triangles in the levels currently shown (for diagnostics). */
  visibleTriangles(): number {
    let n = 0;
    for (const lod of this.group.children as THREE.LOD[])
      lod.levels.forEach((l) => l.object.visible && l.object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) n += (o as THREE.Mesh).geometry.index!.count / 3;
      }));
    return n;
  }
}
