import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Livery {
  length: number;
  lower: number;
  upper: number;
  roof: number;
}

/** Modern E-class in PTV green and white, and the W-class City Circle trams in maroon and cream. */
const E_CLASS: Livery = { length: 24, lower: 0x6fae2a, upper: 0xf1f1ec, roof: 0x8d9296 };
const W_CLASS: Livery = { length: 14, lower: 0x7a1f22, upper: 0xe6d3a3, roof: 0x4a4a48 };
const W_SHARE = 0.15;

const WIDTH = 2.6;
const SPEED = 9; // voxels (metres) per second
const SPACING = 130; // one tram per this many metres of track

/** A blocky tram along +z, standing on y = 0, with glowing windows. */
function tramGeometry(l: Livery): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, y: number, hex: number, glow = 0, z = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(0, y + h / 2, z);
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    parts.push(g);
  };
  const L = l.length;
  box(WIDTH - 0.4, 0.5, L - 1, 0, 0x2b2b2b); // underframe and bogies
  box(WIDTH, 1.1, L, 0.5, l.lower); // lower body
  box(WIDTH + 0.02, 1.2, L - 1.2, 1.6, 0x24303a, 1); // window band (lit at night)
  box(WIDTH, 1.6, 0.6, 1.6, l.upper, 0, L / 2 - 0.3); // cab ends
  box(WIDTH, 1.6, 0.6, 1.6, l.upper, 0, -L / 2 + 0.3);
  box(WIDTH, 0.5, L, 2.8, l.upper); // upper body
  box(WIDTH - 0.6, 0.3, L - 2, 3.3, l.roof); // roof
  box(1.6, 0.7, 0.2, 3.6, 0x1e1e1e); // pantograph
  return mergeGeometries(parts)!;
}

interface Route {
  pts: Float32Array;
  /** Cumulative distance at each point. */
  dist: Float32Array;
  length: number;
}

interface Tram {
  route: Route;
  s: number;
  half: number;
  mesh: THREE.InstancedMesh;
  index: number;
}

function toRoute(flat: number[]): Route {
  const n = flat.length / 3;
  const pts = Float32Array.from(flat);
  const dist = new Float32Array(n);
  for (let i = 1; i < n; i++)
    dist[i] = dist[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
  return { pts, dist, length: dist[n - 1] };
}

/** Point at distance s along a route (clamped to its ends). */
function sample(r: Route, s: number, out: THREE.Vector3): THREE.Vector3 {
  const d = r.dist;
  s = Math.max(0, Math.min(r.length, s));
  let lo = 0, hi = d.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = d[hi] > d[lo] ? (s - d[lo]) / (d[hi] - d[lo]) : 0;
  const p = r.pts;
  return out.set(
    p[lo * 3] + (p[hi * 3] - p[lo * 3]) * t,
    p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * t,
    p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * t,
  );
}

/** Instanced trams running along the routes, wrapping to the start at each route's end. */
export class Trams {
  readonly group = new THREE.Group();
  private readonly trams: Tram[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly front = new THREE.Vector3();
  private readonly back = new THREE.Vector3();

  constructor(lines: number[][], material: THREE.Material) {
    const routes = lines.filter((l) => l.length >= 6).map(toRoute);
    const plan: { route: Route; s: number; w: boolean }[] = [];
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const route of routes) {
      const count = Math.max(1, Math.floor(route.length / SPACING));
      const phase = rand() * SPACING;
      for (let i = 0; i < count; i++) plan.push({ route, s: (phase + (i * route.length) / count) % route.length, w: rand() < W_SHARE });
    }

    for (const [livery, isW] of [[E_CLASS, false], [W_CLASS, true]] as const) {
      const own = plan.filter((p) => p.w === isW);
      if (!own.length) continue;
      const mesh = new THREE.InstancedMesh(tramGeometry(livery), material, own.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances span the whole city
      own.forEach((p, index) => this.trams.push({ route: p.route, s: p.s, half: livery.length / 2, mesh, index }));
      this.group.add(mesh);
    }
    this.update(0);
  }

  /** Multiplier on tram speed; 0 freezes them (used for screenshots). */
  speed = 1;

  get count(): number {
    return this.trams.length;
  }

  /** Centre of tram `i` on its track. */
  positionOf(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.trams[i % this.trams.length];
    return sample(t.route, t.s, out);
  }

  update(dt: number): void {
    for (const t of this.trams) {
      t.s = (t.s + SPEED * this.speed * dt) % t.route.length;
      sample(t.route, t.s + t.half, this.front);
      sample(t.route, t.s - t.half, this.back);
      this.dummy.position.copy(this.front).add(this.back).multiplyScalar(0.5);
      this.dummy.lookAt(this.front.x, this.dummy.position.y + (this.front.y - this.back.y) * 0.5, this.front.z);
      this.dummy.updateMatrix();
      t.mesh.setMatrixAt(t.index, this.dummy.matrix);
    }
    for (const m of this.group.children as THREE.InstancedMesh[]) m.instanceMatrix.needsUpdate = true;
  }
}
