import * as THREE from 'three';

const SKY = 0xbfd8ea;
/** Half the height of the orthographic view at zoom 1, in metres. */
export const ORTHO_HALF = 320;
const FOG = { near: 1200, far: 4200 };

/**
 * Renderer, cameras, sky and a sun whose shadow frustum follows the view.
 * DayNight drives the lighting. Renders through the perspective camera, or
 * the orthographic one for isometric "diorama" views.
 */
export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  active: THREE.Camera;
  readonly sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  readonly hemi = new THREE.HemisphereLight(0xdbe9ff, 0x6b5f50, 1.1);
  readonly fog = new THREE.Fog(SKY, FOG.near, FOG.far);
  /** Unit vector towards the sun. */
  readonly sunDir = new THREE.Vector3(-0.45, 0.75, -0.55).normalize();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 8000);
    this.ortho = new THREE.OrthographicCamera(-ORTHO_HALF * aspect, ORTHO_HALF * aspect, ORTHO_HALF, -ORTHO_HALF, 1, 6000);
    this.active = this.camera;
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);

    const s = this.sun.shadow;
    s.mapSize.set(4096, 4096);
    s.camera.left = s.camera.bottom = -450;
    s.camera.right = s.camera.top = 450;
    s.camera.near = 1;
    s.camera.far = 2000;
    s.bias = -0.0004;
    s.normalBias = 0.6;
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => {
      const aspect = container.clientWidth / container.clientHeight;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      this.ortho.left = -ORTHO_HALF * aspect;
      this.ortho.right = ORTHO_HALF * aspect;
      this.ortho.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });
  }

  /** Keep the shadow-casting area centred on what the camera is looking at. */
  followTarget(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 900);
  }

  /** Switch between the perspective and orthographic cameras. Orthographic views have no fog. */
  useOrtho(on: boolean): void {
    this.active = on ? this.ortho : this.camera;
    this.fog.near = on ? 1e5 : FOG.near;
    this.fog.far = on ? 2e5 : FOG.far;
  }

  render(): void {
    this.renderer.render(this.scene, this.active);
  }

  /** Render one frame at `scale` times the screen resolution and return it as a PNG. */
  async capture(scale = 2): Promise<Blob> {
    const r = this.renderer, ratio = r.getPixelRatio();
    const size = r.getSize(new THREE.Vector2());
    // Stay inside the GPU's texture limit.
    const max = r.capabilities.maxTextureSize;
    r.setPixelRatio(Math.min(scale, max / size.x, max / size.y));
    this.render();
    // toBlob snapshots the canvas immediately, so the resolution can be restored before it resolves.
    const pending = new Promise<Blob | null>((ok) => r.domElement.toBlob(ok, 'image/png'));
    r.setPixelRatio(ratio);
    const blob = await pending;
    if (!blob) throw new Error('Could not encode the screenshot');
    return blob;
  }
}
