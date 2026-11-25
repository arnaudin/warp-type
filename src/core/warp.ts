import { RNG } from './rng';

export type SurfaceId = 'cloth' | 'flag' | 'arch' | 'bulge';

export const SURFACES: { id: SurfaceId; name: string; blurb: string }[] = [
  { id: 'cloth', name: 'Cloth', blurb: 'Loose fabric rippling in two directions' },
  { id: 'flag', name: 'Flag', blurb: 'Pinned at the left, waving harder to the right' },
  { id: 'arch', name: 'Arch', blurb: 'One clean bow across the measure' },
  { id: 'bulge', name: 'Bulge', blurb: 'Lens pushing out from the center' },
];

/** What the surface does to one point of the cloth. */
export interface Sample {
  /** Displacement, px. */
  dx: number;
  dy: number;
  /** d(dy)/dx — how steeply the cloth tips here, drives letter lean. */
  slope: number;
  /** Vertical scale delta: >0 where the cloth swells toward the viewer. */
  swell: number;
  /** Slope normalized to ~[-1, 1] and independent of amplitude — the shading
   *  term, so lit/shadowed sides read even at low wave. */
  lit: number;
}

export interface Surface {
  sample(x: number, y: number): Sample;
}

export interface SurfaceSpec {
  surface: SurfaceId;
  width: number;
  height: number;
  /** 0–100 slider. */
  wave: number;
  /** Full waves across the measure. */
  folds: number;
  /** 0–100 slider. */
  swell: number;
  /** Reference length for amplitude — the type's cap height, px. */
  capHeight: number;
}

interface Wave {
  a: number;
  w: number;
  cos: number;
  sin: number;
  phase: number;
}

const HARMONICS = [1, 1.9, 3.3, 5.1];

/**
 * The cloth, as a small sum of seeded plane waves.
 *
 * Everything is analytic — the slope comes from differentiating the sum rather
 * than sampling twice and dividing, which keeps it exact and takes divisions
 * (and so NaNs) out of the hot path entirely.
 */
export function makeSurface(spec: SurfaceSpec, rng: RNG): Surface {
  const amp = (spec.wave / 100) * spec.capHeight * 0.6;
  const swellAmt = (spec.swell / 100) * 0.42;
  const folds = Math.max(0.15, spec.folds);
  const base = (2 * Math.PI * folds) / Math.max(1, spec.width);

  if (spec.surface === 'bulge') return bulgeSurface(spec, amp, swellAmt);
  if (spec.surface === 'arch') return archSurface(spec, amp, swellAmt, folds, rng);

  const flag = spec.surface === 'flag';
  // Keep the wavefronts near-vertical: the more they tilt, the more the ripple
  // varies down the page, and stacked lines start colliding instead of rippling.
  const spread = flag ? 0.1 : 0.26;
  const count = flag ? 3 : 4;

  const waves: Wave[] = [];
  let norm = 0;
  for (let k = 0; k < count; k++) {
    const a = 1 / Math.pow(k + 1, 1.3);
    const theta = (rng() * 2 - 1) * spread;
    const w = base * HARMONICS[k] * (0.85 + rng() * 0.3);
    waves.push({ a, w, cos: Math.cos(theta), sin: Math.sin(theta), phase: rng() * Math.PI * 2 });
    norm += a;
  }
  for (const wv of waves) wv.a /= norm;
  // Largest slope the stack can produce, for normalizing the shading term.
  let slopeNorm = 0;
  for (const wv of waves) slopeNorm += wv.a * wv.w * Math.abs(wv.cos);
  slopeNorm = slopeNorm || 1;

  const invW = 1 / Math.max(1, spec.width);

  return {
    sample(x: number, y: number): Sample {
      let h = 0;
      let dh = 0;
      let sw = 0;
      for (const wv of waves) {
        const t = wv.w * (x * wv.cos + y * wv.sin) + wv.phase;
        h += wv.a * Math.sin(t);
        dh += wv.a * wv.w * wv.cos * Math.cos(t);
        sw += wv.a * Math.cos(t + 1.25);
      }
      // A flag is pinned at its left edge: the same waves, opened up to the right.
      let env = 1;
      let denv = 0;
      if (flag) {
        env = 0.18 + 0.82 * Math.min(1, Math.max(0, x * invW));
        denv = 0.82 * invW;
      }
      return {
        dx: 0,
        dy: amp * env * h,
        slope: amp * (env * dh + denv * h),
        swell: swellAmt * sw * env,
        lit: (env * dh) / slopeNorm,
      };
    },
  };
}

function archSurface(spec: SurfaceSpec, amp: number, swellAmt: number, folds: number, rng: RNG): Surface {
  const invW = 1 / Math.max(1, spec.width);
  const invH = 1 / Math.max(1, spec.height);
  const k = Math.PI * folds;
  const wobblePhase = rng() * Math.PI * 2;
  const wobbleW = base2(spec.width, folds);
  const slopeNorm = k * invW + 0.12 * wobbleW || 1;
  return {
    sample(x: number, y: number): Sample {
      const u = x * invW - 0.5;
      // Lines further down the block bow harder, so the block fans open.
      const fan = 0.55 + 0.45 * Math.min(1, Math.max(0, y * invH));
      const h = -Math.cos(k * u) * fan + 0.12 * Math.sin(wobbleW * x + wobblePhase);
      const dh =
        k * invW * Math.sin(k * u) * fan + 0.12 * wobbleW * Math.cos(wobbleW * x + wobblePhase);
      return {
        dx: 0,
        dy: amp * h,
        slope: amp * dh,
        swell: swellAmt * -Math.cos(k * u),
        lit: dh / slopeNorm,
      };
    },
  };
}

function base2(width: number, folds: number): number {
  return (2 * Math.PI * (folds * 2.7)) / Math.max(1, width);
}

function bulgeSurface(spec: SurfaceSpec, amp: number, swellAmt: number): Surface {
  const cx = spec.width / 2;
  const cy = spec.height / 2;
  const R = 0.5 * Math.hypot(spec.width, spec.height);
  const invR2 = 1 / (R * R);
  const k = (amp * 1.9) / R;
  return {
    sample(x: number, y: number): Sample {
      const px = x - cx;
      const py = y - cy;
      const f = Math.max(0, 1 - (px * px + py * py) * invR2);
      const slope = k * py * (-2 * px * invR2);
      return {
        dx: k * px * f,
        dy: k * py * f,
        slope,
        swell: swellAmt * (2 * f - 1),
        lit: Math.max(-1, Math.min(1, (-2 * px * invR2) * R * 0.5)),
      };
    },
  };
}
