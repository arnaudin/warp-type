import { assignFills, ColorStrategy, StyleId } from './colors';
import { BakedFont, FONTS, getFont, Pt } from './fonts';
import { FitId, layout, MAX_LINE_CHARS, MAX_LINES, PlacedGlyph } from './layout';
import { getPalette, Palette, PALETTES } from './palettes';
import { mulberry32 } from './rng';
import { grainSpecks, GrainLayer } from './grain';
import { makeSurface, Surface, SurfaceId, SURFACES } from './warp';

export interface WarpParams {
  /** The words themselves; newlines break lines. */
  text: string;
  fontId: string;
  fit: FitId;
  surface: SurfaceId;
  /** Ripple amplitude, 0–100. */
  wave: number;
  /** Full waves across the measure. */
  folds: number;
  /** How much the cloth swells toward the viewer, 0–100. */
  swell: number;
  /** How far letters tip with the surface under them, 0–100. */
  lean: number;
  /** Hand-lettered irregularity, 0–100. */
  jitter: number;
  /** Letter spacing, % of em; negative crowds letters. */
  tracking: number;
  /** Leading, % of cap height; negative overlaps lines. */
  lineGap: number;
  /** Print speckle, 0–100. */
  grain: number;
  strokeWidth: number;
  style: StyleId;
  themeId: string;
  colorStrategy: ColorStrategy;
  width: number;
  height: number;
  seed: number;
}

export const DEFAULT_PARAMS: WarpParams = {
  text: 'PLAQUE\nSABBATH\nMASTER\nOF\nCAVITY',
  fontId: 'monolith',
  fit: 'stretch',
  surface: 'cloth',
  wave: 22,
  folds: 1.6,
  swell: 34,
  lean: 32,
  jitter: 35,
  tracking: -2,
  lineGap: -3,
  grain: 28,
  strokeWidth: 0,
  style: 'color',
  themeId: 'doom',
  colorStrategy: 'byLine',
  width: 1000,
  height: 1000,
  seed: 12345,
};

export interface WarpedGlyph {
  char: string;
  line: number;
  /** Closed polygons in px, warped and refitted — what actually gets drawn. */
  contours: Pt[][];
  /** Shading term at this letter, −1…1. */
  lit: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Composition {
  params: WarpParams;
  font: BakedFont;
  palette: Palette;
  glyphs: WarpedGlyph[];
  fills: string[];
  grain: GrainLayer;
  lineCount: number;
}

/** How much of the cloth's local motion each point feels, versus the whole
 *  letter riding rigidly on its baseline. Fully local shreds tall letters at
 *  high wave; fully rigid stops the letters bending at all. */
const RESIDUAL = 0.62;

/** Hydrated params can be stale JSON from an older build — coerce everything. */
export function clampParams(p: WarpParams): WarpParams {
  const D = DEFAULT_PARAMS;
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const oneOf = <T extends string>(v: unknown, ids: readonly T[], d: T): T =>
    ids.includes(v as T) ? (v as T) : d;

  const text =
    typeof p.text === 'string' && p.text.trim().length > 0
      ? p.text
          .split('\n')
          .slice(0, MAX_LINES)
          .map((l) => l.slice(0, MAX_LINE_CHARS))
          .join('\n')
      : D.text;

  return {
    text,
    fontId: FONTS.some((f) => f.id === p.fontId) ? p.fontId : D.fontId,
    fit: oneOf(p.fit, ['stretch', 'scale', 'none'] as const, D.fit),
    surface: oneOf(
      p.surface,
      SURFACES.map((s) => s.id),
      D.surface,
    ),
    wave: clamp(num(p.wave, D.wave), 0, 100),
    folds: clamp(num(p.folds, D.folds), 0.2, 6),
    swell: clamp(num(p.swell, D.swell), 0, 100),
    lean: clamp(num(p.lean, D.lean), 0, 100),
    jitter: clamp(num(p.jitter, D.jitter), 0, 100),
    tracking: clamp(num(p.tracking, D.tracking), -12, 40),
    lineGap: clamp(num(p.lineGap, D.lineGap), -25, 80),
    grain: clamp(Math.round(num(p.grain, D.grain)), 0, 100),
    strokeWidth: clamp(num(p.strokeWidth, D.strokeWidth), 0, 12),
    style: oneOf(p.style, ['color', 'shaded', 'bw'] as const, D.style),
    themeId: PALETTES.some((t) => t.id === p.themeId) ? p.themeId : D.themeId,
    colorStrategy: oneOf(p.colorStrategy, ['byLine', 'byGlyph', 'single'] as const, D.colorStrategy),
    width: clamp(Math.round(num(p.width, D.width)), 100, 4000),
    height: clamp(Math.round(num(p.height, D.height)), 100, 4000),
    seed: Math.round(num(p.seed, D.seed)),
  };
}

/**
 * Params → the drawable composition.
 *
 * Geometry, color and grain draw from separate rng streams, so recoloring or
 * dialing grain never moves a letter.
 */
export function compose(raw: WarpParams): Composition {
  const params = clampParams(raw);
  const rngGeo = mulberry32(params.seed);
  const rngColor = mulberry32((params.seed ^ 0x9e3779b9) >>> 0);
  const rngGrain = mulberry32((params.seed ^ 0x85ebca6b) >>> 0);

  const font = getFont(params.fontId);
  const flat = layout({
    text: params.text,
    font,
    fit: params.fit,
    tracking: params.tracking,
    lineGap: params.lineGap,
    width: params.width,
    height: params.height,
  });

  const surface = makeSurface(
    {
      surface: params.surface,
      width: params.width,
      height: params.height,
      wave: params.wave,
      folds: params.folds,
      swell: params.swell,
      capHeight: flat.capHeight,
    },
    rngGeo,
  );

  const glyphs = flat.glyphs.map((g) => warpGlyph(g, surface, params, rngGeo));
  refit(glyphs, flat.box);

  const palette = getPalette(params.themeId);
  const fills = assignFills(glyphs, params.style, params.colorStrategy, palette, rngColor);
  const grain =
    params.style === 'bw' || params.grain === 0
      ? { light: '', dark: '', count: 0 }
      : grainSpecks(glyphs, params, rngGrain);

  return { params, font, palette, glyphs, fills, grain, lineCount: flat.lineCount };
}

/**
 * One letter onto the cloth, in two stages: the whole glyph rides its baseline
 * anchor (displaced, tipped with the local slope, swollen, plus a hand-lettered
 * wobble), then every point picks up the difference between the cloth under it
 * and the cloth under the anchor — which is what actually bends the letterform
 * instead of just moving it.
 */
function warpGlyph(g: PlacedGlyph, surface: Surface, p: WarpParams, rng: () => number): WarpedGlyph {
  const j = p.jitter / 100;
  const rot = (rng() * 2 - 1) * j * 0.1;
  const ox = (rng() * 2 - 1) * j * 0.03 * g.capHeight;
  const oy = (rng() * 2 - 1) * j * 0.06 * g.capHeight;
  const jsx = 1 + (rng() * 2 - 1) * j * 0.09;
  const jsy = 1 + (rng() * 2 - 1) * j * 0.14;

  const anchor = surface.sample(g.ax, g.ay);
  const theta = Math.atan(anchor.slope) * (p.lean / 100) + rot;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const sy = Math.max(0.15, (1 + anchor.swell) * jsy);
  const sx = Math.max(0.15, jsx);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const contours = g.contours.map((poly) =>
    poly.map((pt) => {
      const lx = (pt.x - g.ax) * sx;
      const ly = (pt.y - g.ay) * sy;
      const bx = g.ax + lx * cos - ly * sin + ox;
      const by = g.ay + lx * sin + ly * cos + oy;
      const local = surface.sample(bx, by);
      const x = bx + anchor.dx + (local.dx - anchor.dx) * RESIDUAL;
      const y = by + anchor.dy + (local.dy - anchor.dy) * RESIDUAL;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return { x, y };
    }),
  );

  return { char: g.char, line: g.line, contours, lit: anchor.lit, minX, minY, maxX, maxY };
}

/**
 * The warp pushes the block past the margins it was laid out to fill, so the
 * whole thing gets scaled back (never up) and recentered. Keeps every setting —
 * including the extremes — composed inside the frame.
 */
function refit(glyphs: WarpedGlyph[], box: { x: number; y: number; w: number; h: number }): void {
  if (glyphs.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of glyphs) {
    if (g.minX < minX) minX = g.minX;
    if (g.minY < minY) minY = g.minY;
    if (g.maxX > maxX) maxX = g.maxX;
    if (g.maxY > maxY) maxY = g.maxY;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return;

  const k = Math.min(1, box.w / w, box.h / h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = box.x + box.w / 2;
  const ty = box.y + box.h / 2;
  const map = (x: number, y: number): Pt => ({ x: tx + (x - cx) * k, y: ty + (y - cy) * k });

  for (const g of glyphs) {
    for (const poly of g.contours) {
      for (const pt of poly) {
        const m = map(pt.x, pt.y);
        pt.x = m.x;
        pt.y = m.y;
      }
    }
    const a = map(g.minX, g.minY);
    const b = map(g.maxX, g.maxY);
    g.minX = a.x;
    g.minY = a.y;
    g.maxX = b.x;
    g.maxY = b.y;
  }
}
