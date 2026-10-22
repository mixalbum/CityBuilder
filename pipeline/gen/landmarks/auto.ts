// Pick a city's notable buildings for the viewer's jump list without any
// local knowledge: named buildings scored by height, size, Wikipedia/Wikidata
// links and civic or religious use, spread out so they aren't all one block.

import type { LandmarkDef } from '../../config';
import type { Building } from '../../model/features';
import { resolveHeight } from '../../model/heights';

const NOTABLE_TYPES = new Set([
  'cathedral', 'church', 'chapel', 'mosque', 'temple', 'synagogue', 'shrine', 'basilica',
  'government', 'civic', 'public', 'museum', 'train_station', 'transportation', 'stadium', 'castle', 'palace',
  'university', 'college', 'library', 'hotel', 'office',
]);
const NOTABLE_USES = /^(place_of_worship|theatre|townhall|library|arts_centre|courthouse|concert_hall|museum|attraction|castle|monument|memorial)$/;
/** Landmarks closer than this (metres) to a better one are skipped. */
const MIN_SPACING = 70;

function centroid(b: Building): [number, number] {
  const r = b.rings[0];
  let x = 0, z = 0;
  for (const [px, pz] of r) {
    x += px;
    z += pz;
  }
  return [x / r.length, z / r.length];
}

function footprintArea(b: Building): number {
  const r = b.rings[0];
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

export function scoreBuilding(b: Building): number {
  const t = b.tags;
  if (!t.name || b.isPart) return 0;
  let score = resolveHeight(t).height / 12 + Math.log10(1 + footprintArea(b)) * 1.5;
  if (t.wikidata || t.wikipedia) score += 6;
  if (NOTABLE_TYPES.has(t.building ?? '')) score += 2;
  if (NOTABLE_USES.test(t.amenity ?? '') || NOTABLE_USES.test(t.tourism ?? '') || NOTABLE_USES.test(t.historic ?? '')) score += 4;
  if (t.heritage || t['heritage:operator']) score += 2;
  return score;
}

/**
 * The `count` most notable named buildings, as landmark definitions matched
 * by name. Names already in `existing` are left out.
 */
export function pickAutoLandmarks(buildings: Building[], count: number, existing: LandmarkDef[] = []): LandmarkDef[] {
  if (count <= 0) return [];
  const taken = new Set(existing.flatMap((d) => [d.name, ...(d.aliases ?? [])].map((n) => n.toLowerCase())));
  const best = new Map<string, { b: Building; score: number }>();
  for (const b of buildings) {
    const score = scoreBuilding(b);
    const name = (b.tags.name ?? '').trim();
    if (score <= 0 || taken.has(name.toLowerCase())) continue;
    const prev = best.get(name);
    if (!prev || score > prev.score) best.set(name, { b, score });
  }
  const ranked = [...best.entries()].sort((a, b) => b[1].score - a[1].score);
  const picked: { name: string; at: [number, number] }[] = [];
  for (const [name, { b }] of ranked) {
    if (picked.length >= count) break;
    const c = centroid(b);
    if (picked.some((p) => Math.hypot(p.at[0] - c[0], p.at[1] - c[1]) < MIN_SPACING)) continue;
    picked.push({ name, at: c });
  }
  return picked.map((p) => ({ name: p.name }));
}
