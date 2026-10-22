# Hand-modelling landmarks

Generic generation gets the massing right: real footprints, heights and roof shapes. What makes a city recognisable is a dozen buildings everyone knows. A **landmark model** is a small TypeScript module that takes over one building and rebuilds or decorates it with domes, spires, colonnades, clock faces and special materials, while keeping it exactly where the map data puts it.

Melbourne has 18 of them in `cities/melbourne/landmarks/`. Use them as examples: `stPauls.ts` (Gothic spires), `flindersStreetStation.ts` (dome, clocks, arcade), `artsCentre.ts` (lattice spire), `federationSquare.ts` (patterned cladding), `eurekaTower.ts` (gold crown).

## Workflow

```bash
npm run new-landmark -- wellington "Old St Paul's"   # 1. scaffold
# 2. edit cities/wellington/landmarks/oldStPauls.ts
npm run build:world -- wellington --preview         # 3. rebuild (seconds, if the landmark is near the centre)
npm run dev                                          # 4. look: Jump to → Old St Paul's
```

Repeat steps 2–4. `npm run build:world -- wellington` (without `--preview`) builds the whole city. The scaffold:
- finds the building by its OSM name;
- writes the model file, with the building's position in the header comment;
- registers the model in `cities/<city>/landmarks/index.ts`;
- adds the building to the city's jump list.

## Anatomy of a model

```ts
import { M } from '../../../src/world/palette';
import { classical } from '../../../pipeline/gen/landmarks/styles';
import type { LandmarkModel } from '../../../pipeline/gen/landmarks/types';

export const townHall: LandmarkModel = {
  name: 'Town Hall',                       // matches the jump-list entry

  // 1. Which footprint(s) this model takes over.
  select: { names: ['Town Hall', 'Town Hall (old)'] },

  // 2. Optional: remove some of them for build() to replace.
  drop: (t) => t.minH >= 30,               // e.g. everything above 30 m

  // 3. Optional: a facade for the ones that stay.
  style: () => classical({ name: 'townHall', wall: M.SANDSTONE, trim: M.RENDER_CREAM, base: M.BLUESTONE, baseHeight: 5, bay: 4, storey: 5 }),

  // 4. Optional: extra modelling after everything else is built.
  build(k, site) {
    if (Number.isNaN(site.x0)) return;     // the building isn't in this build (e.g. a --preview)
    const cx = Math.round((site.x0 + site.x1) / 2), cz = Math.round((site.z0 + site.z1) / 2);
    const top = Math.max(...site.tiers.map((t) => t.y1));
    k.box(cx - 3, top + 1, cz - 3, cx + 3, top + 14, cz + 3, M.SANDSTONE);   // clock tower
    k.clockFaces(cx, cz, top + 10, 3);
    k.spire(cx, cz, top + 15, top + 30, 4, M.COPPER_GREEN, 'square');
  },
};
```

### `select`: claiming the building

Use one of these:
- **`names: [...]`**: OSM building names, case-insensitive. The easiest option.
- **`structureAt: [gridX, gridN]`**: every tier of the structure with a tier over this point, in grid metres from the city's origin (the scaffold prints the building's grid position). Only for data sources with structure ids, such as Melbourne's footprints.
- **`rect: [x0, x1, n0, n1]`**: footprints whose centre lies in this grid-metre rectangle. Good for unnamed buildings.

Each footprint (or tier) is claimed by at most one model; earlier models in `index.ts` win.

### `site`: what you get

| Field | Meaning |
|---|---|
| `site.tiers` | The claimed footprints. Each has `mask` (its rasterised shape), `dist` (cells to the edge), `y0`/`y1` (first and last voxel layer), `minH`/`h` (metres), `roof` (OSM roof:shape) and `b` (the original building with its OSM `tags`). |
| `site.x0, z0, x1, z1` | The voxel bounding box of all tiers (NaN if nothing was claimed). |
| `site.base` | The ground layer it stands on. Heights in the kit are measured from here. |

## The kit (`k`)

Coordinates are voxels: 1 voxel = 1 m.
- **x** runs along the street grid; **z** runs across it, towards the "south" edge of the model; **y** is up.
- `k.y(m)` converts metres above the landmark's base to a layer.

| Method | What it does |
|---|---|
| `k.set(x, y, z, M.X)` / `k.get(x, y, z)` | One voxel |
| `k.box(x0, y0, z0, x1, y1, z1, mat)` | A solid box (inclusive) |
| `k.clearBox(x0, y0, z0, x1, y1, z1)` | Empty a box |
| `k.lathe(cx, cz, y0, y1, r(t), mat, { shape, shell })` | A surface of revolution: `r(t)` gives the radius at fraction `t` (0 at the bottom, 1 at the top). Drums, domes, onion domes, lighthouses, minarets. `shape`: `'circle'`, `'octagon'` or `'square'`; `shell`: hollow with this wall thickness. |
| `k.dome(cx, cz, yBase, radius, height, mat)` | A half-ellipsoid dome |
| `k.spire(cx, cz, y0, y1, r0, mat, shape?)` | A spire tapering from radius `r0` to a point |
| `k.gable(x0, z0, x1, z1, yEave, 'x' \| 'z', mat)` | A pitched roof with its ridge along an axis |
| `k.columns('x' \| 'z', at, from, to, spacing, y0, y1, r, mat)` | A colonnade |
| `k.clockFaces(cx, cz, y, half)` | Clock faces on all four sides of a tower `2·half+1` wide |
| `k.pave(x0, z0, x1, z1, M.X, test)` | Repave the ground surface (e.g. a forecourt) where `test(current)` is true |
| `k.topAt(x, z)` | The highest solid layer in a column |
| `k.ground(x, z)` | The terrain's first air layer at a column |
| `k.grid(gx, gn)` | Grid metres → voxel `[x, z]` |
| `k.withBase(layer)` | The same kit measuring heights from another layer |

**Materials** (`mat`) are palette entries such as `M.SANDSTONE`, or a function `(x, y, z, angle, t) => material` for patterns. Return 0 to leave a voxel alone. `angle` is around the lathe axis and `t` is the height fraction, so stripes, ribs and windows are one-liners:

```ts
// Ribbed copper dome with 12 gold ribs
k.dome(cx, cz, top + 1, 9, 11, (x, y, z, a) => (ribDistance(a, 12) < 0.08 ? M.GOLD : M.COPPER_GREEN));
// Striped minaret
k.lathe(cx, cz, k.y(0), k.y(45), (t) => 3 - t, (x, y) => (y % 6 < 1 ? M.SANDSTONE : M.RENDER_WHITE), { shape: 'octagon' });
```

`ribDistance(angle, n)` and `sector(angle, n)` come from `pipeline/gen/landmarks/kit.ts`.

**Facade styles:**
- `classical({ name, wall, trim, base, baseHeight, bay, storey, roof, parapet, window })` in `pipeline/gen/landmarks/styles.ts` gives a pilastered stone facade with a rusticated base.
- For anything else, write a `FacadeStyle` (`pipeline/gen/facades/types.ts`): `wall(ctx)` returns the material for each wall voxel from its storey, position along the wall and whether it's a corner.

**The palette** lives in `src/world/palette.ts` and covers:
- ground;
- walls (render, brick, sandstone, bluestone, concrete, limestone and the `TINT_*` colours);
- glass (`GLASS_CLEAR` is see-through);
- roofs;
- accents (`GOLD`, `COPPER_GREEN`, `OCHRE`, `CLOCK_FACE`, `EUREKA_RED`);
- vegetation.

To add a colour, add a line to `DEFS`. The viewer and the pipeline share the file.

**Night lights:** windows (`WINDOW_DARK`, `SHOPFRONT`), glass and `CLOCK_FACE` voxels light up after dark automatically.

## Getting an AI assistant to model it

These models are short, self-contained and checkable by eye, which suits an AI coding assistant such as Claude Code. This is how Melbourne's 18 were made. A prompt that works well:

> Model **Old St Paul's, Wellington** as a landmark in `cities/wellington/landmarks/oldStPauls.ts` (scaffolded with `npm run new-landmark`). It is an 1866 Gothic Revival timber church: white-painted board walls, steep dark-grey shingle roof, a square bell tower with a broach spire at the west end, lancet windows, and a lych-gate. Keep it within the claimed footprint and use the kit in `pipeline/gen/landmarks/kit.ts` (see docs/LANDMARKS.md and the Melbourne models for examples). Rebuild with `npm run build:world -- wellington`, take a close-up with `npm run screenshots -- wellington --views lm-old-st-paul-s`, look at the image, and iterate until it reads as the real building.

Tips:
- **Give it the facts:** date, style, materials, colours, the number of bays, towers and storeys. A description from Wikipedia plus a photo or two is ideal.
- **Ask for screenshot-driven iteration.** The assistant can capture the landmark close-up itself (`npm run screenshots`) and compare it with what it knows of the building.
- **One landmark per session or pull request** keeps reviews easy.

## Tips

- **Keep heights true:** use the claimed tiers' `y1` and `h` rather than hard-coded numbers, so the model follows the data if it changes.
- **Preview builds:** `--preview` builds only the middle 600 m. For a landmark elsewhere, temporarily set the profile's origin near it, or just do full builds (10–30 s).
- **Determinism:** use `makeRng(id)` from `pipeline/util/rng.ts` rather than `Math.random()`, so builds are repeatable.
- **Tests:** `tests/landmarks.test.ts` shows how to test a model on a synthetic footprint.
