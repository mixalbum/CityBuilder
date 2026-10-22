# Notes for AI coding agents

CityBuilder turns open map data into a voxel city viewable in the browser. Read `docs/ARCHITECTURE.md` first; it maps every file.

## Commands

```bash
npm test                                   # vitest; must pass before committing
npm run typecheck                          # tsc --noEmit (covers src, pipeline, cities, scripts, tests)
npm run build:world -- melbourne --synthetic --preview   # offline smoke build, ~2 s
npm run city -- <slug or "place name">     # download (cached) + build a real city
npm run dev                                # viewer on http://localhost:5173/?city=<slug>
npm run screenshots -- <slug> --views overview,diorama   # needs the dev server; writes screenshots/<slug>/
```

## Conventions

- **TypeScript ESM**, run with `tsx`. CLI entry points use `isMain(import.meta.url)` from `pipeline/util/isMain.ts`, never a `file://` string comparison (it breaks on Windows).
- **Shared code:** the palette (`src/world/palette.ts`) and file format (`src/world/chunkFormat.ts`) are shared by the pipeline and the viewer; changing palette order changes material indices, so rebuild cities after.
- **Determinism:** seed randomness with `makeRng(id)` (`pipeline/util/rng.ts`); `Math.random()` makes builds unrepeatable.
- **City knowledge** goes in `cities/<slug>/city.json` or `cities/<slug>/landmarks/`, never in `pipeline/`. Melbourne is the reference city and uses every feature.
- **Coordinates:** grid metres are `(x, n)` around the profile origin, rotated by the grid angle; voxel space is `(x, y, z)`: x along the grid, y up, z towards the south edge. Convert with `WorldFrame` (`pipeline/geo/project.ts`).
- **Network:** downloads go through `pipeline/fetch/http.ts` (retries, User-Agent). Overpass load is handled by the scheduler in `fetch/overpass.ts`: never fire many parallel queries at one server.
- **Checking visual changes:** capture before and after screenshots and look at them; unit tests can't tell you a building looks wrong.
- **Comments:** match the surrounding density: a short header per module, doc comments on exported functions, and an inline note only where the code isn't self-explanatory.

## Data and licences

- **OpenStreetMap data** is ODbL: keep the attribution in the manifest and viewer.
- **Data sources** carry their own attribution string; the build adds it to the manifest.
- **Committing:** built worlds (`public/cities/`) and downloads (`data/`) are gitignored; commit profiles and landmark models only.
