# Plan: Voxel Art Melbourne CBD (`city_plan`)

## Progress
- [x] **Phase 1:** scaffold, Overpass fetcher with retries, projection with grid-angle estimation, feature normalisation and underground filtering. There is also a synthetic stand-in dataset for offline builds.
- [x] **Real data:** builds from OSM plus City of Melbourne 2023 footprints (tiered massing). Landmarks are found by name, alias or coordinate.
- [x] **Phase 2:** sparse chunked world, rasterisation, RLE region files and manifest.
- [~] **Phase 3:** footpaths, roads, kerbs, laneway cobbles, parks, the Yarra with banks, bridges, tram tracks and rail. *Still to do:* lane markings, zebra crossings, Hosier Lane graffiti, superstops.
- [~] **Phase 4:** real tiered heights from footprints, four facade styles, parapets, pitched roofs, AC units, chimneys, tram stop shelters, platforms and jetties. Terrain is done: it comes from the footprints' surveyed ground elevations, with bluestone foundations on slopes and ramped bridge decks. *Still to do:* verandahs and water tanks.
- [x] **Phase 5:** 18 hand-tuned landmarks, modelled over their real footprint tiers with a modelling kit (lathe, dome, spire, gable, columns, clock faces, paving) and a shared classical facade builder: Flinders Street Station, St Paul's, Federation Square, State Library, Arts Centre spire, Eureka, Melbourne Central cone, Southern Cross roof, Parliament House, Princess Theatre, Old Treasury, GPO, Block Arcade, Town Hall, Manchester Unity, Hamer Hall, Young & Jackson and Princes Bridge.
- [~] **Phase 6:** procedural plane and elm trees. *Still to do:* street furniture.
- [x] **Phase 7:** worker greedy meshing with AO, merged region meshes, shadows, orbit controls and the landmark HUD. Day/night cycle with lit windows, trams on the real routes, and translucent glass are done. LOD is done too: each region first gets a 2×-downsampled coarse mesh, and regions within about 650 m then get full detail, which switches in under 500 m. This brings visible triangles from about 8M to about 3.4M, and the whole city shows in about half the time. Fly and walk camera modes are done (keys 1/2/3 or the HUD): walking collides with the voxels and climbs kerbs and steps.
- [x] **Phase 8:** a GitHub Pages deploy workflow is ready but off until enabled. `.vox` export is done, from the viewer and the command line. Screenshot mode is done: an isometric orthographic "diorama" camera, PNG capture at 2× resolution, and a hideable HUD.

## Context
You want a detailed voxel-art model of Melbourne's CBD that you can explore in a web browser. There's no existing code (`city_plan` is empty or not created yet), so this is a greenfield project. The model should be recognisable rather than only procedural. It should get the real street grid, building footprints and heights from OpenStreetMap, hand-tune the famous landmarks, and add the Melbourne details that make it read as Melbourne: the Hoddle Grid, trams, laneways, the Yarra, and plane trees on Collins St.

**Default stack (change it if you prefer):** TypeScript, Vite and Three.js in the browser, with an offline Node/TS data pipeline that bakes voxel chunks into static binary files. The site can be hosted anywhere static (GitHub Pages).

## Scope / extent
- **Core:** the Hoddle Grid, bounded by Flinders St, Spring St, La Trobe St and Spencer St (about 1.6 km × 0.8 km).
- **Margin:** the Yarra and the Southbank edge (Eureka Tower, Arts Centre spire), Birrarung Marr, Flagstaff Gardens, and Treasury/Fitzroy Gardens edge, plus the Southern Cross Station roof.
- Approximate bbox: lat −37.8240 to −37.8040, lon 144.9480 to 144.9760.
- **Voxel size:** 1 m, with a 0.5 m "detail" pass for landmarks only (see Phase 5). The tallest structure is Australia 108 at about 317 m, so the world is about 2400 × 2200 × 320 voxels. It's sparse, so it's stored as chunks.

## Repo layout
```
city_plan/
  package.json, tsconfig.json, vite.config.ts
  pipeline/                 # offline Node scripts (tsx)
    fetch/overpass.ts       # download OSM -> data/raw/osm.json (cached)
    fetch/heights.ts        # optional: merge City of Melbourne 3D massing / open data heights
    geo/project.ts          # lat/lon -> local metres; rotate so Hoddle Grid aligns to axes
    model/features.ts       # normalise OSM -> Building, Road, Rail, Water, Park, Tree types
    model/heights.ts        # height resolution: height tag > levels*3.4m > type default
    voxel/world.ts          # sparse chunked voxel store (32³ chunks, Uint8 palette idx)
    voxel/rasterize.ts      # polygon scanline fill, polyline thick-draw, extrusion
    gen/terrain.ts          # ground, kerbs, footpaths, road paint, tram tracks
    gen/buildings.ts        # extrude footprints + facade/roof generators
    gen/facades/*.ts        # style generators: glassTower, victorian, artDeco, warehouse
    gen/roofs.ts            # flat roofs with plant rooms, AC units, water tanks, parapets
    gen/vegetation.ts       # street trees (plane, elm), park lawns, garden beds
    gen/water.ts            # Yarra river + banks
    gen/landmarks/*.ts      # per-landmark procedural builders OR .vox importers
    io/vox.ts               # MagicaVoxel .vox reader (for hand-made landmarks)
    io/chunks.ts            # write chunk binaries + manifest.json
    build.ts                # orchestrates full pipeline
  assets/landmarks/*.vox    # optional hand-authored models
  data/                     # raw + cache (gitignored), public/chunks/ output
  src/                      # browser viewer
    main.ts
    world/ChunkLoader.ts    # fetch manifest + chunk files, LRU cache
    world/mesher.worker.ts  # greedy meshing + per-vertex AO in Web Worker
    world/palette.ts        # shared colour/material palette (also used by pipeline)
    render/Scene.ts         # renderer, lights, fog, sky, post (SSAO optional)
    render/DayNight.ts      # sun path, emissive windows at night
    render/Materials.ts     # vertex-colour material, emissive + water shaders
    actors/Trams.ts         # instanced voxel W-class / E-class trams along tram lines
    actors/Traffic.ts       # simple instanced cars/pedestrians (stretch)
    ui/Controls.ts          # orbit + fly + street-level walk modes
    ui/Hud.ts               # landmark jump list, time-of-day slider, attribution
  tests/                    # vitest unit tests
```
`palette.ts` is shared by the pipeline and the viewer, so the material indices match exactly.

## Phases

### Phase 1: Skeleton and data
1. Scaffold Vite + TS + Three.js, vitest, eslint/prettier, and `tsx` for pipeline scripts.
2. `overpass.ts` queries the bbox for `building`, `building:part`, `highway`, `railway` (including `tram`), `waterway`/`natural=water`, `leisure=park`, `landuse`, `natural=tree` and `bridge`. It caches the result to `data/raw/osm.json`, so we query Overpass once.
3. `project.ts` uses an equirectangular projection around the origin (Flinders/Swanston corner). It then rotates by the Hoddle Grid bearing (about 20.6°, measured from Collins St), so streets line up with the voxel axes. This removes stair-step aliasing on the main streets, which is the single biggest visual win.
4. `features.ts` merges multipolygons with holes and attaches `building:part` to its parent.

### Phase 2: Voxel core
1. `world.ts` holds a `Map<chunkKey, Uint8Array(32³)>` with `get/set/fillBox/fillColumn`. Index 0 is air.
2. `rasterize.ts` provides even-odd scanline polygon fill (which handles courtyards and holes), thick polyline drawing for roads and rails, and `extrude(polygon, z0, z1, materialFn(x,y,z,edgeInfo))`.
3. `io/chunks.ts` RLE-compresses each chunk and writes `public/chunks/{cx}_{cy}_{cz}.bin` plus a `manifest.json` with bounds and non-empty chunk keys.

### Phase 3: Ground layer
- Road widths come from the `width`/`lanes` tags. The defaults are 30 m (99 ft) for the main Hoddle streets (Collins, Bourke, Lonsdale, Flinders, La Trobe, Swanston, Elizabeth, King, William, Queen, Russell, Exhibition, Spring, Spencer) and 10 m for the "little" streets (Little Collins and similar).
- Layers: asphalt, raised kerb, footpath (bluestone grey), lane markings and zebra crossings, and tram tracks as two darker voxel lines with tram superstops on Swanston, Collins and Bourke.
- Laneways (`highway=service|footway`, `name~Lane|Place|Alley`) get bluestone cobbles. Hosier Lane and AC/DC Lane get a multicolour "graffiti" palette on the adjacent walls.
- The Yarra uses an animated water material with sloped banks. It includes Princes Bridge, Sandridge Bridge and Southbank promenade decking.
- Parks get a lawn palette with paths. The Flinders St railyards get ballast and track voxels.

### Phase 4: Generic buildings
- **Height resolution:** `height` tag > `building:levels`×3.4 m (+4.5 m ground floor) > a type default. The fallback is a 12 m Victorian and Edwardian default inside the grid, since many unknown buildings are 2–4 storey heritage stock.
- **Style classifier:** choose by height, `building:material`, `start_date`, `heritage` tags and the name.
  - `glassTower` (over 60 m or post-1970): curtain-wall bands, mullion grid every 1.5 m, blue/green/grey glass tones, a setback crown and rooftop plant.
  - `victorian` (pre-1900 or heritage, under 25 m): rendered cream or red-brick facade, regular tall windows, cornice and parapet line, verandah awnings over the footpath.
  - `artDeco` (1920–1945): vertical piers, a stepped top and a sandstone palette.
  - `warehouse` (laneway-facing, low): red brick, small windows and a sawtooth roof.
- Facades are generated per edge, using the edge's length and orientation, so window rhythm lines up with each wall. Corners get quoins or piers.
- Roofs get plant rooms, AC units, water tanks, lift overruns and helipads on the tallest buildings, all placed with a seeded RNG keyed by OSM id so output is deterministic.

### Phase 5: Landmarks (hand-tuned)
Each landmark has its own module: a procedural builder in `gen/landmarks/` or an imported `.vox` via `io/vox.ts`. It replaces the OSM-generated volume inside its footprint mask. Landmarks may use a 0.5 m sub-grid that is downsampled to the main palette, plus special materials.

| Landmark | Key features |
|---|---|
| Flinders Street Station | Ochre/cream facade, green copper dome, clock row arcade, clock tower |
| St Paul's Cathedral | Bluestone/sandstone Gothic, three spires |
| Federation Square | Fractal triangular cladding pattern (sandstone/zinc/glass), atrium |
| Young & Jackson / Princes Bridge | Corner pub, bluestone bridge with lamp posts |
| State Library Victoria | Columned portico, octagonal domed reading room, front lawn |
| Melbourne Central | Glass cone over the Coop's Shot Tower |
| Parliament House + Princess Theatre + Old Treasury | Colonnades, steps, mansard roofs |
| GPO / Block Arcade / Royal Arcade | Arcade glass roofs, mosaic floor palette |
| Southern Cross Station | Undulating "wave" roof surface (heightfield function) |
| Eureka Tower, Australia 108, Rialto, 120 Collins, 101 Collins | Gold crown on Eureka, A108 "starburst" cantilever, Rialto blue glass |
| Arts Centre spire | Lattice cone (procedural lattice in voxels) |
| Hamer Hall, Forum Theatre, Regent, Manchester Unity Building | Facade highlights |

Start with the first 5 landmarks, then add the rest one at a time.

### Phase 6: Vegetation and street furniture
- London plane trees along Collins St (Paris end), Spring St and Swanston, plus elms in Treasury Gardens and Flagstaff. They use procedural voxel trees (trunk plus a noisy blob canopy with 3 greens and seasonal variation).
- Street lamps, tram stop shelters, bins, phone boxes and the Flinders St clocks.

### Phase 7: Viewer
- `ChunkLoader` loads chunks by camera distance, using a priority queue and an LRU of meshes.
- `mesher.worker.ts` does greedy meshing per material with neighbour-chunk borders, so there are no seams. It bakes per-vertex ambient occlusion (the classic 0–3 corner rule), which is essential for the voxel-art look.
- `Materials` uses MeshStandard with vertex colours. Glass and window voxels are flagged emissive so they light up at night (randomised per building). The water uses a simple scrolling-normal shader.
- `Scene` has a sun that follows Melbourne's latitude through the day, shadow mapping with cascaded or fixed-area cascades over the view, hemisphere fill, distance fog, and optional SSAO and bloom.
- **LOD:** far chunks are meshed from a 2×-downsampled chunk.
- **Actors:** instanced voxel trams follow the OSM tram polylines on loops: Swanston (route 1/3/5/6...), Collins (11/12/48/109), Bourke (86/96) and the free City Circle (35, W-class, maroon/green). Cars and pedestrians are a stretch goal.
- **Controls:** orbit (default isometric-ish view), fly, and street-level walk with collision. The HUD has a landmark jump list, a time-of-day slider and the © OpenStreetMap contributors attribution (ODbL).

### Phase 8: Polish and export
- Screenshot mode with an orthographic isometric camera for "voxel diorama" shots.
- Optional `.vox` export of selected regions (split into MagicaVoxel's 256³ model limit) for rendering in MagicaVoxel or Teardown-style tools.
- GitHub Pages deploy workflow.

## Data and licensing notes
- OSM data is ODbL, so attribution must appear in the HUD and README.
- City of Melbourne Open Data's "2023 Building Footprints" and the 3D massing model (CC BY) can improve heights. `heights.ts` merges them by spatial overlap when available.
- Commit only the pipeline. `data/raw` stays gitignored, and baked chunks are built in CI or committed via Git LFS if they are large.

## Verification
- **Unit tests (vitest):**
  - Projection round-trip, and that the grid rotation keeps Collins St axis-aligned within 1 voxel.
  - Polygon fill against known areas, including holes.
  - Height resolution precedence.
  - Greedy mesher: face counts on test shapes, no faces between solid neighbours, and AO values.
  - Chunk RLE encode and decode identity.
  - Determinism: the same input gives the same chunk hashes.
- **Pipeline smoke test:** `npm run build:world -- --bbox small`, which uses one block around Flinders/Swanston, finishes in under 30 s and writes a valid manifest.
- **Visual check:** `npm run dev`. Playwright (preinstalled Chromium) captures screenshots from fixed landmark cameras. Compare them by eye against reference photos, and keep them as regression baselines.
- **Performance targets:** full CBD at 60 fps on a mid-range laptop. Chunk mesh time is logged, and the target is under 100 MB of GPU memory.
