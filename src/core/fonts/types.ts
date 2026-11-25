/** One baked display face. Coordinates are integer font units, y-up. */
export interface BakedFont {
  id: string;
  /** Presented to users. Differs from `source` where the original's grant
   *  reserves its name — see scripts/faces.mjs. */
  name: string;
  blurb: string;
  /** The typeface these outlines were derived from, for attribution. */
  source: string;
  license: string;
  unitsPerEm: number;
  /** yMax of "H" — every layout measurement is in cap heights. */
  capHeight: number;
  xHeight: number;
  ascender: number;
  descender: number;
  /** char → [advance width, SVG path data (M/L/Q/Z, font units)]. */
  glyphs: Record<string, [number, string]>;
}
