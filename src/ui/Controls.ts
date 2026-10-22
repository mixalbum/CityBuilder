import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WALKER, collides, groundBelow, stepWalker, type Body, type SolidFn } from './walker';

export type CameraMode = 'orbit' | 'fly' | 'walk' | 'diorama';
export const CAMERA_MODES: readonly CameraMode[] = ['orbit', 'fly', 'walk', 'diorama'];

const FLY_SPEED = 60;
const WALK_SPEED = 5;
/** Shift multiplies speed by this. */
const BOOST = 4;
const LOOK_SPEED = 0.004;
/** How far ahead of a first-person camera the "target" sits (shadows, export, back to orbit). */
const AHEAD = 60;
/** True isometric: the view direction makes equal angles with all three axes. */
const ISO_POLAR = Math.acos(1 / Math.sqrt(3));
/** Distance of the orthographic camera from its target (far enough to clear the tallest tower). */
const ISO_DIST = 1500;

/**
 * Orbit camera with keyboard panning and smooth fly-to for landmarks, plus
 * first-person fly and walk modes (WASD + drag to look) and an orthographic
 * isometric "diorama" mode. Walking collides with the voxel world through `solid`.
 */
export class CityControls {
  readonly orbit: OrbitControls;
  mode: CameraMode = 'orbit';
  onModeChange?: (mode: CameraMode) => void;
  private flight?: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number };
  /** Diorama quarter-turn in progress: azimuths in radians. */
  private spin?: { from: number; to: number; t: number };
  private readonly keys = new Set<string>();
  private readonly look = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly body: Body = { x: 0, y: 0, z: 0, vy: 0, onGround: false };
  private dragging = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly solid: SolidFn = () => false,
    private readonly ortho = new THREE.OrthographicCamera(),
  ) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 15;
    this.orbit.maxDistance = 3500;
    this.orbit.screenSpacePanning = false;
    this.orbit.keyPanSpeed = 40;
    this.orbit.listenToKeyEvents(window);
    this.orbit.minZoom = 0.3;
    this.orbit.maxZoom = 10;

    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) return this.setMode(CAMERA_MODES[n]);
      if (this.mode === 'diorama' && e.code === 'KeyR') return this.turn(e.shiftKey ? -1 : 1);
      if (!this.firstPerson) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      if (!this.firstPerson) return;
      this.dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.firstPerson) return;
      this.look.y -= e.movementX * LOOK_SPEED;
      this.look.x = THREE.MathUtils.clamp(this.look.x - e.movementY * LOOK_SPEED, -1.5, 1.5);
    });
  }

  get target(): THREE.Vector3 {
    return this.orbit.target;
  }

  private get firstPerson(): boolean {
    return this.mode === 'fly' || this.mode === 'walk';
  }

  /** The camera currently rendering. */
  get active(): THREE.Camera {
    return this.mode === 'diorama' ? this.ortho : this.camera;
  }

  /**
   * Where level of detail is measured from: the camera, or for the
   * orthographic view (whose camera is far away) the point it looks at.
   */
  get viewpoint(): THREE.Vector3 {
    return this.mode === 'diorama' ? this.orbit.target : this.camera.position;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.flight = undefined;
    this.spin = undefined;
    this.keys.clear();
    if (this.mode === 'diorama') {
      // Leave the diorama with the perspective camera looking the same way.
      const dir = this.ortho.position.clone().sub(this.orbit.target).normalize();
      this.camera.position.copy(this.orbit.target).addScaledVector(dir, 700 / this.ortho.zoom);
      this.camera.lookAt(this.orbit.target);
      this.orbit.object = this.camera;
      this.orbit.minPolarAngle = 0;
      this.orbit.maxPolarAngle = Math.PI * 0.49;
    }
    if (mode === 'diorama') {
      if (this.firstPerson) this.camera.position.y = Math.max(this.camera.position.y, this.orbit.target.y + 1);
      // Snap to the nearest isometric corner of the street grid.
      const off = this.camera.position.clone().sub(this.orbit.target);
      const az = Math.round((Math.atan2(off.x, off.z) - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
      this.ortho.zoom = 1;
      this.ortho.updateProjectionMatrix();
      this.orbit.object = this.ortho;
      this.orbit.minPolarAngle = this.orbit.maxPolarAngle = ISO_POLAR;
      this.placeOrtho(az);
    } else if (mode === 'orbit') {
      if (this.firstPerson) {
        // Orbit around the point the first-person camera was looking at.
        this.orbit.target.copy(this.camera.position).add(this.forward().multiplyScalar(AHEAD));
        if (this.mode === 'walk') this.camera.position.y += 30;
      }
    } else {
      this.look.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.look.z = 0;
      if (mode === 'walk') {
        // Stand at the point being looked at: on the street, or climbed out
        // onto the roof when that point is inside a building.
        const t = this.firstPerson ? this.camera.position : this.orbit.target;
        Object.assign(this.body, { x: t.x, z: t.z, vy: 0, onGround: false });
        this.body.y = groundBelow(this.solid, t.x, t.z, Math.max(t.y, 0) + 2);
        while (collides(this.solid, this.body.x, this.body.y, this.body.z)) this.body.y++;
        this.look.x = 0;
      }
    }
    this.orbit.enabled = mode === 'orbit' || mode === 'diorama';
    this.camera.near = mode === 'walk' ? 0.1 : 1;
    this.camera.updateProjectionMatrix();
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  /** Put the orthographic camera at isometric elevation and azimuth `az` around the target. */
  private placeOrtho(az: number): void {
    const s = Math.sin(ISO_POLAR);
    this.ortho.position
      .copy(this.orbit.target)
      .add(new THREE.Vector3(Math.sin(az) * s, Math.cos(ISO_POLAR), Math.cos(az) * s).multiplyScalar(ISO_DIST));
    this.ortho.lookAt(this.orbit.target);
  }

  /** Turn the diorama a quarter turn (direction 1 or -1) to the next isometric corner. */
  turn(direction: 1 | -1): void {
    if (this.mode !== 'diorama') return;
    const off = this.ortho.position.clone().sub(this.orbit.target);
    const from = this.spin?.to ?? Math.atan2(off.x, off.z);
    this.spin = { from: Math.atan2(off.x, off.z), to: from + (direction * Math.PI) / 2, t: 0 };
  }

  /** Jump to a point, framing something `size` voxels tall. */
  flyTo(point: THREE.Vector3, size: number): void {
    if (this.mode === 'diorama') {
      // Slide the diorama over to the point, keeping the angle and zoom.
      const off = this.ortho.position.clone().sub(this.orbit.target);
      this.flight = { from: this.orbit.target.clone(), to: point.clone(), camFrom: this.ortho.position.clone(), camTo: point.clone().add(off), t: 0 };
      return;
    }
    this.setMode('orbit');
    const dist = Math.max(140, size * 1.8);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    dir.y = Math.max(dir.y, 0.45);
    dir.normalize();
    this.flight = {
      from: this.orbit.target.clone(),
      to: point.clone(),
      camFrom: this.camera.position.clone(),
      camTo: point.clone().add(dir.multiplyScalar(dist)),
      t: 0,
    };
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    if (this.firstPerson) return this.updateFirstPerson(dt);
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 1.2);
      this.orbit.target.lerpVectors(f.from, f.to, ease(f.t));
      this.active.position.lerpVectors(f.camFrom, f.camTo, ease(f.t));
      if (f.t >= 1) this.flight = undefined;
    }
    if (this.spin) {
      const s = this.spin;
      s.t = Math.min(1, s.t + dt / 0.6);
      this.placeOrtho(s.from + (s.to - s.from) * ease(s.t));
      if (s.t >= 1) this.spin = undefined;
    }
    this.orbit.update();
  }

  private forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  private axis(plus: string[], minus: string[]): number {
    return (plus.some((k) => this.keys.has(k)) ? 1 : 0) - (minus.some((k) => this.keys.has(k)) ? 1 : 0);
  }

  private updateFirstPerson(dt: number): void {
    const turn = this.axis(['ArrowLeft'], ['ArrowRight']);
    this.look.y += turn * 1.6 * dt;
    const fwd = this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const side = this.axis(['KeyD'], ['KeyA']);
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? BOOST : 1;
    // Camera looks down -z at yaw 0; right is +x.
    const sin = Math.sin(this.look.y), cos = Math.cos(this.look.y);
    const norm = fwd && side ? Math.SQRT1_2 : 1;

    if (this.mode === 'fly') {
      const speed = FLY_SPEED * boost * dt * norm;
      // Forward follows the pitch, so W climbs when looking up.
      const flat = Math.cos(this.look.x) * fwd;
      const p = this.camera.position;
      p.x += (-sin * flat + cos * side) * speed;
      p.z += (-cos * flat - sin * side) * speed;
      p.y += (Math.sin(this.look.x) * fwd + this.axis(['KeyE', 'Space'], ['KeyQ'])) * speed;
      p.y = Math.max(p.y, 2);
    } else {
      const speed = WALK_SPEED * boost * dt * norm;
      const dx = -sin * fwd + cos * side, dz = -cos * fwd - sin * side;
      stepWalker(this.body, this.solid, dx * speed, dz * speed, this.keys.has('Space'), dt);
      this.camera.position.set(this.body.x, this.body.y + WALKER.eye, this.body.z);
    }
    this.camera.quaternion.setFromEuler(this.look);
    this.orbit.target.copy(this.camera.position).add(this.forward().multiplyScalar(AHEAD));
  }
}
