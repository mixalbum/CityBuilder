// Registry of optional data sources, by the id a city profile lists in "sources".

import { melbourneFootprints } from './melbourneFootprints';
import type { DataSource } from './types';

export type { DataSource, FetchContext, LoadContext, LoadedSource } from './types';

export const SOURCES: Record<string, DataSource> = {
  [melbourneFootprints.id]: melbourneFootprints,
};

export function getSource(id: string): DataSource {
  const s = SOURCES[id];
  if (!s) throw new Error(`Unknown data source "${id}". Known sources: ${Object.keys(SOURCES).join(', ')}`);
  return s;
}
