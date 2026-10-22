import * as THREE from 'three';
import { Trams } from './actors/Trams';
import { DayNight, dayOfYear } from './render/DayNight';
import { CityScene } from './render/Scene';
import { CityControls } from './ui/Controls';
import { Hud, showError, type TimeControl } from './ui/Hud';
import { ChunkLoader } from './world/ChunkLoader';
import type { CityIndexEntry, WorldManifest } from './world/chunkFormat';
import { exportVox } from './world/vox';
import './style.css';

/** A JSON file from the site, or undefined when missing (the dev server answers missing files with index.html). */
async function fetchJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url);
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) return undefined;
  return (await res.json()) as T;
}

const NO_CITIES =
  '<h1>No cities built yet</h1><p>Build one, then reload:</p><p><code>npm run city -- "Wellington, New Zealand"</code></p>' +
  '<p>See the README for details.</p>';

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const params = new URLSearchParams(location.search);

  // Which city: ?city=<slug>, else the first one built.
  const cities = (await fetchJson<CityIndexEntry[]>('cities/index.json')) ?? [];
  const slug = params.get('city') ?? cities[0]?.slug;
  if (!slug) {
    showError(app, NO_CITIES);
    return;
  }
  const WORLD_URL = `cities/${encodeURIComponent(slug)}`;
  const found = await fetchJson<WorldManifest>(`${WORLD_URL}/manifest.json`);
  if (!found) {
    const known = cities.map((c) => `<a href="?city=${c.slug}">${c.name}</a>`).join(', ');
    showError(
      app,
      `<h1>No city "${slug.replace(/</g, '&lt;')}"</h1><p>Build it with <code>npm run city -- ${slug.replace(/</g, '&lt;')}</code>, then reload.</p>` +
        (known ? `<p>Built so far: ${known}</p>` : ''),
    );
    return;
  }
  const manifest: WorldManifest = found;
  const cityName = manifest.city?.name ?? slug;
  document.title = `${cityName} · CityBuilder`;

  const city = new CityScene(app);
  const loader = new ChunkLoader(WORLD_URL, manifest);
  city.scene.add(loader.group);
  // Walking collides with every voxel; below the world counts as solid ground.
  const voxels = loader.voxelSource();
  const controls = new CityControls(
    city.camera,
    city.renderer.domElement,
    (x, y, z) => y < 0 || voxels.get(x, y, z) !== 0,
    city.ortho,
  );
  const [ox, oz] = manifest.originVoxel;
  const gy = manifest.originGround ?? manifest.groundY;
  controls.target.set(ox, gy, oz);
  city.camera.position.set(ox + 420, gy + 380, oz + 460);

  // Time of day: ?time=21.5 in the URL, else late afternoon. One hour passes every 4 s when playing.
  const time: TimeControl = { hours: parseFloat(params.get('time') ?? '') || 16.5, playing: false };
  const doy = dayOfYear(new Date());
  const dayNight = new DayNight({ sun: city.sun, hemi: city.hemi, scene: city.scene, fog: city.fog, night: loader.night }, manifest.gridAngleDeg, manifest.city?.lat);

  const hud = new Hud(
    app,
    manifest,
    (l) => controls.flyTo(new THREE.Vector3(l.x, (l.ground ?? gy) + l.height * 0.45, l.z), l.height),
    time,
    () => downloadVox(),
    (mode) => controls.setMode(mode),
    () => savePhoto(),
    { name: cityName, slug, cities },
  );
  controls.onModeChange = (mode) => {
    hud.showMode(mode);
    city.useOrtho(mode === 'diorama');
  };

  /** Save the view (without the HUD) as a PNG at twice screen resolution. */
  async function savePhoto(): Promise<void> {
    const blob = await city.capture(2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const hhmm = `${String(Math.floor(time.hours)).padStart(2, '0')}${String(Math.floor((time.hours % 1) * 60)).padStart(2, '0')}`;
    a.download = `${slug}-${controls.mode}-${hhmm}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  /** Save a .vox of the 240 m square around the camera target. */
  const VOX_HALF = 120;
  function downloadVox(): void {
    const src = loader.voxelSource();
    const t = controls.target;
    const area = {
      x0: Math.max(0, Math.round(t.x) - VOX_HALF),
      z0: Math.max(0, Math.round(t.z) - VOX_HALF),
      x1: Math.min(manifest.size[0], Math.round(t.x) + VOX_HALF),
      z1: Math.min(manifest.size[2], Math.round(t.z) + VOX_HALF),
    };
    const { bytes, stats } = exportVox(src, { ...area, y0: 0, y1: src.topIn(area) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    a.download = `${slug}-${area.x0}-${area.z0}.vox`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    console.info(`Exported ${stats.voxels} voxels in ${stats.models} models (${(stats.bytes / 1e6).toFixed(1)} MB)`);
  }
  loader.onProgress = (n, total) => hud.setProgress(n, total);
  hud.setProgress(0, manifest.regions.length);
  loader.loadAll([ox, oz]).catch((err) => showError(app, `<h1>Load failed</h1><p>${String(err)}</p>`));

  let trams: Trams | undefined;
  if (manifest.trams)
    fetch(`${WORLD_URL}/${manifest.trams}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { lines: number[][] }) => {
        trams = new Trams(data.lines, loader.material);
        city.scene.add(trams.group);
      })
      .catch((err) => console.warn('No trams:', err));

  // Expose for debugging and screenshot automation.
  const setTime = (h: number) => {
    time.hours = ((h % 24) + 24) % 24;
    hud.showTime();
  };
  Object.assign(window, { city, controls, loader, manifest, setTime, getTrams: () => trams });

  const clock = new THREE.Clock();
  city.renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (time.playing) setTime(time.hours + dt / 4);
    dayNight.update(time.hours, doy);
    trams?.update(dt);
    loader.update(controls.viewpoint);
    if (dayNight.sunDir.y > 0) city.sunDir.copy(dayNight.sunDir);
    controls.update(dt);
    city.followTarget(controls.target);
    city.render();
  });
}

main().catch((err) => {
  console.error(err);
  const msg = String(err instanceof Error ? err.message : err).replace(/</g, '&lt;');
  showError(
    document.getElementById('app')!,
    `<h1>Could not start</h1><p>${msg}</p><p>The viewer needs WebGL 2: check that hardware acceleration is on in your browser's settings.</p>`,
  );
});
