import { BAKED } from './data';
import type { BakedFont } from './types';

export type { BakedFont };
export const FONTS = BAKED;

export function getFont(id: string): BakedFont {
  return BAKED.find((f) => f.id === id) ?? BAKED[0];
}

export interface Pt {
  x: number;
  y: number;
}

export interface Outline {
  /** Advance width, font units. */
  adv: number;
  /** Closed polygons in font units, y-up. Empty for space. */
  contours: Pt[][];
}

const EMPTY: Outline = { adv: 0, contours: [] };
const cache = new Map<string, Outline>();

/**
 * A character's outline as flat polygons, memoized per font+char.
 *
 * Curves are flattened once here, in font units, at a tolerance fine enough for
 * any canvas the plugin allows; the warp then resamples in pixel space, where it
 * knows how long a segment is allowed to get. Returns null for characters the
 * face doesn't carry, so layout can drop them.
 */
export function outline(font: BakedFont, char: string): Outline | null {
  const key = `${font.id}:${char}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const entry = font.glyphs[char];
  if (!entry) return null;
  const [adv, d] = entry;
  if (!d) {
    const blank: Outline = { adv, contours: [] };
    cache.set(key, blank);
    return blank;
  }

  const tol = font.unitsPerEm * 0.0012;
  const contours: Pt[][] = [];
  let pts: Pt[] = [];
  let cx = 0;
  let cy = 0;

  // The baked path data is the narrow subset bake-fonts.mjs emits: M/L/Q/Z with
  // space-separated integers, so a hand-rolled scan beats a general parser.
  const nums = /-?\d+/g;
  for (let i = 0; i < d.length; i++) {
    const cmd = d[i];
    if (cmd === 'Z') {
      if (pts.length > 2) contours.push(pts);
      pts = [];
      continue;
    }
    if (cmd !== 'M' && cmd !== 'L' && cmd !== 'Q') continue;
    nums.lastIndex = i + 1;
    const take = (): number => {
      const m = nums.exec(d);
      return m ? Number(m[0]) : 0;
    };
    if (cmd === 'M' || cmd === 'L') {
      cx = take();
      cy = take();
      pts.push({ x: cx, y: cy });
    } else {
      const qx = take();
      const qy = take();
      const ex = take();
      const ey = take();
      flattenQuad(pts, cx, cy, qx, qy, ex, ey, tol);
      cx = ex;
      cy = ey;
    }
    i = nums.lastIndex - 1;
  }
  if (pts.length > 2) contours.push(pts);

  const result: Outline = { adv, contours };
  cache.set(key, result);
  return result;
}

/** Quadratic → line segments. Segment count from the curve's own deviation, so
 *  flat curves stay cheap and tight ones stay smooth. */
function flattenQuad(
  out: Pt[],
  x0: number,
  y0: number,
  qx: number,
  qy: number,
  x1: number,
  y1: number,
  tol: number,
): void {
  const ax = x0 - 2 * qx + x1;
  const ay = y0 - 2 * qy + y1;
  const dev = Math.sqrt(ax * ax + ay * ay);
  const n = Math.max(1, Math.min(24, Math.ceil(Math.sqrt(dev / (8 * tol)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    out.push({
      x: mt * mt * x0 + 2 * mt * t * qx + t * t * x1,
      y: mt * mt * y0 + 2 * mt * t * qy + t * t * y1,
    });
  }
}

export function blankOutline(): Outline {
  return EMPTY;
}
