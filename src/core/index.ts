import { compose, Composition, DEFAULT_PARAMS, WarpParams } from './composer';
import { glyphShapes, layerFills, prettyName, toSVG } from './svg';

export { compose, DEFAULT_PARAMS, prettyName };
export type { Composition, WarpParams };
export { PALETTES, getPalette } from './palettes';
export type { Palette } from './palettes';
export { FONTS, getFont } from './fonts';
export type { BakedFont } from './fonts';
export { SURFACES } from './warp';
export type { SurfaceId } from './warp';
export { FITS, MAX_LINES, MAX_LINE_CHARS, PAD_FRACTION } from './layout';
export type { FitId } from './layout';
export { STRATEGIES } from './colors';
export type { ColorStrategy, StyleId } from './colors';

export interface GenerateResult {
  svg: string;
  glyphCount: number;
  grainCount: number;
  composition: Composition;
}

/** Main entry point: params → deterministic SVG of warped type. */
export function generate(params: WarpParams): GenerateResult {
  const composition = compose(params);
  const shapes = glyphShapes(composition);
  return {
    svg: toSVG(composition, shapes),
    glyphCount: shapes.length,
    grainCount: composition.grain.count,
    composition,
  };
}

/** "Glyph 042" → generated fill hex, for manual-override detection. */
export function layerFillMap(params: WarpParams): Map<string, string> {
  return layerFills(compose(params));
}
