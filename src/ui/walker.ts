// First-person movement against the voxel world. Pure, so it can be tested
// without a renderer: positions are in voxels (1 voxel = 1 m).

export type SolidFn = (x: number, y: number, z: number) => boolean;

export interface Body {
  /** Feet position (centre of the footprint, bottom of the box). */
  x: number;
  y: number;
  z: number;
  vy: number;
  onGround: boolean;
}

export const WALKER = {
  radius: 0.3,
  height: 1.8,
  eye: 1.65,
  /** Ledges up to this tall (kerbs, steps) are climbed without jumping. */
  stepUp: 1,
  gravity: 25,
  jumpSpeed: 8,
  maxFall: 50,
};

/** Does a walker-sized box with its feet at (x, y, z) overlap anything solid? */
export function collides(solid: SolidFn, x: number, y: number, z: number): boolean {
  const r = WALKER.radius;
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
  const y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + WALKER.height - 1e-4);
  for (let vy = y0; vy <= y1; vy++)
    for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) if (solid(vx, vy, vz)) return true;
  return false;
}

/** Move horizontally by (dx, dz), climbing small ledges; each axis slides independently. */
function moveAxis(b: Body, solid: SolidFn, dx: number, dz: number): void {
  const nx = b.x + dx, nz = b.z + dz;
  if (!collides(solid, nx, b.y, nz)) {
    b.x = nx;
    b.z = nz;
    return;
  }
  if (!b.onGround) return;
  // Step up onto the lowest clear ledge.
  for (let up = 1; up <= WALKER.stepUp; up++) {
    const ny = Math.floor(b.y) + up;
    if (!collides(solid, nx, ny, nz) && !collides(solid, b.x, ny, b.z)) {
      b.x = nx;
      b.y = ny;
      b.z = nz;
      return;
    }
  }
}

/**
 * Advance a walking body by `dt` seconds. `dx`/`dz` is the horizontal
 * displacement wanted this step; `jump` starts a jump when on the ground.
 */
export function stepWalker(b: Body, solid: SolidFn, dx: number, dz: number, jump: boolean, dt: number): void {
  // Sub-step so fast moves cannot tunnel through 1-voxel walls.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (WALKER.radius * 0.9)));
  for (let i = 0; i < steps; i++) {
    moveAxis(b, solid, dx / steps, 0);
    moveAxis(b, solid, 0, dz / steps);
  }

  if (jump && b.onGround) b.vy = WALKER.jumpSpeed;
  b.vy = Math.max(-WALKER.maxFall, b.vy - WALKER.gravity * dt);
  const dy = b.vy * dt;
  const ySteps = Math.max(1, Math.ceil(Math.abs(dy) / 0.5));
  b.onGround = false;
  for (let i = 0; i < ySteps; i++) {
    const ny = b.y + dy / ySteps;
    if (!collides(solid, b.x, ny, b.z)) {
      b.y = ny;
      continue;
    }
    if (b.vy < 0) {
      b.y = Math.floor(ny) + 1; // land on top of the voxel we hit
      b.onGround = true;
    }
    b.vy = 0;
    break;
  }
}

/** Feet height for standing at (x, z): on top of the highest solid voxel below `fromY`, or 0. */
export function groundBelow(solid: SolidFn, x: number, z: number, fromY: number): number {
  for (let y = Math.floor(fromY); y >= 0; y--) if (solid(Math.floor(x), y, Math.floor(z))) return y + 1;
  return 0;
}
