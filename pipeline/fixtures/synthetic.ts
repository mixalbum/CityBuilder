// A synthetic, OSM-shaped stand-in for the Hoddle Grid. It is NOT real map
// data: street positions follow the grid's real 10-chain (201 m) spacing and
// the landmarks sit roughly where they are, but lot shapes and heights are
// random. It exists so the pipeline and viewer can run without network
// access; real builds use `npm run fetch:osm` and data/raw/osm.json.

import { GRID_ANGLE_DEG_DEFAULT, ORIGIN } from './melbourne';
import { Projector } from '../geo/project';
import type { OsmData, OsmElement, OsmPoint, Tags } from '../model/osm';
import { makeRng } from '../util/rng';

const SP = 201.17; // one Hoddle block, centre to centre
const MAIN_W = 30.17; // 99 ft
const LITTLE_W = 10.06; // 33 ft

const NS = ['Spencer', 'King', 'William', 'Queen', 'Elizabeth', 'Swanston', 'Russell', 'Exhibition', 'Spring'];
const EW = ['Flinders', 'Collins', 'Bourke', 'Lonsdale', 'La Trobe'];
const LITTLE = ['Flinders Lane', 'Little Collins Street', 'Little Bourke Street', 'Little Lonsdale Street'];
const LANES = [
  'Degraves Street', 'Centre Place', 'Hosier Lane', 'ACDC Lane', 'Block Place', 'Howey Place', 'Manchester Lane',
  'Equitable Place', 'Guildford Lane', 'Meyers Place', 'Rutledge Lane', 'Presgrave Place', 'Duckboard Place',
  'Warburton Lane', 'Tattersalls Lane', 'Caledonian Lane', 'Sniders Lane', 'Drewery Lane', 'Rainbow Alley',
];

const X = (i: number) => (i - 5) * SP; // Swanston St is x = 0
const N = (j: number) => j * SP; // Flinders St is n = 0

type Rect = [number, number, number, number]; // x0, x1, n0, n1

interface LandmarkDef {
  name: string;
  rect: Rect;
  height: number;
  tags?: Tags;
  parts?: { rect: Rect; height: number; minHeight?: number }[];
}

const LANDMARKS: LandmarkDef[] = [
  { name: 'Flinders Street Station', rect: [-190, -5, -55, -15], height: 18, tags: { building: 'train_station', start_date: '1910' },
    parts: [{ rect: [-190, -5, -55, -15], height: 18 }, { rect: [-32, -10, -50, -20], height: 32 }] },
  { name: 'Federation Square', rect: [15, 160, -95, -15], height: 16, tags: { start_date: '2002' } },
  { name: "St Paul's Cathedral", rect: [15, 75, 15, 50], height: 28, tags: { building: 'cathedral', start_date: '1891' },
    parts: [{ rect: [15, 75, 15, 50], height: 28 }, { rect: [41, 49, 27, 37], height: 98 }] },
  { name: 'Young and Jackson', rect: [-40, -15, 15, 35], height: 14, tags: { start_date: '1853' } },
  { name: 'Rialto Towers', rect: [-780, -740, 145, 186], height: 185, tags: { start_date: '1986' } },
  { name: '101 Collins Street', rect: [230, 272, 216, 262], height: 195, tags: { start_date: '1991' } },
  { name: '120 Collins Street', rect: [300, 340, 145, 186], height: 220, tags: { start_date: '1991' } },
  { name: 'Melbourne Central', rect: [-186, -15, 713, 789], height: 40, tags: { start_date: '1991' },
    parts: [{ rect: [-186, -15, 713, 789], height: 40 }, { rect: [-125, -80, 722, 765], height: 211 }] },
  { name: 'State Library Victoria', rect: [15, 186, 819, 960], height: 30, tags: { building: 'library', start_date: '1856' } },
  { name: 'Parliament House', rect: [640, 740, 390, 460], height: 26, tags: { start_date: '1856' } },
  { name: 'Old Treasury Building', rect: [640, 700, 200, 250], height: 20, tags: { start_date: '1862' } },
  { name: 'General Post Office', rect: [-186, -120, 417, 460], height: 30, tags: { start_date: '1867' } },
  { name: 'Southern Cross Station', rect: [-1140, -1025, 220, 600], height: 20, tags: { building: 'train_station', start_date: '2006' } },
  { name: 'Eureka Tower', rect: [-364, -324, -272, -232], height: 297, tags: { start_date: '2006' } },
  { name: 'Australia 108', rect: [-451, -409, -351, -309], height: 317, tags: { start_date: '2020' } },
  { name: 'Arts Centre Melbourne', rect: [40, 110, -330, -260], height: 25, tags: { start_date: '1984' } },
];

const overlaps = (a: Rect, b: Rect) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];

/** Yarra centreline (grid n) as a function of grid x. */
const riverN = (x: number) => -150 + 30 * Math.sin(x / 400);
const RIVER_HALF = 35;

export function generateSyntheticOsm(): OsmData {
  const proj = new Projector(ORIGIN, GRID_ANGLE_DEG_DEFAULT);
  const rng = makeRng('synthetic-hoddle-grid');
  const elements: OsmElement[] = [];
  let nextId = 1;
  const pt = (x: number, n: number): OsmPoint => {
    const { lat, lon } = proj.toLatLon(x, n);
    return { lat: +lat.toFixed(7), lon: +lon.toFixed(7) };
  };
  const way = (pts: [number, number][], tags: Tags) =>
    elements.push({ type: 'way', id: -nextId++, tags, geometry: pts.map(([x, n]) => pt(x, n)) });
  const rectWay = ([x0, x1, n0, n1]: Rect, tags: Tags) => way([[x0, n0], [x1, n0], [x1, n1], [x0, n1], [x0, n0]], tags);
  const node = (x: number, n: number, tags: Tags) => elements.push({ type: 'node', id: -nextId++, ...pt(x, n), tags });

  // Streets
  const xMin = X(0) - 120, xMax = X(8) + 200, nMax = N(4) + 190;
  NS.forEach((s, i) => way([[X(i), i === 5 ? -90 : -15], [X(i), nMax]], { highway: 'primary', name: `${s} Street` }));
  EW.forEach((s, j) => way([[xMin, N(j)], [xMax, N(j)]], { highway: 'primary', name: `${s} Street` }));
  LITTLE.forEach((s, j) => way([[X(0), N(j) + SP / 2], [X(8), N(j) + SP / 2]], { highway: 'tertiary', name: s }));
  way([[0, -90], [0, -215]], { highway: 'primary', name: 'Princes Bridge', bridge: 'yes' });
  way([[0, -215], [0, -420]], { highway: 'primary', name: 'St Kilda Road', lanes: '6' });
  way([[xMin, -225], [-60, -225]], { highway: 'footway', name: 'Southbank Promenade', width: '12' });

  // Trams run down the middle of the main streets.
  const tram = (pts: [number, number][], name: string) =>
    [-1.75, 1.75].forEach((o) => {
      const vertical = pts[0][0] === pts[1][0];
      way(pts.map(([x, n]) => (vertical ? [x + o, n] : [x, n + o])), { railway: 'tram', name });
    });
  tram([[0, -420], [0, nMax]], 'Swanston Street');
  tram([[xMin, N(1)], [xMax, N(1)]], 'Collins Street');
  tram([[X(0), N(2)], [X(8), N(2)]], 'Bourke Street');
  tram([[xMin, N(0)], [xMax, N(0)]], 'Flinders Street');
  tram([[X(0), N(4)], [X(8), N(4)]], 'La Trobe Street');
  tram([[X(8), -15], [X(8), nMax]], 'Spring Street');
  tram([[X(4), -15], [X(4), nMax]], 'Elizabeth Street');
  tram([[X(2), -15], [X(2), nMax]], 'William Street');

  // Flinders Street Station platforms and the Jolimont rail yards.
  for (let k = 0; k < 6; k++) way([[X(0), -62 - k * 6.5], [xMax, -62 - k * 6.5]], { railway: 'rail' });

  // The Yarra, as one polygon following riverN.
  const bank: [number, number][] = [];
  for (let x = xMin; x <= xMax; x += 40) bank.push([x, riverN(x) + RIVER_HALF]);
  for (let x = xMax; x >= xMin; x -= 40) bank.push([x, riverN(x) - RIVER_HALF]);
  bank.push(bank[0]);
  way(bank, { natural: 'water', water: 'river', name: 'Yarra River' });

  // Parks
  rectWay([X(1) + 15, X(2) - 15, N(4) + 15, nMax], { leisure: 'park', name: 'Flagstaff Gardens' });
  rectWay([X(8) + 15, xMax, 20, 190], { leisure: 'park', name: 'Treasury Gardens' });
  const parkTrees = (r: Rect, count: number) => {
    for (let k = 0; k < count; k++) node(rng.range(r[0], r[1]), rng.range(r[2], r[3]), { natural: 'tree', genus: 'Ulmus' });
  };
  parkTrees([X(1) + 25, X(2) - 25, N(4) + 25, nMax - 10], 45);
  parkTrees([X(8) + 25, xMax - 10, 30, 180], 35);

  // Plane trees along the Paris end of Collins St and along Swanston St.
  for (let x = X(6) + 20; x < X(8) - 20; x += 9)
    for (const side of [-12.5, 12.5]) node(x, N(1) + side, { natural: 'tree', genus: 'Platanus' });
  for (let n = 25; n < N(4) - 20; n += 10)
    for (const side of [-12.5, 12.5]) node(side, n, { natural: 'tree', genus: 'Platanus' });

  // Landmarks
  for (const l of LANDMARKS) {
    const tags: Tags = { building: 'yes', name: l.name, height: String(l.height), ...l.tags };
    rectWay(l.rect, tags);
    for (const p of l.parts ?? [])
      rectWay(p.rect, { 'building:part': 'yes', height: String(p.height), ...(p.minHeight ? { min_height: String(p.minHeight) } : {}), start_date: tags.start_date ?? '' });
  }
  const reserved = LANDMARKS.map((l) => l.rect);

  // Lots: each block is split by its little street into two halves, the
  // halves are split by laneways, and the strips between lanes into lots.
  let laneIdx = 0;
  const emitLot = (r: Rect, towerBias: number) => {
    if (reserved.some((q) => overlaps(q, r))) return;
    const width = r[1] - r[0];
    const roll = rng();
    let height: number, year: number;
    if (width >= 22 && roll < towerBias) {
      height = rng.range(80, 230);
      year = rng.int(1970, 2022);
    } else if (roll < towerBias + 0.3) {
      height = rng.range(25, 70);
      year = rng.int(1925, 1995);
    } else {
      height = rng.range(8, 22);
      year = rng.int(1855, 1935);
    }
    const tags: Tags = { building: rng() < 0.08 ? 'warehouse' : 'commercial', height: height.toFixed(1), start_date: String(year) };
    rectWay(r, tags);
  };
  const fillStrip = (x0: number, x1: number, n0: number, n1: number, towerBias: number) => {
    let x = x0;
    while (x1 - x > 4) {
      const big = rng() < towerBias;
      let w = big ? rng.range(25, 45) : rng.range(6, 22);
      if (x1 - x - w < 6) w = x1 - x;
      // Deep lots run through; others split into a front and back building.
      if (big || rng() < 0.5) emitLot([x, x + w, n0, n1], towerBias);
      else {
        const cut = n0 + (n1 - n0) * rng.range(0.45, 0.65);
        emitLot([x, x + w, n0, cut], towerBias);
        emitLot([x, x + w, cut, n1], towerBias * 0.5);
      }
      x += w;
    }
  };

  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 4; j++) {
      const x0 = X(i) + MAIN_W / 2, x1 = X(i + 1) - MAIN_W / 2;
      const mid = N(j) + SP / 2;
      // More towers on Collins and Bourke and at the grid's west and east ends.
      const towerBias = 0.12 + (j === 1 || j === 2 ? 0.08 : 0) + (i <= 2 || i >= 6 ? 0.06 : 0);
      const halves: [number, number][] = [
        [N(j) + MAIN_W / 2, mid - LITTLE_W / 2],
        [mid + LITTLE_W / 2, N(j + 1) - MAIN_W / 2],
      ];
      for (const [n0, n1] of halves) {
        const lanes = rng.int(1, 2);
        const cuts = Array.from({ length: lanes }, (_, k) => x0 + ((x1 - x0) * (k + 1)) / (lanes + 1) + rng.range(-15, 15));
        let sx = x0;
        for (const c of cuts) {
          const lw = rng.range(3, 5);
          way([[c, n0 - 0.5], [c, n1 + 0.5]], { highway: 'service', name: LANES[laneIdx++ % LANES.length], width: lw.toFixed(1) });
          fillStrip(sx, c - lw / 2, n0, n1, towerBias);
          sx = c + lw / 2;
        }
        fillStrip(sx, x1, n0, n1, towerBias);
      }
    }

  // A loose cluster of Southbank towers south of the river.
  for (let k = 0; k < 14; k++) {
    const x = rng.range(-1000, -120);
    const n0 = riverN(x) - RIVER_HALF - 20 - rng.range(0, 150);
    const s = rng.range(20, 40);
    emitLot([x, x + s, n0 - s, n0], 0.7);
  }

  return { elements, synthetic: true };
}
