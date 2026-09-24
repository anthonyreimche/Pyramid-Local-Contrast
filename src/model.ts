// The maths, pure: an undecimated B3-spline pyramid of log2 luminance with
// bilateral range weighting, one gain per scale, and the summed correction
// applied as a multiplier on RGB. Mirrors the GPU chain (glsl.ts) tap for tap
// — bilinear reads with clamp-to-edge, the linear norm carried and the log
// taken per tap, the level carried as an offset from the pixel's own log
// luminance — so the SwiftShader run can hold the stage to this reference.

export const SCALES = 8;
/** Long edge (px) at which scale 1 is one texel: the Develop preview cap. */
export const REFERENCE_EDGE = 2560;
export const B3: readonly number[] = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
/** Keeps log2 finite at black. */
export const EPSILON = 2 ** -16;
/** One scale's detail, EV. */
export const DETAIL_CLAMP = 5;
/** The summed correction, EV. */
export const TOTAL_CLAMP = 8;

export interface Params {
  /** Per-scale gain in percent, −100…100; scale 1 (the finest) first. */
  scales: readonly number[];
  /** −100…100; positive protects edges from halos. */
  halo: number;
  /** Percent of scene white, 0…5. */
  noiseFloor: number;
}

export const DEFAULT_PARAMS: Params = { scales: Array.from({ length: SCALES }, () => 0), halo: 0, noiseFloor: 0 };

/** The power norm: the value for greys, between the mean and the max for
 *  saturated colours, never near zero for a bright primary the way Rec. 709
 *  luma is for blue. */
export function luminance(r: number, g: number, b: number): number {
  return Math.sqrt((r * r + g * g + b * b) / 3);
}

export function logLuminance(n: number, floor: number): number {
  return Math.log2(Math.max(n, 0) + floor + EPSILON);
}

/** The dilation of scale `scale` (0-based) in texels of a frame with this long edge. */
export function step(scale: number, longEdge: number): number {
  return (2 ** scale * longEdge) / REFERENCE_EDGE;
}

/** The bilateral range sigma in EV: 1 at rest, 0.25 at +100, 4 at −100. */
export function rangeSigma(halo: number): number {
  return 2 ** (-halo / 50);
}

export function gainFraction(percent: number): number {
  return percent * 0.01;
}

export function noiseFloorLinear(percent: number): number {
  return percent * 0.01;
}

export function clampDetail(d: number): number {
  return d < -DETAIL_CLAMP ? -DETAIL_CLAMP : d > DETAIL_CLAMP ? DETAIL_CLAMP : d;
}

export function correctionMultiplier(acc: number): number {
  const c = acc < -TOTAL_CLAMP ? -TOTAL_CLAMP : acc > TOTAL_CLAMP ? TOTAL_CLAMP : acc;
  return 2 ** c;
}

export function effectActive(p: Params): boolean {
  return p.scales.some((g) => g !== 0);
}

export interface Image {
  /** RGB interleaved, top-down rows. */
  data: Float64Array;
  width: number;
  height: number;
}

export interface Decomposition {
  /** Per scale, the detail in EV (already clamped), finest first. */
  details: Float64Array[];
  /** The coarsest level, EV. */
  residual: Float64Array;
  /** Σ gain_k · detail_k, EV — what the final draw writes. */
  correction: Float64Array;
}

/** A level's value at a continuous texel position (pixel centres at integers). */
type Level = (px: number, py: number) => number;

/** One channel of a plane read the way the GPU reads a LINEAR / CLAMP_TO_EDGE
 *  texture: bilinear between the four nearest texel centres, coordinates past
 *  the edge held at the edge texel. */
function bilinear(data: Float64Array, width: number, height: number, stride: number, offset: number, px: number, py: number): number {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const cx0 = x0 < 0 ? 0 : x0 >= width ? width - 1 : x0;
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= width ? width - 1 : x0 + 1;
  const cy0 = y0 < 0 ? 0 : y0 >= height ? height - 1 : y0;
  const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= height ? height - 1 : y0 + 1;
  const at = (x: number, y: number) => data[(y * width + x) * stride + offset];
  const top = at(cx0, cy0) * (1 - fx) + at(cx1, cy0) * fx;
  const bottom = at(cx0, cy1) * (1 - fx) + at(cx1, cy1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** The first draw reads the source: the colour is interpolated, then normed. */
function sourceLevel(img: Image, floor: number): Level {
  const { data, width, height } = img;
  return (px, py) =>
    logLuminance(
      luminance(
        bilinear(data, width, height, 3, 0, px, py),
        bilinear(data, width, height, 3, 1, px, py),
        bilinear(data, width, height, 3, 2, px, py),
      ),
      floor,
    );
}

/** Later draws read the carried state: the norm and the offset interpolate
 *  separately, then the log is taken. */
function stateLevel(norm: Float64Array, offset: Float64Array, width: number, height: number, floor: number): Level {
  return (px, py) =>
    logLuminance(bilinear(norm, width, height, 1, 0, px, py), floor) + bilinear(offset, width, height, 1, 0, px, py);
}

export function decompose(img: Image, p: Params): Decomposition {
  const { data, width, height } = img;
  const n = width * height;
  const floor = noiseFloorLinear(p.noiseFloor);
  const sigma = rangeSigma(p.halo);
  const longEdge = Math.max(width, height);
  const norm = new Float64Array(n);
  for (let i = 0; i < n; i++) norm[i] = luminance(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  let offset = new Float64Array(n);
  let correction = new Float64Array(n);
  let level: Level = sourceLevel(img, floor);
  const details: Float64Array[] = [];
  let coarse = new Float64Array(n);
  for (let k = 0; k < SCALES; k++) {
    const s = step(k, longEdge);
    const gain = gainFraction(p.scales[k]);
    coarse = new Float64Array(n);
    const detail = new Float64Array(n);
    const nextCorrection = new Float64Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const centre = logLuminance(norm[i], floor) + offset[i];
        let sum = 0;
        let wsum = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const tap = level(x + dx * s, y + dy * s);
            const dL = (tap - centre) / sigma;
            const w = B3[dx + 2] * B3[dy + 2] * Math.exp(-0.5 * dL * dL);
            sum += w * tap;
            wsum += w;
          }
        }
        coarse[i] = sum / wsum;
        detail[i] = clampDetail(centre - coarse[i]);
        nextCorrection[i] = correction[i] + gain * detail[i];
      }
    }
    const nextOffset = new Float64Array(n);
    for (let i = 0; i < n; i++) nextOffset[i] = coarse[i] - logLuminance(norm[i], floor);
    details.push(detail);
    offset = nextOffset;
    correction = nextCorrection;
    level = stateLevel(norm, offset, width, height, floor);
  }
  return { details, residual: coarse, correction };
}

/** The image with the summed correction applied as one multiplier per pixel. */
export function applyLocalContrast(img: Image, p: Params): Float64Array {
  const out = new Float64Array(img.data.length);
  if (!effectActive(p)) {
    out.set(img.data);
    return out;
  }
  const { correction } = decompose(img, p);
  for (let i = 0; i < correction.length; i++) {
    const m = correctionMultiplier(correction[i]);
    out[i * 3] = img.data[i * 3] * m;
    out[i * 3 + 1] = img.data[i * 3 + 1] * m;
    out[i * 3 + 2] = img.data[i * 3 + 2] * m;
  }
  return out;
}
