# Architecture

CityBuilder has two halves that share one file format and one colour palette:

1. **The pipeline** (`pipeline/`, Node + TypeScript, run with `tsx`). It turns open map data into a voxel world: 1 voxel = 1 m, stored as compressed 32³ chunks.
2. **The viewer** (`src/`, Three.js in the browser, built with Vite). It streams those chunks, meshes them in Web Workers and renders the city with lighting, a day/night cycle, trams and several camera modes.

```
place name ──► geocode (Nominatim) ──► cities/<slug>/city.json  (the profile)
                                              │
            ┌─────────────────────────────────┼─────────────────────────────────┐
            ▼                                 ▼                                 ▼
  OpenStreetMap (Overpass)         Terrain Tiles (AWS, global)      optional data sources
  tiles over several servers       zoom-14 PNG elevation            (e.g. City of Melbourne
            │                                 │                       footprints + ground)
            └──────────────► data/cache/<slug>/ + data/cache/dem/ ◄──────────────┘
                                              │
                    build (pipeline/build.ts) ▼
   features ─► terrain ─► ground ─► buildings ─► landmarks ─► trees ─► trams ─► chunks
                                              │
                                              ▼
                         public/cities/<slug>/{manifest.json, r_X_Z.bin, trams.json}
                         public/cities/index.json   (the city picker)
                                              │
                    viewer (src/main.ts)      ▼
   ChunkLoader ─► worker greedy meshing (+AO, LOD) ─► Three.js scene ─► HUD, controls, day/night
```

## Repository layout

```
cities/<slug>/city.json            a city profile (see NEW_CITY.md)
cities/<slug>/landmarks/*.ts       hand-made landmark models (see LANDMARKS.md)
pipeline/
  cli/city.ts                      npm run city: geocode → download → build
  cli/newCity.ts, newLandmark.ts   scaffolding commands
  city/profile.ts                  profile schema, validation, paths
  city/geocode.ts                  Nominatim/Photon lookup → profile
  fetch/overpass.ts                tiled multi-server OSM download, cache
  fetch/dem.ts                     elevation tiles: download, cache, sample
  fetch/http.ts                    fetch with retries, User-Agent
  sources/                         optional data sources (adapter interface + Melbourne footprints)
  geo/project.ts                   lat/lon → grid metres (rotated) → voxels; grid-angle estimation
  model/features.ts                OSM → buildings, roads, rails, areas, trees, piers
  model/heights.ts                 height/levels/type → metres
  model/footprints.ts              Melbourne footprint tiers → buildings
  gen/elevation.ts                 terrain: DEM or surveyed samples → per-column lifts, water levels, sea
  gen/terrain.ts                   ground layer: soil, roads, kerbs, parks, water, piers, rails
  gen/buildings.ts                 extrusion, facades, roofs, rooftop clutter
  gen/facades/*                    facade styles (glass tower, Victorian, Art Deco, warehouse)
  gen/roofShapes.ts                OSM roof:shape → hipped, gabled, dome, onion, cone…
  gen/colours.ts                   OSM colour/material tags → palette
  gen/landmarks/*                  landmark framework: claiming, kit, styles, auto-picking, finding
  gen/vegetation.ts                voxel trees
  gen/tramLines.ts                 tram routes for the animated trams
  io/chunks.ts                     RLE chunks → region files + manifest
  export/exportVox.ts              MagicaVoxel export (CLI)
  build.ts                         orchestration (npm run build:world)
src/
  main.ts                          viewer entry: picks the city, wires everything
  world/chunkFormat.ts             shared file format (manifest, regions, RLE)
  world/palette.ts                 shared material palette
  world/ChunkLoader.ts             region streaming, worker pool, LOD switching
  world/mesher.ts, mesher.worker.ts  greedy meshing with ambient occlusion
  world/lod.ts                     2× downsampled region meshes for distance
  world/vox.ts                     .vox writer (viewer button)
  render/Scene.ts, DayNight.ts, Materials.ts   renderer, sun/sky model, night glow
  actors/Trams.ts                  instanced trams along tram lines
  ui/Hud.ts, Controls.ts, walker.ts  panel, camera modes, first-person physics
scripts/screenshot.ts              Playwright captures
tests/                             vitest unit tests
```

## The pipeline, stage by stage

1. **Projection** (`geo/project.ts`). Lat/lon goes to metres with an equirectangular projection around the profile's origin (accurate to well under a voxel over a few km). Then everything is rotated by the street grid's bearing, so the main streets run exactly along the voxel axes. That single step removes stair-stepping on the streets, the biggest visual win.
   - **Grid angle:** each street segment's bearing is folded into ±45°, length-weighted into 1° bins and smoothed; the peak is refined with a local mean.
   - **Voxel frame:** x grows along the grid, z grows towards the south edge, y is up.
2. **Features** (`model/features.ts`). OSM elements become typed features:
   - multipolygon relations are assembled into rings;
   - `building:part` children hide their outline;
   - underground things (tunnels, negative levels) are skipped;
   - roads get widths from city rules, then tags, then class;
   - woods get scattered trees.
3. **Terrain** (`gen/elevation.ts`). This is a per-column "lift" in voxels.
   - **From the elevation model:** samples on an 8 m grid, then a minimum filter over ±24 m strips buildings and trees that leak into it.
   - **From a data source:** surveyed points are interpolated (inverse-distance weighting).
   - **Water bodies** are pinned flat at their own level.
   - **The sea** is detected from the model's bathymetry (below −1.5 m).
   - **Datum:** the lowest water (or sea level) becomes lift 0, and the result is smoothed.
4. **Ground** (`gen/terrain.ts`):
   - soil down to the lowest neighbour (no holes on slopes);
   - footpaths everywhere, then parks, plazas and sand;
   - road corridors, then carriageways (so a cross street's footpath never paints over an intersection), with kerbs where footpath meets asphalt;
   - water at each body's level with stone banks, and piers;
   - bridges with decks ramped between their ends' ground heights;
   - rails and tram tracks laid on whatever surface is there.
5. **Buildings** (`gen/buildings.ts`). Each footprint is rasterised, with a distance-to-edge field.
   - **Base:** the building stands on the lowest ground under it, with stone foundations where the slope falls away.
   - **Style:** chosen from height, `start_date` and type, then recoloured by `building:colour`/`material` tags.
   - **Walls:** generated per voxel from the style, with the window rhythm following each wall.
   - **Roofs:** shaped by `roof:shape`, otherwise flat with rooftop plant, tanks and parapets.
   - **Determinism:** random choices are seeded from the OSM id, so builds are repeatable.
6. **Landmarks** (`gen/landmarks/`):
   - models claim footprints first, then restyle them, drop them, or add modelled forms after generation;
   - the jump list combines the profile's landmarks and auto-picked notable buildings;
   - each landmark's position and height are read back from the voxels.
7. **Trees and trams.** Voxel trees go on OSM tree nodes and rows, and in woods. Tram tracks are chained into continuous routes and sampled on the track surface, so trams follow the terrain.
8. **Output** (`io/chunks.ts`):
   - non-empty 32³ chunks are run-length encoded and grouped into 4×4-column region files;
   - a `manifest.json` lists the regions, landmarks, origin, grid angle, city name/latitude and attribution;
   - the world is built in a tall sparse store, and the manifest records the height actually used.

## The viewer

- **Loading** (`world/ChunkLoader.ts`):
  - regions are fetched nearest-first;
  - every region first gets a **coarse mesh**: 2× downsampled, where a cell is solid if ≥ 4 of its 8 voxels are, with the most common colour of its outward-facing voxels so facades keep their look;
  - regions within ~650 m then get **full-detail** per-chunk meshes in a `THREE.LOD` that switches at 500 m;
  - in diorama mode, detail is measured from the target, since the orthographic camera sits far away.
- **Meshing** (`world/mesher.ts`, in a pool of Web Workers):
  - greedy meshing merges coplanar faces of the same material and ambient occlusion;
  - per-vertex ambient occlusion is baked in (the classic 0–3 corner rule), which is essential to the voxel look;
  - clear glass goes into a separate transparent mesh;
  - a glow attribute marks windows that light up at night.
- **Rendering:**
  - Lambert shading with vertex colours;
  - one shadow-casting sun whose shadow frustum follows the camera's target;
  - hemisphere fill and distance fog;
  - `DayNight` computes the sun's position from the city's latitude, the date and the hour, and drives the sky colour, light and window glow.
- **Controls:** orbit (`OrbitControls`), fly, walk, and an orthographic diorama camera. Walking uses `ui/walker.ts`: a 0.6 × 1.8 m box against the voxels, with sliding, step-up, jumping and sub-stepping.

## File formats

- **Region file** (`r_X_Z.bin`, little-endian): the magic `VXR1` and a chunk count (uint32 each), then each chunk as `cx, cy, cz` (uint16) + RLE length (uint32) + RLE bytes.
  - RLE is pairs of (run length, material), with runs up to 255.
  - Chunk voxel index = `x | z << 5 | y << 10`.
- **Manifest:** see `WorldManifest` in `src/world/chunkFormat.ts`.
- **Palette:** `src/world/palette.ts` is the single source of truth; index 0 is air. Adding a material is one line, but rebuild cities afterwards, since indices shift.

## Why it's fast

- **Downloads:**
  - Tiles are spread over several Overpass servers, one query per server at a time (their limit), with cool-downs and re-queuing instead of aborting.
  - One light street query fixes the grid angle first, so the main download covers the tight rotated box (about half the area of a box covering every rotation).
  - Everything is cached. A cached download is reused whenever it covers the requested area, and elevation tiles are shared by all cities.
- **The build:**
  - Sparse chunk storage.
  - Per-building rasterisation on small masks.
  - Distance fields computed once per footprint.
  - Melbourne's 3.4 km² builds in about 12 s.
- **The viewer:**
  - Worker meshing in parallel.
  - Coarse meshes for the whole city first (it appears in seconds), then detail near the camera.
  - Greedy meshing cuts triangle counts several-fold.
  - The LOD halves the triangles drawn.
- **Iteration:** `--preview` builds the middle 600 m in a couple of seconds; `build:world` never touches the network.

## Extending

| To add | Where |
|---|---|
| A city | `cities/<slug>/city.json` (`npm run new-city`) |
| A landmark | `cities/<slug>/landmarks/` (`npm run new-landmark`) |
| A data source | `pipeline/sources/` + register in `index.ts` |
| A facade style | `pipeline/gen/facades/` + choose it in `chooseStyle` (`facades/index.ts`) |
| A roof shape | `pipeline/gen/roofShapes.ts` |
| A material | `src/world/palette.ts` |
| A viewer feature | `src/` (expose state on `window` for `scripts/screenshot.ts` to drive) |

Run `npm test` and `npm run typecheck` after changes. CI runs both on Linux and Windows.
