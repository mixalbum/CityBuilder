/// <reference lib="webworker" />
import { CHUNK_VOL, type RegionChunk } from './chunkFormat';
import { denseRegion, downsampleRegion } from './lod';
import { buildPadded, meshChunk, meshVolume, type MeshData } from './mesher';
import { linearPalette } from './palette';

/** Full-detail mesh of one chunk from its 3x3x3 neighbourhood. */
export interface ChunkRequest {
  kind: 'chunk';
  jobId: number;
  offset: [number, number, number];
  /** World voxel position of the chunk. */
  origin: [number, number, number];
  neighbours: (Uint8Array | null)[];
}

/** Coarse (2x downsampled) mesh of a whole region from its chunks plus a border. */
export interface RegionRequest {
  kind: 'region';
  jobId: number;
  /** World voxel position of the region's corner. */
  x0: number;
  z0: number;
  span: number;
  height: number;
  chunks: RegionChunk[];
}

export type MeshRequest = ChunkRequest | RegionRequest;

const palette = linearPalette();
const scratch = Array.from({ length: 27 }, () => new Uint8Array(CHUNK_VOL));

function meshFor(req: MeshRequest): MeshData {
  if (req.kind === 'chunk') return meshChunk(buildPadded(req.neighbours, scratch), palette, req.offset, req.origin);
  const { vol, dims } = downsampleRegion(denseRegion(req.chunks, req.x0, req.z0, req.span, req.height), req.span);
  return meshVolume(vol, dims, palette, [0, 0, 0], [req.x0 / 2, 0, req.z0 / 2], 2);
}

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const mesh = meshFor(e.data);
  const buffers = (m: MeshData) => [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.glow.buffer, m.indices.buffer];
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ jobId: e.data.jobId, mesh }, [
    ...buffers(mesh),
    ...(mesh.transparent ? buffers(mesh.transparent) : []),
  ]);
};
