# Recreating any city

This guide takes a city from a place name to a model that looks right: choosing the area, tuning the profile, adding local data, and hand-modelling landmarks. Melbourne (`cities/melbourne/`) is the worked example throughout: it uses every feature.

- [1. First build](#1-first-build)
- [2. Check it](#2-check-it)
- [3. The city profile](#3-the-city-profile-cityjson)
- [4. Tuning recipes](#4-tuning-recipes)
- [5. Better data](#5-better-data)
- [6. Landmarks](#6-landmarks)
- [7. Share it](#7-share-it)
- [Tips by kind of city](#tips-by-kind-of-city)

## 1. First build

```bash
npm run city -- "Lisbon Baixa, Portugal"
npm run dev        # then open http://localhost:5173/?city=lisbon-baixa
```

**Choosing the area:**
- The default is the place's own size, capped at 2 × 2 km around the point the geocoder returns.
- For a whole city that point is usually the town hall or historic centre, which is normally what you want.
- To aim somewhere else, look the point up on [openstreetmap.org](https://www.openstreetmap.org): right-click → "Show address" shows its lat/lon. Then pass `--center lat,lon --size <metres> --name "<display name>"`.

**Rules of thumb:**
- **Start small** (1–1.5 km) while you tune things: downloads and builds are faster.
- **Grow the extent** once the city looks right. Edit `extent` in `city.json` and run `npm run city -- <name>` again. The map data is downloaded again only if the earlier download doesn't cover the new area.
- **Interesting bits near the edge:** remember the extent is measured along the street grid, not north–south. Keep landmarks at least 50 m inside the edge.

## 2. Check it

Look at it in the viewer from a few angles: the diorama mode (key **4**) is the quickest way to judge the whole area. Then go through this checklist:

| Look for | Likely cause | Fix |
|---|---|---|
| Streets run diagonally across the voxels, with stair-steps | Grid angle estimated from the wrong streets | Set `gridAngleDeg`, or list the main grid streets in `gridStreets` |
| Most buildings are the same height | Few OSM `height`/`building:levels` tags | Set `defaultHeight` to the typical height; add a data source (§5); improve OSM (§5) |
| Main avenues look too narrow | Untagged widths | Add `streetWidths` rules |
| Terrain spikes or pits | Elevation-model noise around tall buildings or bridges | Usually smoothed out; set `"terrain": "flat"` for a flat city |
| The sea or a river is missing | Not mapped as a water area in OSM (coastline only) | Sea comes from the elevation model's sea floor; rivers need `natural=water` areas in OSM |
| A famous building is missing from the jump list | It isn't named in OSM, or is outside the extent | Add it to `landmarks` with an `at` position |

`npm run build:world -- <name> --preview` rebuilds just the middle 600 m in a few seconds, which is handy while tuning.

## 3. The city profile (`city.json`)

`npm run city` and `npm run new-city` write this for you. Everything except `name`, `origin` and `extent` is optional.

```jsonc
{
  "name": "Lisbon Baixa",                 // shown in the viewer
  "query": "Lisbon Baixa, Portugal",      // what was looked up (for reference)
  "origin": { "lat": 38.7107, "lon": -9.1373 },   // the centre of the model
  "extent": { "minX": -900, "maxX": 900, "minN": -900, "maxN": 900 },  // metres around the origin
  "gridAngleDeg": 21.4,                   // street-grid bearing, anticlockwise from east (filled in by npm run city)
  "gridStreets": ["Rua Augusta", "Rua da Prata"],   // optional: streets that define the grid
  "streetWidths": [                        // optional: fixed widths for named streets or road classes
    { "match": "^Avenida ", "width": 40, "carriageway": 24, "kind": "main" },
    { "match": "^(Beco|Travessa) ", "kind": "lane" }
  ],
  "defaultHeight": 15,                     // metres, for buildings with no height information (default 10)
  "terrain": "auto",                       // "auto" (default), "dem" or "flat"
  "sources": [],                           // extra data sources by id (see §5)
  "landmarks": [                           // the jump list (matched by OSM building name)
    { "name": "Arco da Rua Augusta" },
    { "name": "Elevador de Santa Justa", "at": { "lat": 38.71214, "lon": -9.13932 } }
  ],
  "autoLandmarks": 10,                     // plus this many notable buildings picked automatically
  "views": []                              // extra screenshot views (see below)
}
```

### Field reference

| Field | Meaning |
|---|---|
| `name` | Display name, shown in the viewer's title and city picker. |
| `origin` | Centre of the model: the world origin, where the camera starts. |
| `extent` | The area in metres around the origin, along the street grid: `x` runs along the grid's main axis (east when the angle is 0), `n` across it (north). Not centred is fine, e.g. `{"minX": -1360, "maxX": 880, …}`. Maximum 36 km². |
| `gridAngleDeg` | Bearing of the streets in degrees, anticlockwise from east, between −45 and 45. The model is rotated by it so the main streets run along the voxel axes, with no stair-stepping. Filled in automatically; set it yourself if the estimate is off. For cities without a grid it hardly matters. |
| `gridStreets` | If set, only these streets' bearings are used to estimate the angle (useful when a few grand streets define the grid). |
| `streetWidths` | Rules applied before OSM's own tags. Each has `match` (a regular expression on the street name) and/or `highway` (on the OSM class, e.g. `"^service$"`). Optional fields: `width` (whole corridor including footpaths), `carriageway` and `kind`. `kind` is `main`/`little` (asphalt with footpaths) or `lane` (cobbled, no footpaths). The first matching rule wins, and lane rules never apply to footpaths. Without a rule, roads are sized from `width` and `lanes` tags, or their class (e.g. a primary road is 14 m of asphalt plus 3–4 m footpaths each side). |
| `defaultHeight` | Height for buildings with no `height`, no `building:levels` and no telling type. 10 m (three storeys) by default. Melbourne uses 12 for its Victorian stock; Paris would suit 20; a US suburb 7. |
| `terrain` | `auto` uses a data source's surveyed terrain if there is one, else the global elevation model. `dem` forces the elevation model; `flat` turns terrain off. |
| `sources` | Extra data sources (§5), e.g. `["melbourne-footprints"]`. |
| `landmarks` | Jump-list entries: `name` (the OSM building name), optional `aliases` (other spellings), optional `at` (a lat/lon fallback for unnamed buildings). |
| `autoLandmarks` | How many notable buildings to add automatically: named ones scored by height, size, Wikipedia/Wikidata links and civic or religious use, spread at least 70 m apart. 0 turns it off. |
| `views` | Screenshot views (below). |

### Screenshot views

`npm run screenshots -- <name>` captures a standard set of views. Add your own to `views`:

```jsonc
{ "name": "harbour", "landmark": "Te Papa", "offset": [-200, 120, 260], "lift": 0.3 }
{ "name": "main-street", "target": "origin", "shift": [0, 6, -260], "offset": [0, -1, 228] }
{ "name": "walk-cuba-st", "target": "origin", "shift": [-120, 0, 40], "offset": [0, 0, 40], "mode": "walk", "keys": ["KeyW"], "seconds": 10 }
{ "name": "night-diorama", "target": "origin", "offset": [1, 1, 1], "mode": "diorama", "zoom": 1.2, "time": 21.5 }
```

- **Offsets** are voxels (metres) from the target: x along the grid, y up, z towards the "south" edge.
- **`lift`** aims at that fraction of a landmark's height.
- **`time`** sets the hour.
- **`mode`** switches camera mode after placing, and `keys` + `seconds` simulate holding keys (W walks forward).
- A view with a standard name (e.g. `overview`) replaces that standard view.

## 4. Tuning recipes

**The streets are diagonal.** Open the profile and set `gridAngleDeg`. To measure it, take two points along a main street on openstreetmap.org and compute `atan2(Δlat × 110574, Δlon × 111320 × cos(lat))` in degrees, folded into −45…45. Or list the grid's main streets in `gridStreets` and delete `gridAngleDeg` to re-estimate on the next `npm run city`.

**Grand boulevards.** Barcelona's Passeig de Gràcia is 61 m wide, Paris's Champs-Élysées 70 m. OSM rarely tags these widths:
```json
"streetWidths": [{ "match": "^Passeig de Gràcia$", "width": 61, "carriageway": 30 }]
```

**Lanes and alleys.** Cobbled lanes add a lot of character:
```json
"streetWidths": [{ "match": "\\b(Lane|Alley|Mews)$", "kind": "lane" }, { "highway": "^service$", "kind": "lane" }]
```

**Uniform skyline.** If most buildings come out at `defaultHeight`, OSM has few heights for the city. Pick a `defaultHeight` that matches the typical building, then see §5.

**Hills look exaggerated or flat.** The elevation model is accurate to a few metres. For a city on a gentle slope, a `"terrain": "flat"` build can look cleaner. Water bodies are kept flat at their own level, and the lowest water (or the sea) is the datum.

## 5. Better data

### Improve OpenStreetMap itself

The best long-term fix helps everyone. Add `building:levels` (or `height`), `roof:shape`, `roof:colour` and `building:colour` to buildings on [openstreetmap.org](https://www.openstreetmap.org) or with [StreetComplete](https://streetcomplete.app/). CityBuilder uses all of these:

| OSM tag | Effect |
|---|---|
| `height`, `min_height`, `building:levels`, `building:min_level`, `roof:levels` | Building and part heights (levels × 3.4 m plus a 4.5 m ground floor) |
| `building:part` | Separate tiers, setbacks and towers (the outline is then hidden) |
| `roof:shape` | `gabled`, `hipped`, `pyramidal`, `skillion`, `mansard`, `dome`, `onion`, `cone`, `round`, `flat` |
| `roof:height` | Height of a shaped roof |
| `building:colour`, `building:material` | Wall colour or material (brick, stone, plaster, wood, glass…) |
| `roof:colour`, `roof:material` | Roof colour or material (tiles, slate, copper, metal…) |
| `start_date`, `building` (type) | Facade style: glass towers, Victorian/heritage, Art Deco, warehouse |
| `natural=tree`, `natural=tree_row`, `landuse=forest` | Trees and woods |
| `railway=tram` / `light_rail` | Animated trams |

Your edits reach CityBuilder the next time the city's data is downloaded (`npm run city -- <name> --force`), usually within minutes of saving on OSM.

### Add an open-data source

Many cities publish building footprints with surveyed heights; some publish full 3D models. A data source adapter turns such a dataset into CityBuilder buildings and, optionally, terrain. The City of Melbourne adapter (`pipeline/sources/melbourneFootprints.ts`) is the model:

1. Copy it to `pipeline/sources/<yourCity>.ts`.
2. `fetch()` downloads the dataset for the city's bounding box into `ctx.cacheDir`. Most open-data portals (Opendatasoft, ArcGIS Hub, CKAN) can filter by bbox and export GeoJSON.
3. `load()` returns:
   - `buildings(osm, world, terrain)`: your buildings as `Building` objects (rings in voxel coordinates via `frame.latLonToVoxel`, heights as `height`/`min_height` tags). Melbourne's adapter keeps OSM buildings outside the dataset's coverage, and copies OSM names onto the footprints so landmarks and the jump list still work.
   - `terrain(areas)` (optional): ground elevations, e.g. from footprint base heights. Use `buildTerrain`-style interpolation, or `gridToTerrain` from a grid.
4. Register it in `pipeline/sources/index.ts` and add its id to the profile's `sources`.
5. Put the licence's attribution in `attribution`; the viewer shows it.

Examples of suitable datasets:
- New York's building footprints with roof heights.
- Amsterdam's 3D BAG.
- Vienna's building model.
- The UK's OS / Verisk building heights (licensed).
- Many cities' LiDAR-derived footprints.

Global options:
- [Overture Maps](https://overturemaps.org/) buildings, which carry heights in many cities but are distributed as large GeoParquet files.
- National LiDAR elevation models, for better terrain.

## 6. Landmarks

Two levels:

1. **In the jump list:** add the building's OSM name to `landmarks` in `city.json`. The viewer flies to it, and `npm run screenshots` gives it a close-up.
2. **Hand-modelled:** `npm run new-landmark -- <city> "<OSM name>"` writes a model that takes over the building's footprint. Edit it to add domes, spires, columns, clock faces, special materials and so on. [LANDMARKS.md](LANDMARKS.md) explains the modelling kit and how to get an AI coding assistant to do most of the work from photos.

Even without hand modelling, OSM's `roof:shape=dome|onion|cone` and colour tags already give cathedrals, mosques and towers a recognisable shape.

## 7. Share it

- **Commit the profile** (`cities/<name>/`) and push. Built worlds are not committed (they're regenerated), only the small `city.json` and any landmark models.
- **GitHub Pages:** the deploy workflow builds every city in `cities/` and publishes the viewer with a city picker. See [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md).
- **Pictures:** `npm run screenshots -- <name> --out docs/screenshots/<name>`, or **Save PNG** in the viewer.
- **MagicaVoxel:** `npm run export:vox -- <name> --centre`. Render it in MagicaVoxel or import it into game engines.

## Tips by kind of city

- **Grid cities** (Melbourne, Manhattan, Barcelona's Eixample, Chicago, Kyoto): the grid angle matters most. Check it first.
- **Old towns** (Prague, Siena, Fez): no single grid, so the angle hardly matters. Narrow streets: consider `streetWidths` rules turning `^service$` and small residential streets into lanes. Roof shapes and colours carry the look; check OSM for `roof:shape` coverage.
- **Coastal cities** (Wellington, Lisbon, Rio): the sea comes from the elevation model's sea floor, and harbours mapped as `natural=water` are drawn too. Piers (`man_made=pier`) become timber decks.
- **Hilly cities** (San Francisco, Wellington, La Paz): terrain is automatic. Buildings sit on the lowest ground under their footprint, with stone foundations where the slope falls away.
- **Skyscraper cities** (Hong Kong, Dubai, New York): the world grows as tall as the tallest building. Check that the towers have `height` tags; set `defaultHeight` higher (20–40) if most don't.
- **Cities with sparse OSM buildings:** the model will be patchy. A data source (§5) or a mapping session pays off quickly.
