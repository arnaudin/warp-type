import { Palette } from './palettes';
import { RNG } from './rng';

export type StyleId = 'color' | 'shaded' | 'bw';
export type ColorStrategy = 'byLine' | 'byGlyph' | 'single';

export const STRATEGIES: { id: ColorStrategy; name: string }[] = [
  { id: 'byLine', name: 'By line' },
  { id: 'byGlyph', name: 'By letter' },
  { id: 'single', name: 'One color' },
];

/** Enough of a glyph for coloring: which line it sits on and how the cloth
 *  under it is tipped toward the light. */
export interface Colorable {
  line: number;
  lit: number;
}

export function assignFills(
  glyphs: Colorable[],
  style: StyleId,
  strategy: ColorStrategy,
  palette: Palette,
  rng: RNG,
): string[] {
  if (style === 'bw') return glyphs.map(() => '#ffffff');
  const colors = palette.colors;
  let prev = -1;
  return glyphs.map((g) => {
    let base: string;
    if (strategy === 'byGlyph') {
      // Random rather than cycling, so letters don't fall into a visible
      // repeat — but never twice in a row, so neighbors stay distinct.
      let k = Math.floor(rng() * colors.length) % colors.length;
      if (k === prev && colors.length > 1) k = (k + 1) % colors.length;
      prev = k;
      base = colors[k];
    } else if (strategy === 'single') {
      base = colors[0];
    } else {
      base = colors[g.line % colors.length];
    }
    return style === 'shaded' ? shade(base, g.lit) : base;
  });
}

/** Light raking across the cloth from the left: faces tipped toward it lift
 *  toward white, faces tipped away sink toward black. */
function shade(base: string, lit: number): string {
  const t = Math.max(-1, Math.min(1, lit));
  return t >= 0 ? hexLerp(base, '#ffffff', t * 0.38) : hexLerp(base, '#0b0b0b', -t * 0.42);
}

export function hexLerp(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const mix = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  const to = (v: number) => v.toString(16).padStart(2, '0');
  return (
    '#' +
    to(mix((na >> 16) & 255, (nb >> 16) & 255)) +
    to(mix((na >> 8) & 255, (nb >> 8) & 255)) +
    to(mix(na & 255, nb & 255))
  );
}
