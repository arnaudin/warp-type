import { RNG } from './rng';
import type { WarpedGlyph, WarpParams } from './composer';

export interface GrainLayer {
  /** Path data for the pale specks, many subpaths in one string. */
  light: string;
  /** Path data for the dark specks. */
  dark: string;
  count: number;
}

const MAX_SPECKS = 2400;

/**
 * Print speckle, as two paths rather than two thousand nodes.
 *
 * Every speck is a tiny irregular polygon; specks that land on a letter mostly
 * go dark (ink breaking up), specks on the background mostly go pale (dust),
 * which reads as cheap offset printing on either a dark or a light theme.
 * Bundling each set into a single multi-subpath `d` means Figma ends up with
 * two locked layers instead of a swamped layer list.
 */
export function grainSpecks(glyphs: WarpedGlyph[], p: WarpParams, rng: RNG): GrainLayer {
  const count = Math.round((p.grain / 100) * MAX_SPECKS);
  if (count === 0) return { light: '', dark: '', count: 0 };

  const unit = Math.min(p.width, p.height) / 1000;
  const light: string[] = [];
  const dark: string[] = [];

  for (let i = 0; i < count; i++) {
    const x = rng() * p.width;
    const y = rng() * p.height;
    const r = (0.5 + rng() * 1.4) * unit;
    const sides = 3 + Math.floor(rng() * 3);
    const spin = rng() * Math.PI * 2;
    const roll = rng();

    const onInk = hitsInk(glyphs, x, y);
    const bucket = onInk ? (roll < 0.75 ? dark : light) : roll < 0.6 ? light : dark;

    let d = '';
    for (let k = 0; k < sides; k++) {
      const a = spin + (k / sides) * Math.PI * 2;
      const rr = r * (0.6 + 0.55 * ((k * 7 + i) % 5) * 0.25);
      const px = (x + Math.cos(a) * rr).toFixed(2);
      const py = (y + Math.sin(a) * rr).toFixed(2);
      d += `${k === 0 ? 'M' : 'L'}${px} ${py}`;
    }
    bucket.push(d + 'Z');
  }

  return { light: light.join(''), dark: dark.join(''), count };
}

/** Is this point inside a letter? Bounding boxes reject almost everything, so
 *  the crossing test only runs for the one glyph a speck can actually be in. */
function hitsInk(glyphs: WarpedGlyph[], x: number, y: number): boolean {
  for (const g of glyphs) {
    if (x < g.minX || x > g.maxX || y < g.minY || y > g.maxY) continue;
    let inside = false;
    for (const poly of g.contours) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
      }
    }
    // Counters (the hole in an O) flip the parity back off, which is what we want.
    if (inside) return true;
  }
  return false;
}
