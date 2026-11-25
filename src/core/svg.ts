import { Composition } from './composer';
import { Pt } from './fonts';

export interface GlyphShape {
  id: string;
  /** Group this shape belongs to, e.g. "line-01". */
  group: string;
  d: string;
  fill: string;
}

/** Stable id/path/fill triples, one per letter. Both the serializer and the
 *  Figma layer-name map derive from this, so the names always agree. */
export function glyphShapes(c: Composition): GlyphShape[] {
  const shapes: GlyphShape[] = [];
  c.glyphs.forEach((g, i) => {
    const d = g.contours.map(polyPath).join('');
    if (!d) return;
    shapes.push({
      id: `glyph-${String(shapes.length + 1).padStart(3, '0')}`,
      group: `line-${String(g.line + 1).padStart(2, '0')}`,
      d,
      fill: c.fills[i],
    });
  });
  return shapes;
}

function polyPath(poly: Pt[]): string {
  if (poly.length < 3) return '';
  let d = '';
  for (let i = 0; i < poly.length; i++) {
    d += `${i === 0 ? 'M' : 'L'}${poly[i].x.toFixed(2)} ${poly[i].y.toFixed(2)}`;
  }
  return d + 'Z';
}

/** "glyph-042" → "Glyph 042", "grain-light" → "Grain Light". */
export function prettyName(id: string): string {
  const title = (s: string) =>
    s
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const m = /^([a-z-]+)-(\d+)$/.exec(id);
  if (m) return `${title(m[1])} ${m[2]}`;
  if (/^[a-z-]+$/.test(id)) return title(id);
  return id;
}

/** Figma layer name → generated fill hex, matching what main.ts names things.
 *  Drives manual-recolor detection on update. */
export function layerFills(c: Composition): Map<string, string> {
  const map = new Map<string, string>();
  map.set('Background', backgroundOf(c));
  for (const s of glyphShapes(c)) map.set(prettyName(s.id), s.fill);
  if (c.grain.light) map.set('Grain Light', '#ffffff');
  if (c.grain.dark) map.set('Grain Dark', '#000000');
  return map;
}

function backgroundOf(c: Composition): string {
  return c.params.style === 'bw' ? '#ffffff' : c.palette.bg;
}

/**
 * Serialize a composition. Each letter is its own closed `<path>`, grouped by
 * line, so `figma.createNodeFromSvg` yields one selectable, recolorable vector
 * per letter inside a group per word. Counters ride along as extra subpaths of
 * the same path, filled nonzero, so they stay real holes.
 */
export function toSVG(c: Composition, shapes: GlyphShape[] = glyphShapes(c)): string {
  const { params, palette } = c;
  const bw = params.style === 'bw';
  const stroke = bw ? '#111111' : palette.ink;
  const strokeW = bw ? Math.max(0.75, params.strokeWidth) : params.strokeWidth;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">`,
    `  <rect id="background" width="${params.width}" height="${params.height}" fill="${backgroundOf(c)}"/>`,
  ];

  let openGroup = '';
  for (const s of shapes) {
    if (s.group !== openGroup) {
      if (openGroup) out.push('  </g>');
      out.push(`  <g id="${s.group}">`);
      openGroup = s.group;
    }
    const attrs = [`id="${s.id}"`, `d="${s.d}"`, `fill="${s.fill}"`, 'fill-rule="nonzero"'];
    if (strokeW > 0) {
      attrs.push(`stroke="${stroke}"`, `stroke-width="${strokeW}"`, 'stroke-linejoin="round"');
    }
    out.push(`    <path ${attrs.join(' ')}/>`);
  }
  if (openGroup) out.push('  </g>');

  if (c.grain.light || c.grain.dark) {
    out.push('  <g id="effects">');
    if (c.grain.light) {
      out.push(
        `    <path id="grain-light" d="${c.grain.light}" fill="#ffffff" fill-opacity="0.22" fill-rule="nonzero"/>`,
      );
    }
    if (c.grain.dark) {
      out.push(
        `    <path id="grain-dark" d="${c.grain.dark}" fill="#000000" fill-opacity="0.26" fill-rule="nonzero"/>`,
      );
    }
    out.push('  </g>');
  }

  out.push('</svg>');
  return out.join('\n');
}
