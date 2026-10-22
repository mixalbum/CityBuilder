import { describe, expect, it } from 'vitest';
import { WALKER, collides, groundBelow, stepWalker, type Body, type SolidFn } from '../src/ui/walker';

/** Flat ground at y=0 plus extra solid voxels. */
function world(extra: [number, number, number][] = []): SolidFn {
  const set = new Set(extra.map((v) => v.join()));
  return (x, y, z) => y === 0 || set.has(`${x},${y},${z}`);
}

const body = (x: number, y: number, z: number): Body => ({ x, y, z, vy: 0, onGround: true });

function walk(b: Body, solid: SolidFn, dx: number, dz: number, seconds: number, jump = false) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepWalker(b, solid, dx * dt, dz * dt, jump, dt);
}

describe('walker', () => {
  it('stands on the ground', () => {
    const b = body(5.5, 3, 5.5);
    b.onGround = false;
    walk(b, world(), 0, 0, 1);
    expect(b.y).toBe(1);
    expect(b.onGround).toBe(true);
  });

  it('is blocked by a wall taller than a step', () => {
    const wall: [number, number, number][] = [];
    for (let z = 0; z < 12; z++) for (let y = 1; y <= 3; y++) wall.push([8, y, z]);
    const b = body(5.5, 1, 5.5);
    walk(b, world(wall), 4, 0, 2);
    expect(b.x).toBeLessThan(8 - WALKER.radius + 1e-6);
    expect(b.x).toBeGreaterThan(7.5);
  });

  it('climbs a one-voxel kerb', () => {
    const kerb: [number, number, number][] = [];
    for (let x = 8; x < 20; x++) for (let z = 0; z < 12; z++) kerb.push([x, 1, z]);
    const b = body(5.5, 1, 5.5);
    walk(b, world(kerb), 4, 0, 2);
    expect(b.x).toBeGreaterThan(9);
    expect(b.y).toBe(2);
  });

  it('slides along a wall when moving diagonally', () => {
    const wall: [number, number, number][] = [];
    for (let z = 0; z < 30; z++) for (let y = 1; y <= 3; y++) wall.push([8, y, z]);
    const b = body(5.5, 1, 5.5);
    walk(b, world(wall), 4, 4, 1);
    expect(b.z).toBeGreaterThan(8);
  });

  it('jumps and lands again', () => {
    const b = body(5.5, 1, 5.5);
    stepWalker(b, world(), 0, 0, true, 1 / 60);
    expect(b.y).toBeGreaterThan(1);
    walk(b, world(), 0, 0, 2);
    expect(b.y).toBe(1);
  });

  it('does not tunnel through thin walls at speed', () => {
    const wall: [number, number, number][] = [];
    for (let z = 0; z < 12; z++) for (let y = 1; y <= 3; y++) wall.push([8, y, z]);
    const b = body(5.5, 1, 5.5);
    stepWalker(b, world(wall), 10, 0, false, 1 / 60);
    expect(b.x).toBeLessThan(8);
  });

  it('finds the ground under a point', () => {
    const solid = world([[3, 1, 3], [3, 2, 3]]);
    expect(groundBelow(solid, 3.5, 3.5, 50)).toBe(3);
    expect(groundBelow(solid, 0.5, 0.5, 50)).toBe(1);
    expect(collides(solid, 3.5, 1, 3.5)).toBe(true);
  });
});
