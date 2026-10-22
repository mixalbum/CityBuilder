import * as THREE from 'three';

/** Melbourne, for worlds built before manifests recorded their latitude. */
const DEFAULT_LATITUDE = -37.81;
const DEG = Math.PI / 180;

const SKY_DAY = new THREE.Color(0xbfd8ea);
const SKY_DUSK = new THREE.Color(0xe9a36f);
const SKY_NIGHT = new THREE.Color(0x0c1530);
const SUN_DAY = new THREE.Color(0xfff4e0);
const SUN_LOW = new THREE.Color(0xffb070);
const HEMI_DAY = new THREE.Color(0xdbe9ff);
const HEMI_NIGHT = new THREE.Color(0x3a4f80);

export interface Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  scene: THREE.Scene;
  fog: THREE.Fog;
  night: { value: number };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sun position for the city's latitude at a given local solar time and day of year,
 * and the sky, light and night-glow levels that follow from it.
 */
export class DayNight {
  /** Unit vector towards the sun in voxel space (y up). */
  readonly sunDir = new THREE.Vector3();
  private readonly east: THREE.Vector3;
  private readonly north: THREE.Vector3;

  constructor(
    private readonly lighting: Lighting,
    gridAngleDeg: number,
    private readonly latitude = DEFAULT_LATITUDE,
  ) {
    // Voxel x runs along the street grid (gridAngle north of east) and voxel
    // z runs south-ish, so true east and north are rotated in voxel space.
    const a = gridAngleDeg * DEG;
    this.east = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    this.north = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
  }

  /** Solar elevation (radians) and the sun direction for `hours` (0–24) on `dayOfYear`. */
  sunAt(hours: number, dayOfYear: number): number {
    const decl = -23.44 * DEG * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
    const hourAngle = (hours - 12) * 15 * DEG;
    const lat = this.latitude * DEG;
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
    const el = Math.asin(sinEl);
    // Azimuth measured from north towards east.
    const az = Math.atan2(-Math.sin(hourAngle), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle));
    const horiz = Math.cos(el);
    this.sunDir
      .copy(this.north)
      .multiplyScalar(Math.cos(az) * horiz)
      .addScaledVector(this.east, Math.sin(az) * horiz)
      .setY(Math.sin(el))
      .normalize();
    return el;
  }

  /** Apply lighting for a time of day. */
  update(hours: number, dayOfYear: number): void {
    const el = this.sunAt(hours, dayOfYear);
    const s = Math.sin(el);
    const { sun, hemi, scene, fog, night } = this.lighting;

    const day = smoothstep(-0.05, 0.25, s);
    const dusk = smoothstep(-0.12, 0.02, s) * (1 - smoothstep(0.05, 0.3, s));
    night.value = 1 - smoothstep(-0.1, 0.08, s);

    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.7);
    (scene.background as THREE.Color).copy(sky);
    fog.color.copy(sky);

    sun.intensity = 2.6 * smoothstep(-0.02, 0.2, s);
    sun.color.copy(SUN_LOW).lerp(SUN_DAY, smoothstep(0.05, 0.5, s));
    sun.castShadow = s > 0.02;
    hemi.intensity = 0.45 + 0.65 * day;
    hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
  }
}

/** Day of the year (1–366) for a date. */
export function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}
