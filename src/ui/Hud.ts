import type { CityIndexEntry, Landmark, WorldManifest } from '../world/chunkFormat';
import { CAMERA_MODES, type CameraMode } from './Controls';

/** Time of day in hours (0–24), and whether it is advancing. */
export interface TimeControl {
  hours: number;
  playing: boolean;
}

const HELP: Record<CameraMode, string> = {
  orbit: 'Drag to orbit · right-drag or arrow keys to pan · scroll to zoom',
  fly: 'WASD to fly · Q/E down/up · drag to look · Shift for speed',
  walk: 'WASD to walk · Space to jump · drag to look · Shift to run',
  diorama: 'Isometric view · R to turn · drag or arrow keys to pan · scroll to zoom',
};

const fmt = (h: number) => {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Title, landmark jump list, time of day, load progress and data attribution. */
export class Hud {
  private readonly progress: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly clock: HTMLElement;
  private readonly help: HTMLElement;
  private readonly modeButtons: HTMLButtonElement[];

  constructor(
    root: HTMLElement,
    manifest: WorldManifest,
    onLandmark: (l: Landmark) => void,
    private readonly time: TimeControl,
    onExport: () => void,
    onMode: (mode: CameraMode) => void,
    onPhoto: () => void,
    city: { name: string; slug: string; cities: CityIndexEntry[] },
  ) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <h1></h1>
      ${city.cities.length > 1 ? '<label>City <select class="city"></select></label>' : ''}
      ${manifest.source === 'synthetic' ? '<p class="warn">Synthetic stand-in data: street grid is real, buildings are not. Run <code>npm run fetch:osm</code> for the real city.</p>' : ''}
      <label>Jump to <select><option value="">Landmark…</option></select></label>
      <div class="time"><button type="button" title="Play or pause the day">▶</button>
        <input type="range" min="0" max="24" step="0.05" aria-label="Time of day"><span class="clock"></span></div>
      <div class="modes" role="group" aria-label="Camera mode">${CAMERA_MODES.map(
        (m, i) => `<button type="button" data-mode="${m}" title="${m[0].toUpperCase() + m.slice(1)} (key ${i + 1})">${m[0].toUpperCase() + m.slice(1)}</button>`,
      ).join('')}</div>
      <div class="actions">
        <button type="button" class="photo" title="Save a PNG of the view at twice screen resolution (P). H hides this panel.">Save PNG</button>
        <button type="button" class="export" title="Download a MagicaVoxel .vox of the 240 m around the view">Export .vox</button>
      </div>
      <p class="progress"></p>
      <p class="help"></p>
      <p class="attribution"></p>`;
    root.appendChild(el);

    const title = el.querySelector('h1')!;
    title.textContent = `${city.name} `;
    title.insertAdjacentHTML('beforeend', '<span>voxel</span>');
    const picker = el.querySelector<HTMLSelectElement>('select.city');
    if (picker) {
      for (const c of city.cities) picker.add(new Option(c.name, c.slug, false, c.slug === city.slug));
      picker.addEventListener('change', () => {
        const q = new URLSearchParams(location.search);
        q.set('city', picker.value);
        location.search = q.toString();
      });
    }

    const select = el.querySelector<HTMLSelectElement>('select:not(.city)')!;
    const sorted = [...manifest.landmarks].sort((a, b) => a.name.localeCompare(b.name));
    for (const l of sorted) select.add(new Option(l.name, l.name));
    select.addEventListener('change', () => {
      const l = sorted.find((x) => x.name === select.value);
      if (l) onLandmark(l);
    });

    this.slider = el.querySelector('.time input')!;
    this.clock = el.querySelector('.time .clock')!;
    const play = el.querySelector<HTMLButtonElement>('.time button')!;
    this.slider.addEventListener('input', () => {
      this.time.hours = parseFloat(this.slider.value);
      this.showTime();
    });
    play.addEventListener('click', () => {
      this.time.playing = !this.time.playing;
      play.textContent = this.time.playing ? '❚❚' : '▶';
    });
    this.showTime();

    el.querySelector<HTMLButtonElement>('.export')!.addEventListener('click', onExport);
    el.querySelector<HTMLButtonElement>('.photo')!.addEventListener('click', onPhoto);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'KeyH') el.hidden = !el.hidden;
      if (e.code === 'KeyP') onPhoto();
    });

    this.help = el.querySelector('.help')!;
    this.modeButtons = [...el.querySelectorAll<HTMLButtonElement>('.modes button')];
    for (const b of this.modeButtons) b.addEventListener('click', () => onMode(b.dataset.mode as CameraMode));
    this.showMode('orbit');

    el.querySelector('.attribution')!.textContent = manifest.attribution;
    this.progress = el.querySelector('.progress')!;
  }

  /** Reflect the current time in the slider and clock. */
  showTime(): void {
    this.slider.value = String(this.time.hours);
    this.clock.textContent = fmt(this.time.hours);
  }

  /** Highlight the active camera mode and show its key help. */
  showMode(mode: CameraMode): void {
    for (const b of this.modeButtons) b.classList.toggle('active', b.dataset.mode === mode);
    this.help.textContent = HELP[mode];
  }

  setProgress(loaded: number, total: number): void {
    this.progress.textContent = loaded < total ? `Building city… ${loaded}/${total} regions` : '';
  }
}

export function showError(root: HTMLElement, html: string): void {
  const el = document.createElement('div');
  el.className = 'hud error';
  el.innerHTML = html;
  root.appendChild(el);
}
