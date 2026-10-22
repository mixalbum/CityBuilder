// Subset of the Overpass JSON format produced by `out geom;`.

export type Tags = Record<string, string>;

export interface OsmPoint {
  lat: number;
  lon: number;
}

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  tags?: Tags;
  geometry: OsmPoint[];
}

export interface OsmRelationMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: OsmPoint[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  tags?: Tags;
  members: OsmRelationMember[];
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OsmData {
  elements: OsmElement[];
  /** Set on the generated stand-in dataset so nothing mistakes it for real data. */
  synthetic?: boolean;
}
