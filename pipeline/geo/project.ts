import type { Extent } from '../config';

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQUATOR = 111320;

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Equirectangular projection around an origin, rotated so the city's street
 * grid is axis-aligned. Accurate to well under a voxel over a few kilometres.
 */
export class Projector {
  private readonly c: number;
  private readonly s: number;
  private readonly kLon: number;

  constructor(
    readonly origin: LatLon,
    readonly angleDeg: number,
  ) {
    const a = (angleDeg * Math.PI) / 180;
    this.c = Math.cos(a);
    this.s = Math.sin(a);
    this.kLon = M_PER_DEG_LON_EQUATOR * Math.cos((origin.lat * Math.PI) / 180);
  }

  /** Raw east/north metres from the origin, without grid rotation. */
  toEastNorth(lat: number, lon: number): [number, number] {
    return [(lon - this.origin.lon) * this.kLon, (lat - this.origin.lat) * M_PER_DEG_LAT];
  }

  /** Grid metres: x along the grid's main axis, n across it. */
  toGrid(lat: number, lon: number): [number, number] {
    const [e, n] = this.toEastNorth(lat, lon);
    return [e * this.c + n * this.s, -e * this.s + n * this.c];
  }

  toLatLon(gx: number, gn: number): LatLon {
    const e = gx * this.c - gn * this.s;
    const n = gx * this.s + gn * this.c;
    return { lat: this.origin.lat + n / M_PER_DEG_LAT, lon: this.origin.lon + e / this.kLon };
  }

  /** Lat/lon bounding box (south, west, north, east) covering a grid extent. */
  bbox(ext: Extent): [number, number, number, number] {
    const corners = [
      this.toLatLon(ext.minX, ext.minN),
      this.toLatLon(ext.minX, ext.maxN),
      this.toLatLon(ext.maxX, ext.minN),
      this.toLatLon(ext.maxX, ext.maxN),
    ];
    const lats = corners.map((c) => c.lat);
    const lons = corners.map((c) => c.lon);
    return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
  }
}

/**
 * Maps grid metres to voxel space. Voxel x grows along the grid's main axis
 * (east when the angle is 0) and voxel z grows southwards, so three.js'
 * default -z view looks north.
 */
export class WorldFrame {
  readonly sizeX: number;
  readonly sizeZ: number;

  constructor(
    readonly projector: Projector,
    readonly extent: Extent,
  ) {
    this.sizeX = Math.ceil(extent.maxX - extent.minX);
    this.sizeZ = Math.ceil(extent.maxN - extent.minN);
  }

  gridToVoxel(gx: number, gn: number): [number, number] {
    return [gx - this.extent.minX, this.extent.maxN - gn];
  }

  latLonToVoxel(lat: number, lon: number): [number, number] {
    const [gx, gn] = this.projector.toGrid(lat, lon);
    return this.gridToVoxel(gx, gn);
  }
}

/** Highway classes whose bearings define a street grid (not footpaths, ramps or driveways). */
const GRID_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'trunk', 'pedestrian']);

/**
 * Estimate the street grid's bearing: each road segment's bearing folded
 * into [-45, 45), length-weighted into 1° bins, smoothed, and refined around
 * the strongest peak. `streets` restricts it to named streets (a city's main
 * grid); otherwise ordinary road classes are used. Returns undefined when
 * there is too little street to trust.
 */
export function estimateGridAngle(
  lines: { name: string; highway?: string; points: LatLon[] }[],
  projector: Projector,
  streets?: string[],
): number | undefined {
  const names = streets?.length ? new Set(streets) : undefined;
  const samples: { angle: number; len: number }[] = [];
  for (const line of lines) {
    if (names ? !names.has(line.name) : line.highway !== undefined && !GRID_CLASSES.has(line.highway)) continue;
    for (let i = 1; i < line.points.length; i++) {
      const [e0, n0] = projector.toEastNorth(line.points[i - 1].lat, line.points[i - 1].lon);
      const [e1, n1] = projector.toEastNorth(line.points[i].lat, line.points[i].lon);
      const len = Math.hypot(e1 - e0, n1 - n0);
      if (len < 5) continue;
      let deg = (Math.atan2(n1 - n0, e1 - e0) * 180) / Math.PI;
      deg = ((((deg + 45) % 90) + 90) % 90) - 45;
      samples.push({ angle: deg, len });
    }
  }
  const total = samples.reduce((s, x) => s + x.len, 0);
  if (total < 500) return undefined;

  // Histogram on the 90° circle, smoothed over ±3°.
  const bins = new Float64Array(90);
  for (const s of samples) bins[Math.floor(s.angle + 45) % 90] += s.len;
  let best = 0, bestW = -1;
  for (let b = 0; b < 90; b++) {
    let w = 0;
    for (let d = -3; d <= 3; d++) w += bins[(b + d + 90) % 90] * (4 - Math.abs(d));
    if (w > bestW) [best, bestW] = [b, w];
  }
  // Length-weighted mean of the samples near the peak, unwrapped around it.
  const peak = best - 45 + 0.5;
  let num = 0, den = 0;
  for (const s of samples) {
    let d = s.angle - peak;
    d = ((((d + 45) % 90) + 90) % 90) - 45;
    if (Math.abs(d) > 4) continue;
    num += (peak + d) * s.len;
    den += s.len;
  }
  const angle = num / den;
  return ((((angle + 45) % 90) + 90) % 90) - 45;
}
