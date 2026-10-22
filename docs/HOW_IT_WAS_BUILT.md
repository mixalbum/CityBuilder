# How this was built

CityBuilder grew out of **CityPlan**, a voxel model of Melbourne's CBD built over a series of sessions with [Claude Code](https://claude.com/claude-code), Anthropic's AI coding agent, working in a cloud container against a GitHub repository. This page records the steps, tools and decisions, and the problems hit along the way, so you can reproduce the process for your own project or extend this one the same way.

## The tools

| Tool | Used for |
|---|---|
| **Claude Code** (on the web, in a cloud container) | Planning, writing every line of code, running builds and tests, taking and reviewing screenshots, opening and merging pull requests |
| **GitHub** | The repository, pull requests (one per phase) and Actions (CI, Pages) |
| **Node.js + TypeScript**, **tsx** | The data pipeline, run directly from TypeScript |
| **Three.js**, **Vite** | The browser viewer and dev server |
| **Vitest** | Unit tests (projection, rasterisation, heights, terrain, meshing, LOD, physics, …) |
| **Playwright + headless Chromium** | Screenshots from fixed cameras: the agent's "eyes" for checking the model |
| **OpenStreetMap** via the **Overpass API** | Streets, buildings, water, parks, trees, tram lines |
| **City of Melbourne Open Data** | Surveyed building footprints with height tiers and ground elevations |
| **AWS Terrain Tiles** (added in CityBuilder) | Global elevation for any city |
| **Nominatim** (added in CityBuilder) | Place names → coordinates |
| **MagicaVoxel** | Viewing `.vox` exports |

## The sequence

Each step was one or two prompts to the agent. They're quoted roughly as given, which shows how little steering was needed.

### 1. Plan
> "create a detailed code plan for creating a detailed Voxel Art version of Melbourne CBD, Australia"

The agent wrote a phased plan, now in [ORIGINAL_PLAN.md](ORIGINAL_PLAN.md):
- the stack;
- the extent (the Hoddle Grid plus margins);
- 1 m voxels;
- the repository layout;
- 8 phases: data, voxel core, ground, buildings, landmarks, vegetation, viewer, polish;
- the landmark list;
- the licensing notes and a verification strategy.

**Key decision:** rotate the projection so the street grid aligns with the voxel axes. That turned out to be the biggest single visual win.

### 2. Foundation (CityPlan PR #1)
> "start building" … "i've given full network access, can you continue to build the real city"

- **Pipeline:** Overpass download, projection, feature extraction, sparse 32³ chunk store, rasterisation (scanline fill, thick lines), ground layer, building extrusion with four facade styles, rooftop clutter, voxel trees, RLE region files.
- **Viewer:** chunk streaming, worker greedy meshing with ambient occlusion, sun and shadows, orbit controls, a landmark jump list.
- **Offline stand-in:** without network access at first, the agent built a synthetic OSM-shaped Hoddle Grid so the whole pipeline could be developed and tested. It's still used in CI.
- **Real data:** once the network was available, real OSM data plus the City of Melbourne's footprints. Their stacked height tiers reproduce podiums, setbacks and towers exactly.

### 3. Landmarks (PRs #2 and #4)
> "open a pull request for this branch then start on hand-modeling the landmarks" … "continue with the next steps"

- **The landmark framework:** models claim footprint tiers by structure, name or rectangle, then restyle, drop or rebuild them.
- **The modelling kit:** lathe, dome, spire, gable, columns, clock faces, paving.
- **18 landmarks:** St Paul's spires, Flinders Street Station's dome and clocks, Federation Square's cladding, the Arts Centre's lattice spire, Eureka's gold crown, and more.
- **Each one checked by eye:** the agent took close-up screenshots with Playwright, looked at them, and fixed what was off.

### 4. Terrain (PR #4)
- Ground elevations were interpolated from the surveyed base heights of about 2,550 structures.
- The river was pinned to water level, then everything smoothed.
- Buildings sit level on their surveyed bases, with bluestone foundations where the slope falls away.
- Bridge decks ramp between their ends.

### 5. CI (PR #3)
- A GitHub Actions workflow runs typecheck, tests and the build on every PR.
- Later it also ran on Windows, after a Windows-only bug (below).

### 6. A living city (PR #5)
> "carry on with the next features from the plan"

- **Day/night:** a solar model for the city's latitude and the date; sky, fog and light follow it; windows light up at night.
- **Trams:** tram tracks chained into 31 continuous routes, with instanced voxel trams sampled on the track surface.
- **Glass:** a translucent pass for clear glass.
- **Pages:** a GitHub Pages workflow (opt-in).

### 7. Export and polish (PRs #6 and #7)
> "create a vox format export" … "continue with the next features from the plan"

- **MagicaVoxel `.vox` export** (scene graph, split into 256³ models), from the viewer and the command line.
- **LOD:** 2× downsampled region meshes that keep facade colours; full detail near the camera. About 8M → 3.4M triangles, and the city appears twice as fast.
- **Camera modes:** fly, walk (unit-tested collision physics) and an isometric orthographic diorama camera.
- **Saving:** PNG capture at 2× resolution.

### 8. Windows (PR #8)
> "can you give me detailed instructions on how to download and run this on a windows 11 machine" … "I only see a baby blue screen"

The pipeline scripts decided whether to run with `import.meta.url === 'file://' + process.argv[1]`. That is never true on Windows, so every script silently did nothing. The fix was `pathToFileURL`. The viewer also learned to report a missing world instead of showing a blank page, and CI gained a Windows job.

### 9. CityBuilder
> "create a new repo called CityBuilder … so anyone can recreate this in any city they specify. use your imagination with how the process can be speed up …"

Melbourne-specific constants became a **city profile**. Then came everything needed for an arbitrary city:
- **Getting started:** geocoding; `npm run city "<place>"`.
- **Terrain:** the global elevation model, with sea from bathymetry and per-body water levels.
- **Generic data handling:**
  - road widths by class;
  - dominant-bearing grid estimation;
  - OSM roof shapes and colours;
  - woods, beaches and piers;
  - automatic landmarks;
  - a pluggable data-source interface (Melbourne's footprints became the first adapter).
- **The viewer:** a multi-city viewer with a picker, and a latitude-aware sun.
- **Tooling:**
  - a scaffold for landmark models;
  - generic screenshot views;
  - a "Build a city" GitHub Action, Codespaces support and setup scripts;
  - this documentation.

## Problems worth knowing about

| Problem | Fix |
|---|---|
| Overpass servers rate-limit and time out, especially for big queries | Tiles over several servers at once, one query per server; cool-downs and re-queuing; a short declared timeout and default memory allowance (queries asking for more memory wait longer); an identifying User-Agent (anonymous clients get 429s) |
| Parallel "hedged" requests made things *worse*: the servers count concurrent queries per user, and aborted queries keep running server-side | Replaced by the polite scheduler above |
| The world origin was 60 m off | Use a real street intersection's coordinates |
| Underground stations and tunnels drawn on the street | Skip `tunnel=*`, `location=underground`, negative `layer`/`level` |
| Fallback OSM buildings standing on roads | Drop OSM-only buildings whose footprint is mostly carriageway |
| The wrong tier chosen for a landmark's roof | Select by name plus a check on the tier's shape |
| Window stripes on curved walls | Treat a cell as a corner only where two straight wall runs meet |
| Buildings floating on slopes | Base on the lowest ground under the footprint, with stone foundations |
| Trams flying off the edge | Clip routes to the world; chain track pieces from both ends |
| Screenshots timing out on a software GPU | Wait for the loader to be idle and for fresh frames; long timeouts |
| A blank page on Windows | `pathToFileURL` for entry-point checks; show an error instead of a blank page |
| `pkill -f <pattern>` killing its own shell | Kill by port (`fuser -k 5173/tcp`) or PID instead |

## Recreating it with an AI agent

The fastest way to build your own version, or a new feature for this one, is the way this was built: small, verifiable steps with an agent that can run code and look at screenshots.

1. **Start with a plan.** "Create a detailed code plan for a voxel model of `<city>`: data sources, extent, voxel size, repository layout, phases, verification." Review it before any code.
2. **Make it runnable offline early.** A synthetic stand-in dataset lets the pipeline and tests run without the network, and keeps CI deterministic.
3. **One phase per pull request**, each with tests and screenshots in the description.
4. **Give the agent eyes.** A screenshot script with named camera views (`npm run screenshots`) turns "does it look right?" into something the agent can check and iterate on.
5. **Hand-model landmarks one at a time**, from a description and photos (see [LANDMARKS.md](LANDMARKS.md)).
6. **Ask for platform checks** (Windows, macOS) and run CI on them; most "it doesn't work for me" reports are path or shell differences.

Prompts that worked well:
- **Starting a city:** "Build `<city>` with CityBuilder, look at the overview, diorama and centre screenshots, and tune `cities/<slug>/city.json` (grid angle, street widths, default height) until it reads as `<city>`. Explain each change."
- **One landmark:** "Model `<landmark>` as a landmark (see docs/LANDMARKS.md). It is `<description>`. Iterate on the close-up screenshot until it's recognisable."
- **A data source:** "Write a data source adapter for `<dataset URL>` (open building footprints with heights) following `pipeline/sources/melbourneFootprints.ts`, with tests."
- **A feature:** "Add `<feature>` to the viewer. Keep it testable, add unit tests, capture before/after screenshots, and open a PR."
