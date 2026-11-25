/**
 * Minimal dependency-free TrueType reader — build-time only.
 *
 * Reads exactly the tables needed to turn a character into an outline:
 * head/maxp/hhea/hmtx for metrics, cmap for character→glyph, loca+glyf for
 * the outlines themselves. All four bundled faces are `glyf`-flavored, so
 * there is no CFF path here.
 */

class Reader {
  constructor(buf, pos = 0) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = pos;
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  i8() {
    return this.view.getInt8(this.pos++);
  }
  u16() {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  f2dot14() {
    return this.i16() / 16384;
  }
  tag() {
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8());
    return s;
  }
}

function readTableDirectory(buf) {
  const r = new Reader(buf);
  const version = r.u32();
  if (version === 0x74746366) throw new Error('TrueType collections (.ttc) are not supported');
  const numTables = r.u16();
  r.pos += 6;
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag();
    r.u32(); // checksum
    const offset = r.u32();
    const length = r.u32();
    tables[tag] = { offset, length };
  }
  return tables;
}

/** Character code → glyph index, from the best available cmap subtable. */
function readCmap(buf, tbl) {
  const r = new Reader(buf, tbl.offset);
  r.u16(); // version
  const numTables = r.u16();
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < numTables; i++) {
    const platformId = r.u16();
    const encodingId = r.u16();
    const offset = r.u32();
    // Prefer full-repertoire Unicode (3,10), then BMP (3,1), then any Unicode (0,*).
    const score =
      platformId === 3 && encodingId === 10
        ? 3
        : platformId === 3 && encodingId === 1
          ? 2
          : platformId === 0
            ? 1
            : 0;
    if (score > bestScore) {
      bestScore = score;
      best = tbl.offset + offset;
    }
  }
  if (best === null) throw new Error('no usable cmap subtable');

  const map = new Map();
  const s = new Reader(buf, best);
  const format = s.u16();

  if (format === 4) {
    s.u16(); // length
    s.u16(); // language
    const segCount = s.u16() / 2;
    s.pos += 6; // searchRange, entrySelector, rangeShift
    const endCodes = [];
    for (let i = 0; i < segCount; i++) endCodes.push(s.u16());
    s.u16(); // reservedPad
    const startCodes = [];
    for (let i = 0; i < segCount; i++) startCodes.push(s.u16());
    const idDeltas = [];
    for (let i = 0; i < segCount; i++) idDeltas.push(s.i16());
    const rangeOffsetPos = s.pos;
    const idRangeOffsets = [];
    for (let i = 0; i < segCount; i++) idRangeOffsets.push(s.u16());

    for (let seg = 0; seg < segCount; seg++) {
      for (let c = startCodes[seg]; c <= endCodes[seg] && c !== 0xffff; c++) {
        let gid;
        if (idRangeOffsets[seg] === 0) {
          gid = (c + idDeltas[seg]) & 0xffff;
        } else {
          const addr = rangeOffsetPos + seg * 2 + idRangeOffsets[seg] + (c - startCodes[seg]) * 2;
          const g = new Reader(buf, addr).u16();
          gid = g === 0 ? 0 : (g + idDeltas[seg]) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
  } else if (format === 12) {
    s.u16(); // reserved
    s.u32(); // length
    s.u32(); // language
    const nGroups = s.u32();
    for (let i = 0; i < nGroups; i++) {
      const start = s.u32();
      const end = s.u32();
      const startGid = s.u32();
      // Guard against pathological ranges (astral planes we never ask for).
      for (let c = start; c <= end && c - start < 0x10000; c++) map.set(c, startGid + (c - start));
    }
  } else {
    throw new Error(`unsupported cmap format ${format}`);
  }
  return map;
}

/**
 * Strings from the `name` table, keyed by name id (0 copyright, 1 family,
 * 4 full name, 7 trademark, 9 designer, 13 license, 14 license URL).
 * Attribution gets read from the font itself rather than transcribed by hand.
 */
function readNames(buf, tbl) {
  const r = new Reader(buf, tbl.offset);
  r.u16(); // format
  const count = r.u16();
  const stringOffset = r.u16();
  const names = new Map();
  for (let i = 0; i < count; i++) {
    const platformId = r.u16();
    const encodingId = r.u16();
    r.u16(); // languageId
    const nameId = r.u16();
    const length = r.u16();
    const offset = r.u16();
    const start = tbl.offset + stringOffset + offset;
    if (start + length > buf.byteLength) continue;
    const bytes = buf.subarray(start, start + length);
    // Platform 3 (Windows) and platform 0 (Unicode) are UTF-16BE; 1 is MacRoman.
    const utf16 = platformId === 3 || platformId === 0;
    let s = '';
    if (utf16) {
      for (let k = 0; k + 1 < bytes.length; k += 2) {
        s += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
      }
    } else if (platformId === 1 && encodingId === 0) {
      s = bytes.toString('latin1');
    } else {
      continue;
    }
    s = s.replace(/\s+/g, ' ').trim();
    // Prefer the first non-empty reading; Windows records come later and win ties.
    if (s && (!names.has(nameId) || (utf16 && names.get(nameId).length < s.length))) {
      names.set(nameId, s);
    }
  }
  return names;
}

function readLoca(buf, tbl, numGlyphs, longFormat) {
  const r = new Reader(buf, tbl.offset);
  const loca = new Array(numGlyphs + 1);
  for (let i = 0; i <= numGlyphs; i++) loca[i] = longFormat ? r.u32() : r.u16() * 2;
  return loca;
}

function readHmtx(buf, tbl, numberOfHMetrics, numGlyphs) {
  const r = new Reader(buf, tbl.offset);
  const adv = new Array(numGlyphs).fill(0);
  let last = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numberOfHMetrics) {
      last = r.u16();
      r.i16(); // lsb
    }
    adv[i] = last;
  }
  return adv;
}

const ON_CURVE = 1;
const X_SHORT = 2;
const Y_SHORT = 4;
const REPEAT = 8;
const X_SAME = 16;
const Y_SAME = 32;

/** Glyph outline as contours of {x, y, on} points, in font units. */
function readGlyphContours(font, gid, depth = 0) {
  const { buf, loca, glyfOffset } = font;
  if (gid < 0 || gid + 1 >= loca.length) return [];
  const start = loca[gid];
  const end = loca[gid + 1];
  if (end <= start) return []; // empty glyph (space)

  const r = new Reader(buf, glyfOffset + start);
  const numberOfContours = r.i16();
  r.pos += 8; // bbox

  if (numberOfContours < 0) {
    if (depth > 4) return [];
    return readCompositeGlyph(font, r, depth);
  }

  const endPts = [];
  for (let i = 0; i < numberOfContours; i++) endPts.push(r.u16());
  const numPoints = numberOfContours === 0 ? 0 : endPts[endPts.length - 1] + 1;
  const instructionLength = r.u16();
  r.pos += instructionLength;

  const flags = new Uint8Array(numPoints);
  for (let i = 0; i < numPoints; ) {
    const f = r.u8();
    flags[i++] = f;
    if (f & REPEAT) {
      let repeat = r.u8();
      while (repeat-- > 0 && i < numPoints) flags[i++] = f;
    }
  }

  const xs = new Int16Array(numPoints);
  let x = 0;
  for (let i = 0; i < numPoints; i++) {
    const f = flags[i];
    if (f & X_SHORT) x += (f & X_SAME ? 1 : -1) * r.u8();
    else if (!(f & X_SAME)) x += r.i16();
    xs[i] = x;
  }
  const ys = new Int16Array(numPoints);
  let y = 0;
  for (let i = 0; i < numPoints; i++) {
    const f = flags[i];
    if (f & Y_SHORT) y += (f & Y_SAME ? 1 : -1) * r.u8();
    else if (!(f & Y_SAME)) y += r.i16();
    ys[i] = y;
  }

  const contours = [];
  let p = 0;
  for (let c = 0; c < numberOfContours; c++) {
    const pts = [];
    for (; p <= endPts[c]; p++) pts.push({ x: xs[p], y: ys[p], on: !!(flags[p] & ON_CURVE) });
    if (pts.length > 1) contours.push(pts);
  }
  return contours;
}

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_A_SCALE = 0x0008;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

function readCompositeGlyph(font, r, depth) {
  const out = [];
  let more = true;
  while (more) {
    const flags = r.u16();
    const glyphIndex = r.u16();
    let dx = 0;
    let dy = 0;
    if (flags & ARG_1_AND_2_ARE_WORDS) {
      dx = r.i16();
      dy = r.i16();
    } else {
      dx = r.i8();
      dy = r.i8();
    }
    if (!(flags & ARGS_ARE_XY_VALUES)) {
      // Point-matching composites are vanishingly rare in Latin display faces.
      dx = 0;
      dy = 0;
    }
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    if (flags & WE_HAVE_A_SCALE) {
      a = d = r.f2dot14();
    } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
      a = r.f2dot14();
      d = r.f2dot14();
    } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
      a = r.f2dot14();
      b = r.f2dot14();
      c = r.f2dot14();
      d = r.f2dot14();
    }
    for (const contour of readGlyphContours(font, glyphIndex, depth + 1)) {
      out.push(
        contour.map((p) => ({
          x: Math.round(a * p.x + c * p.y + dx),
          y: Math.round(b * p.x + d * p.y + dy),
          on: p.on,
        })),
      );
    }
    more = !!(flags & MORE_COMPONENTS);
  }
  return out;
}

/**
 * TrueType contours → SVG path data (quadratics preserved, integer units).
 * Off-curve runs get their implied on-curve midpoints, per the spec.
 */
export function contoursToPath(contours) {
  let d = '';
  for (const pts of contours) {
    // Rotate so the contour starts on-curve; if none is, synthesize a midpoint.
    let startIdx = pts.findIndex((p) => p.on);
    let start;
    let ordered;
    if (startIdx === -1) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      start = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), on: true };
      ordered = pts.slice();
    } else {
      start = pts[startIdx];
      ordered = pts.slice(startIdx + 1).concat(pts.slice(0, startIdx));
    }

    d += `M${start.x} ${start.y}`;
    let i = 0;
    while (i < ordered.length) {
      const p = ordered[i];
      if (p.on) {
        d += `L${p.x} ${p.y}`;
        i++;
      } else {
        const next = ordered[i + 1];
        if (!next) {
          d += `Q${p.x} ${p.y} ${start.x} ${start.y}`;
          i++;
        } else if (next.on) {
          d += `Q${p.x} ${p.y} ${next.x} ${next.y}`;
          i += 2;
        } else {
          const mx = Math.round((p.x + next.x) / 2);
          const my = Math.round((p.y + next.y) / 2);
          d += `Q${p.x} ${p.y} ${mx} ${my}`;
          i++;
        }
      }
    }
    d += 'Z';
  }
  return d;
}

/** Parse a .ttf buffer into something we can ask for glyphs by character. */
export function parseFont(buf) {
  const tables = readTableDirectory(buf);
  for (const required of ['head', 'maxp', 'cmap', 'loca', 'glyf', 'hhea', 'hmtx']) {
    if (!tables[required]) throw new Error(`missing required table: ${required}`);
  }
  const head = new Reader(buf, tables.head.offset);
  head.pos = tables.head.offset + 18;
  const unitsPerEm = head.u16();
  head.pos = tables.head.offset + 50;
  const indexToLocFormat = head.i16();

  const maxp = new Reader(buf, tables.maxp.offset + 4);
  const numGlyphs = maxp.u16();

  const hhea = new Reader(buf, tables.hhea.offset + 4);
  const ascender = hhea.i16();
  const descender = hhea.i16();
  hhea.pos = tables.hhea.offset + 34;
  const numberOfHMetrics = hhea.u16();

  const font = {
    buf,
    unitsPerEm,
    ascender,
    descender,
    numGlyphs,
    names: tables.name ? readNames(buf, tables.name) : new Map(),
    cmap: readCmap(buf, tables.cmap),
    loca: readLoca(buf, tables.loca, numGlyphs, indexToLocFormat === 1),
    glyfOffset: tables.glyf.offset,
    advances: readHmtx(buf, tables.hmtx, numberOfHMetrics, numGlyphs),
  };

  font.glyphFor = (ch) => {
    const gid = font.cmap.get(ch.codePointAt(0));
    if (gid === undefined) return null;
    const contours = readGlyphContours(font, gid);
    let yMax = 0;
    for (const contour of contours) for (const p of contour) yMax = Math.max(yMax, p.y);
    return { gid, adv: font.advances[gid], d: contoursToPath(contours), yMax };
  };
  return font;
}
