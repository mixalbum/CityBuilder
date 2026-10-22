import * as THREE from 'three';

export interface CityMaterial {
  material: THREE.MeshLambertMaterial;
  /** 0 by day, 1 at night: scales the warm glow of lit windows. */
  night: { value: number };
}

/** Warm interior light seen through lit windows at night. */
const GLOW_COLOR = new THREE.Color(1.0, 0.62, 0.26);

/**
 * Vertex-coloured Lambert material plus a per-vertex `glow` attribute that
 * adds warm emissive light at night.
 */
export function createCityMaterial(): CityMaterial {
  const night = { value: 0 };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.uniforms.uGlowColor = { value: GLOW_COLOR };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uNight;\nuniform vec3 uGlowColor;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, uGlowColor * 0.9, vGlow * uNight * 0.85);\n#include <opaque_fragment>');
  };
  return { material, night };
}
