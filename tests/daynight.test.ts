import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DayNight, dayOfYear } from '../src/render/DayNight';
import { P, meshChunk, paddedIndex } from '../src/world/mesher';
import { M, glowAt, linearPalette } from '../src/world/palette';

const lighting = () => ({
  sun: new THREE.DirectionalLight(),
  hemi: new THREE.HemisphereLight(),
  scene: Object.assign(new THREE.Scene(), { background: new THREE.Color() }),
  fog: new THREE.Fog(0, 1, 2),
  night: { value: 0 },
});

describe('day/night', () => {
  // With no grid rotation, voxel north is -z and east is +x.
  const dn = new DayNight(lighting(), 0);

  it('puts the noon sun in the north, high in summer and low in winter', () => {
    const summer = dn.sunAt(12, 355);
    expect(dn.sunDir.z).toBeLessThan(0); // north
    const winter = dn.sunAt(12, 172);
    expect(summer * (180 / Math.PI)).toBeGreaterThan(70);
    expect(winter * (180 / Math.PI)).toBeLessThan(32);
  });

  it('rises in the east and sets in the west', () => {
    dn.sunAt(8, 80);
    expect(dn.sunDir.x).toBeGreaterThan(0);
    dn.sunAt(16, 80);
    expect(dn.sunDir.x).toBeLessThan(0);
  });

  it('turns the window glow on at night only', () => {
    const l = lighting();
    const d = new DayNight(l, 20);
    d.update(13, 100);
    expect(l.night.value).toBe(0);
    expect(l.sun.castShadow).toBe(true);
    d.update(23, 100);
    expect(l.night.value).toBe(1);
    expect(l.sun.castShadow).toBe(false);
  });

  it('counts days of the year', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1);
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(365);
  });
});

describe('night glow', () => {
  it('always lights shopfronts, never walls, and some windows', () => {
    expect(glowAt(M.SHOPFRONT, 5, 5, 5)).toBe(1);
    expect(glowAt(M.SANDSTONE, 5, 5, 5)).toBe(0);
    let lit = 0, n = 0;
    for (let x = 0; x < 300; x += 3) for (let y = 0; y < 300; y += 3) (lit += glowAt(M.WINDOW_DARK, x, y, 0)), n++;
    expect(lit / n).toBeGreaterThan(0.35);
    expect(lit / n).toBeLessThan(0.55);
  });

  it('keeps lit and unlit faces apart when meshing', () => {
    const vol = new Uint8Array(P * P * P);
    // A long row of window voxels spans several 3-voxel lighting blocks.
    for (let x = 0; x < 30; x++) vol[paddedIndex(x, 4, 4)] = M.WINDOW_DARK;
    const m = meshChunk(vol, linearPalette());
    expect(m.glow.length).toBe(m.vertexCount);
    expect(m.indices.length / 6).toBeGreaterThan(6); // split where lighting changes
    expect(new Set(m.glow)).toEqual(new Set([0, 255]));
  });
});
