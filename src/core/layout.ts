import { BakedFont, outline, Pt } from './fonts';

export type FitId = 'stretch' | 'scale' | 'none';

export const FITS: { id: FitId; name: string; blurb: string }[] = [
  { id: 'stretch', name: 'Stretch', blurb: 'One cap height, letters widened to fill each line' },
  { id: 'scale', name: 'Scale', blurb: 'Each line resized to fill — short words go huge' },
  { id: 'none', name: 'Plain', blurb: 'One size, lines centered at their natural width' },
];

export const MAX_LINES = 14;
export const MAX_LINE_CHARS = 48;
/** Margin around the type block, as a fraction of the frame's short side. */
export const PAD_FRACTION = 0.035;
/** How far Stretch will widen a line's letters to reach the measure. */
const MAX_STRETCH = 1.2;

export interface PlacedGlyph {
  char: string;
  line: number;
  /** Closed polygons, px, y-down, before any warp. */
  contours: Pt[][];
  /** Baseline center of the glyph — the warp's anchor for this letter. */
  ax: number;
  ay: number;
  /** Cap height of the line this glyph sits on, px. */
  capHeight: number;
}

export interface LayoutSpec {
  text: string;
  font: BakedFont;
  fit: FitId;
  /** Letter spacing, % of em. Negative crowds letters together. */
  tracking: number;
  /** Extra leading, % of cap height. Negative overlaps lines. */
  lineGap: number;
  width: number;
  height: number;
}

export interface Layout {
  glyphs: PlacedGlyph[];
  lineCount: number;
  /** Representative cap height, px — amplitude reference for the warp. */
  capHeight: number;
  box: { x: number; y: number; w: number; h: number };
}

/** Text split into the lines we will actually set, with unsupported characters dropped. */
export function textLines(text: string, font: BakedFont): string[] {
  return text
    .split('\n')
    .slice(0, MAX_LINES)
    .map((line) =>
      Array.from(line.slice(0, MAX_LINE_CHARS))
        .filter((ch) => font.glyphs[ch] !== undefined)
        .join('')
        .replace(/^ +| +$/g, ''),
    );
}

/** Natural width of a line, in px per 1px of cap height. */
function aspect(line: string, font: BakedFont, trackEm: number): number {
  const chars = Array.from(line);
  if (chars.length === 0) return 0;
  let units = 0;
  for (const ch of chars) units += font.glyphs[ch]?.[0] ?? 0;
  units += trackEm * font.unitsPerEm * (chars.length - 1);
  return Math.max(0.05, units / font.capHeight);
}

/**
 * Text → glyph polygons placed in the frame, unwarped.
 *
 * The fit modes are the whole trick behind the sleeve look. `stretch` holds one
 * cap height for the block and widens each line's letters to fill the measure,
 * which is why a five-letter word and a seven-letter word can be the same height
 * and the same width; `scale` resizes whole lines instead, so short words tower.
 */
export function layout(spec: LayoutSpec): Layout {
  const { font } = spec;
  const pad = Math.min(spec.width, spec.height) * PAD_FRACTION;
  const box = { x: pad, y: pad, w: spec.width - 2 * pad, h: spec.height - 2 * pad };
  const lines = textLines(spec.text, font);
  const trackEm = spec.tracking / 100;
  const gap = Math.max(-0.45, spec.lineGap / 100);
  const n = lines.length;
  const glyphs: PlacedGlyph[] = [];
  if (n === 0 || box.w <= 0 || box.h <= 0) {
    return { glyphs, lineCount: 0, capHeight: 1, box };
  }

  const aspects = lines.map((line) => aspect(line, font, trackEm));
  const drawn = aspects.filter((a) => a > 0.05);
  const medianAspect = drawn.length
    ? drawn.slice().sort((a, b) => a - b)[Math.floor(drawn.length / 2)]
    : 1;

  // Per-line cap height and horizontal stretch.
  let caps: number[];
  let xScales: number[];

  if (spec.fit === 'scale') {
    // Every line wants the width; solve for the common factor that also makes
    // the stack fill the height.
    const want = aspects.map((a) => box.w / (a > 0.05 ? a : medianAspect));
    const mean = want.reduce((s, v) => s + v, 0) / n;
    const total = want.reduce((s, v) => s + v, 0) + gap * mean * (n - 1);
    const k = Math.min(1, box.h / Math.max(1e-6, total));
    caps = want.map((v) => v * k);
    xScales = caps.map(() => 1);
  } else {
    const cap = box.h / Math.max(0.2, 1 + (n - 1) * (1 + gap));
    caps = aspects.map(() => cap);
    if (spec.fit === 'stretch') {
      xScales = [];
      for (let i = 0; i < n; i++) {
        const a = aspects[i];
        if (a <= 0.05) {
          xScales.push(1);
          continue;
        }
        const need = box.w / (a * cap);
        const x = Math.min(MAX_STRETCH, Math.max(0.55, need));
        xScales.push(x);
        // A line too short to reach the measure even at full stretch (a lone
        // "OF" between long words) gives up some cap height rather than sitting
        // there monstrously wide — which is what hand-lettered sleeves do.
        if (need > x) caps[i] = cap * Math.max(0.55, Math.pow(x / need, 0.28));
      }
      // Give back the height those shortened lines released.
      const stack = caps.reduce((s, v) => s + v, 0) + gap * cap * (n - 1);
      if (stack > 0) {
        const k = box.h / stack;
        for (let i = 0; i < n; i++) caps[i] *= k;
      }
    } else {
      xScales = aspects.map(() => 1);
    }
    // Anything still wider than the measure gets scaled down rather than clipped.
    for (let i = 0; i < n; i++) {
      const w = aspects[i] * caps[i] * xScales[i];
      if (w > box.w) caps[i] *= box.w / w;
    }
  }

  // Baselines: cap boxes stacked with `gap` of the local cap height between them.
  const baselines: number[] = [];
  let cursor = box.y;
  for (let i = 0; i < n; i++) {
    cursor += caps[i];
    baselines.push(cursor);
    if (i < n - 1) cursor += ((caps[i] + caps[i + 1]) / 2) * gap;
  }
  // Center the stack vertically (it can come up short of the box in `scale` fit).
  const shift = (box.y + box.h - cursor) / 2;
  for (let i = 0; i < n; i++) baselines[i] += shift;

  for (let i = 0; i < n; i++) {
    const chars = Array.from(lines[i]);
    if (chars.length === 0) continue;
    const unit = caps[i] / font.capHeight; // px per font unit
    const sx = unit * xScales[i];
    const lineWidth = aspects[i] * caps[i] * xScales[i];
    const baseline = baselines[i];
    const maxSeg = caps[i] * 0.09;
    let pen = box.x + (box.w - lineWidth) / 2;

    for (const ch of chars) {
      const ol = outline(font, ch);
      if (!ol) continue;
      const advance = ol.adv * sx;
      if (ol.contours.length > 0) {
        const contours: Pt[][] = [];
        for (const contour of ol.contours) {
          const poly: Pt[] = [];
          for (const p of contour) poly.push({ x: pen + p.x * sx, y: baseline - p.y * unit });
          contours.push(resample(poly, maxSeg));
        }
        glyphs.push({
          char: ch,
          line: i,
          contours,
          ax: pen + advance / 2,
          ay: baseline,
          capHeight: caps[i],
        });
      }
      pen += advance + trackEm * font.unitsPerEm * sx;
    }
  }

  return {
    glyphs,
    lineCount: n,
    capHeight: caps.reduce((s, v) => s + v, 0) / n,
    box,
  };
}

/**
 * Adds points along long edges so the warp has something to bend.
 * Without this a stem is two endpoints and stays ruler-straight no matter what
 * the cloth underneath it is doing.
 */
function resample(poly: Pt[], maxSeg: number): Pt[] {
  const out: Pt[] = [];
  const step = Math.max(0.5, maxSeg);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue; // drop duplicate points from the source outline
    out.push(a);
    const splits = Math.min(64, Math.floor(len / step));
    for (let k = 1; k <= splits; k++) {
      const t = k / (splits + 1);
      out.push({ x: a.x + dx * t, y: a.y + dy * t });
    }
  }
  return out;
}
