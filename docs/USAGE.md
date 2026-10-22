# Using CityBuilder

Two parts:
- **The pipeline** (`npm run …` commands) turns map data into a voxel city.
- **The viewer** (`npm run dev`, then a browser) lets you explore it.

## The viewer

Start it with `npm run dev` and open **http://localhost:5173**. The city appears in a few seconds, first in coarse blocks, then in full detail near the camera.

### Camera modes

Switch with the panel buttons or the number keys.

| Key | Mode | Controls |
|---|---|---|
| **1** | **Orbit** (default) | Drag to orbit · right-drag or arrow keys to pan · scroll to zoom |
| **2** | **Fly** | W A S D to move · Q / E down and up · drag to look · Shift for speed |
| **3** | **Walk** | W A S D to walk · Space to jump · drag to look · Shift to run |
| **4** | **Diorama** | Isometric view · R to turn 90° (Shift+R the other way) · drag or arrow keys to pan · scroll to zoom |

- **Walk** puts you at street level where the orbit camera was looking. If that point is inside a building, you start on its roof. You collide with buildings, trees and trams, and climb kerbs and steps automatically.
- **Fly** has no collision, so you can fly through buildings.
- **Diorama** uses an orthographic camera at the true isometric angle, lined up with the street grid: the classic voxel-diorama look.

### The panel

- **City:** switch between the cities you've built (shown once there are two or more).
- **Jump to:** fly to a landmark. The list comes from the city's profile plus notable buildings picked automatically.
- **Time of day:** drag the slider, or press ▶ to run the day (an hour every 4 seconds). The sun follows the city's real latitude and today's date. After dark, windows, shopfronts and trams light up.
- **Save PNG** (or **P**): saves the view at twice screen resolution, without the panel.
- **Export .vox:** downloads a [MagicaVoxel](https://ephtracy.github.io/) file of the 240 m square around the view.
- **H** hides or shows the panel, for clean screenshots of your own.

### URL options

| Parameter | Effect | Example |
|---|---|---|
| `city` | Which city to open | `?city=wellington` |
| `time` | Time of day to open at (hours) | `?time=21.5` |

They combine: `http://localhost:5173/?city=melbourne&time=19`.

### Performance

- **Graphics card:** the viewer runs well on any laptop with a graphics chip from the last few years. In Chrome or Edge, check Settings → System → "Use graphics acceleration when available".
- **On laptops:** plug in, and make sure the browser uses the dedicated GPU (Windows: Settings → System → Display → Graphics → set the browser to "High performance").
- **Big cities** (4 km and up) take longer to appear. Distant areas use coarse meshes, so the frame rate stays reasonable.

## The pipeline commands

All commands run from the project folder. On Windows PowerShell, write `npm.cmd` instead of `npm` if scripts are blocked.

### `npm run city` — download and build in one step

```bash
npm run city -- "Wellington, New Zealand"         # look a place up, download its data, build it
npm run city -- wellington                         # rebuild a city you already have (no downloads)
npm run city -- "Prague Old Town" --size 1500      # choose the size (metres, square)
npm run city -- "Barcelona" --width 2400 --depth 1600
npm run city -- --center 40.7484,-73.9857 --name "Midtown Manhattan" --size 2500
npm run city -- wellington --preview               # build only the middle 600 m, in seconds
npm run city -- wellington --force                 # download the map data again
npm run city -- wellington --flat                  # ignore terrain
npm run city -- "Oslo" --no-build                  # download only
npm run city -- "Oslo" --endpoint https://overpass.private.coffee/api/interpreter   # use a particular Overpass server
```

What it does:
1. **Finds the place** with OpenStreetMap's Nominatim geocoder, unless the name is a city you already have. It writes `cities/<name>/city.json`.
2. **Settles the street grid's angle** with one light query, so the city's streets line up with the voxel grid and the main download stays small.
3. **Downloads in parallel:** OpenStreetMap data (split into tiles across several Overpass servers), elevation tiles, and any extra data sources the profile lists. Everything is cached in `data/cache/`, so later builds are offline and fast.
4. **Builds** the voxels and writes them to `public/cities/<name>/`.

Size guide (1 voxel = 1 m):

| Size | Build time* | Download | Built city | Notes |
|---|---|---|---|---|
| 1 × 1 km | ~5 s | ~1 min | ~5 MB | A neighbourhood |
| 2 × 2 km | ~15 s | 2–5 min | ~20 MB | A city centre (the default) |
| 3 × 3 km | ~40 s | 5–10 min | ~60 MB | Most downtowns |
| 6 × 6 km | ~3 min | 20–40 min | ~250 MB | The maximum; needs 6+ GB RAM |

\* Rough figures for a dense city centre on a typical laptop, after downloading. Melbourne's 2.2 × 1.5 km CBD builds in about 12 s and comes to 24 MB. Download times depend entirely on how busy the public Overpass servers are.

### `npm run new-city` — create a profile without building

```bash
npm run new-city -- "Kyoto Station, Japan" --size 1800
```

This writes `cities/<name>/city.json` only, so you can edit it first (see [NEW_CITY.md](NEW_CITY.md)) and then run `npm run city -- <name>`.

### `npm run build:world` — rebuild from cached data

```bash
npm run build:world -- wellington            # full build
npm run build:world -- wellington --preview  # the middle 600 m only
npm run build:world -- melbourne --synthetic # offline demo grid, no downloads at all
```

Use this while tuning a profile or modelling landmarks. It never touches the network.

### `npm run new-landmark` — start a hand-made landmark model

```bash
npm run new-landmark -- wellington "Old St Paul's"
```

This finds the building in the city's map data and writes `cities/wellington/landmarks/oldStPauls.ts`. The model already takes over that building; you then add domes, spires, columns and so on. See [LANDMARKS.md](LANDMARKS.md).

### `npm run export:vox` — MagicaVoxel files

```bash
npm run export:vox -- melbourne --landmark "Flinders Street Station"   # 240 m square around it
npm run export:vox -- melbourne --landmark "Eureka Tower" --radius 60
npm run export:vox -- wellington --centre                               # around the city's centre
npm run export:vox -- wellington --bbox 800,700,1200,1100               # voxel x0,z0,x1,z1
npm run export:vox -- wellington --all                                  # everything (very large)
npm run export:vox -- wellington --centre --solid                       # keep hidden interior voxels
```

Files go to `exports/`. Areas larger than 256 voxels are split into several models in one scene, laid out in place. MagicaVoxel's world limit is 2048 voxels, so bigger areas are trimmed to the central 2 km.

### `npm run screenshots` — captures for READMEs and checking

```bash
npm run dev                                              # in one terminal
npm run screenshots -- wellington                        # all views → screenshots/wellington/
npm run screenshots -- wellington --views overview,diorama,night
```

Every city gets these views: `overview`, `centre`, `dusk`, `night`, `diorama`, and an `lm-<name>` view for each landmark. A profile's `views` list adds or replaces views (see [NEW_CITY.md](NEW_CITY.md#screenshot-views)). The first run may ask you to `npx playwright install chromium`.

### Development

```bash
npm test             # unit tests (vitest)
npm run typecheck    # TypeScript
npm run build        # production build of the viewer into dist/ (static files: host anywhere)
npm run preview      # serve dist/ locally
```

## Hosting your cities

`npm run build` produces a static site in `dist/` that includes every built city. Copy it to any static host (GitHub Pages, Netlify, an S3 bucket, a USB stick with `npx serve dist`). [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md) explains the ready-made GitHub Pages workflow that builds every city in `cities/` and publishes them.
