export interface WallCtx {
  /** Voxel layer within this building (part), 0 = its lowest layer. */
  yRel: number;
  /** Voxel layer above street level; differs from yRel for raised building:parts. */
  fromGround: number;
  /** Total voxel layers in this building (part). */
  H: number;
  /** World coordinate along the wall, so window rhythm follows each facade. */
  along: number;
  /** Which world axis `along` runs on: 'x' for north/south-facing walls, 'z' for east/west. */
  alongAxis: 'x' | 'z';
  /** Perimeter cell exposed on two axes. */
  corner: boolean;
}

export interface FacadeStyle {
  /** Style family, for stats: glassTower, victorian, artDeco, warehouse or a landmark's own. */
  name: string;
  /** Cells this many steps from the edge (or fewer) are cut away at layer yRel. */
  inset(yRel: number, H: number): number;
  wall(c: WallCtx): number;
  /** Hidden fill behind the facade. */
  interior: number;
  roof: number;
  /** Material for a one-voxel parapet around the roof, if any. */
  parapet?: number;
  /** Rooftop clutter flavour; 'none' for landmarks. */
  rooftop: 'plant' | 'heritage' | 'none';
  /** Material for pitched roofs, optionally per OSM roof:shape; random tile/slate/tin when unset. */
  pitchedRoof?: number | ((shape: string) => number);
}
