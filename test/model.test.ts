// The maths as a contract: the constants the spec pins, the point functions,
// and the pyramid's behaviour on synthetic scenes: identity at rest,
// invariance to exposure, colour preserved, each scale answering its own
// feature size, halo control at a step edge, the noise floor in the shadows.

import { describe, expect, it } from "vitest";
import {
  B3,
  DEFAULT_PARAMS,
  DETAIL_CLAMP,
  EPSILON,
  REFERENCE_EDGE,
  SCALES,
  TOTAL_CLAMP,
  applyLocalContrast,
  clampDetail,
  correctionMultiplier,
  decompose,
  effectActive,
  gainFraction,
  logLuminance,
  luminance,
  noiseFloorLinear,
  rangeSigma,
  step,
  type Image,
} from "../src/model";
import { amplitudeEV, fill, flat, sineX, spotColumn, stepX } from "./support/scenes";

describe("constants", () => {
  it("pins the spec's values", () => {
    expect(SCALES).toBe(8);
    expect(REFERENCE_EDGE).toBe(2560);
    expect(B3).toEqual([1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]);
    expect(EPSILON).toBe(2 ** -16);
    expect(DETAIL_CLAMP).toBe(5);
    expect(TOTAL_CLAMP).toBe(8);
    expect(DEFAULT_PARAMS).toEqual({ scales: [0, 0, 0, 0, 0, 0, 0, 0], halo: 0, noiseFloor: 0 });
  });
});

describe("point functions", () => {
  it("takes the power norm: the value for greys, never zero for a bright primary", () => {
    expect(luminance(0.3, 0.3, 0.3)).toBeCloseTo(0.3, 12);
    expect(luminance(0, 0, 1)).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(luminance(0, 0, 0)).toBe(0);
    // A channel below black (a RAW colour beyond the primaries) counts by its magnitude.
    expect(luminance(0.3, -0.3, 0.3)).toBeCloseTo(0.3, 12);
  });

  it("logs with the floor and the epsilon, finite at black", () => {
    expect(logLuminance(1, 0)).toBeCloseTo(Math.log2(1 + EPSILON), 12);
    expect(logLuminance(0.25, 0.01)).toBeCloseTo(Math.log2(0.26 + EPSILON), 12);
    expect(logLuminance(0, 0)).toBe(-16);
    expect(logLuminance(-1, 0)).toBe(-16);
  });

  it("anchors the scale steps to the reference edge", () => {
    expect(step(0, 2560)).toBe(1);
    expect(step(3, 5120)).toBe(16);
    expect(step(0, 256)).toBeCloseTo(0.1, 12);
    expect(step(7, 2560)).toBe(128);
  });

  it("maps halo control to a range sigma in EV", () => {
    expect(rangeSigma(0)).toBe(1);
    expect(rangeSigma(100)).toBe(0.25);
    expect(rangeSigma(-100)).toBe(4);
  });

  it("converts the slider percentages", () => {
    expect(gainFraction(100)).toBe(1);
    expect(gainFraction(-50)).toBe(-0.5);
    expect(noiseFloorLinear(1)).toBeCloseTo(0.01, 12);
  });

  it("clamps a scale's detail and the summed correction", () => {
    expect(clampDetail(7)).toBe(5);
    expect(clampDetail(-7)).toBe(-5);
    expect(clampDetail(0.3)).toBe(0.3);
    expect(correctionMultiplier(0)).toBe(1);
    expect(correctionMultiplier(1)).toBe(2);
    expect(correctionMultiplier(20)).toBe(256);
    expect(correctionMultiplier(-20)).toBe(1 / 256);
  });

  it("is active once any scale leaves zero", () => {
    expect(effectActive(DEFAULT_PARAMS)).toBe(false);
    expect(effectActive({ ...DEFAULT_PARAMS, halo: 40, noiseFloor: 1 })).toBe(false);
    expect(effectActive({ ...DEFAULT_PARAMS, scales: [0, 0, 0, 0, 0, 0, 0, 5] })).toBe(true);
  });
});

// A 2560-wide strip has integer steps (1, 2, 4 … 128 texels), so the scale
// ladder reads directly in pixels; the rows are identical so clamp-to-edge in
// y is exact.
const W = REFERENCE_EDGE;
const H = 4;

const scaleGains = (...pairs: [number, number][]): number[] => {
  const g = Array.from({ length: SCALES }, () => 0);
  for (const [k, v] of pairs) g[k] = v;
  return g;
};

describe("pyramid", () => {
  it("is the identity at zero gains, bit for bit", () => {
    const img = sineX(64, 8, 8, 0.5, 0.3);
    const out = applyLocalContrast(img, { ...DEFAULT_PARAMS, halo: 60, noiseFloor: 2 });
    expect(out).not.toBe(img.data);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(img.data[i]);
  });

  it("leaves a flat field alone whatever the gains", () => {
    const img = flat(W, H, 0.18);
    const out = applyLocalContrast(img, { scales: scaleGains([0, 100], [3, -100], [7, 100]), halo: -100, noiseFloor: 0 });
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(0.18, 12);
  });

  it("is invariant to exposure", () => {
    const img = sineX(W, H, 32, 0.4, 0.2);
    const brighter: Image = { ...img, data: img.data.map((v) => v * 4) };
    const p = { scales: scaleGains([2, 80], [5, -60]), halo: 0, noiseFloor: 0 };
    const a = applyLocalContrast(img, p);
    const b = applyLocalContrast(brighter, p);
    // EPSILON in the log is the one exposure-dependent term; at these levels
    // it is worth ~1e-4 EV.
    for (let i = 0; i < a.length; i++) expect(b[i] / (4 * a[i])).toBeCloseTo(1, 3);
  });

  it("preserves colour: every channel takes the same multiplier", () => {
    const img = fill(W, H, (x) => {
      const g = 0.2 * 2 ** (0.5 * Math.sin((2 * Math.PI * x) / 24));
      return [2 * g, g, 0.5 * g];
    });
    const out = applyLocalContrast(img, { scales: scaleGains([1, 100], [4, -100]), halo: 20, noiseFloor: 0 });
    for (let i = 0; i < out.length; i += 3) {
      expect(out[i] / out[i + 1]).toBeCloseTo(2, 10);
      expect(out[i + 2] / out[i + 1]).toBeCloseTo(0.5, 10);
    }
  });

  // A RAW decode keeps colours beyond the sRGB primaries as channels below
  // black, some at a Rec. 709 luma of about zero. The norm levels them by
  // their magnitude and the multiplier is positive, so each keeps its sign.
  it("keeps channels below black finite and signed under the one multiplier", () => {
    const img = fill(W, H, (x) => {
      const v = 0.2 * 2 ** (0.5 * Math.sin((2 * Math.PI * x) / 24));
      return x % 48 < 24 ? [1.3 * v, v, -0.25 * v] : [v, -0.3 * v, 0.03 * v];
    });
    const out = applyLocalContrast(img, { scales: scaleGains([1, 100], [4, -100], [6, 100]), halo: 20, noiseFloor: 0 });
    let changed = 0;
    for (let i = 0; i < out.length; i += 3) {
      const m = out[i] / img.data[i];
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThan(0);
      expect(out[i + 1] / img.data[i + 1]).toBeCloseTo(m, 10);
      expect(out[i + 2] / img.data[i + 2]).toBeCloseTo(m, 10);
      if (Math.abs(m - 1) > 0.05) changed++;
    }
    expect(changed).toBeGreaterThan(W);
  });

  it("answers a 4 px texture on scale 1 and not on scale 8", () => {
    const img = sineX(W, H, 4, 0.2, 0.3);
    const before = amplitudeEV(img.data, W, 1, 64, W - 64);
    const fine = applyLocalContrast(img, { scales: scaleGains([0, 100]), halo: 0, noiseFloor: 0 });
    const coarse = applyLocalContrast(img, { scales: scaleGains([7, 100]), halo: 0, noiseFloor: 0 });
    // B3 keeps cos⁴(π/4) = 1/4 of a period-4 sine, so scale 1 holds 3/4 of it.
    expect(amplitudeEV(fine, W, 1, 64, W - 64) / before).toBeGreaterThan(1.5);
    expect(amplitudeEV(fine, W, 1, 64, W - 64) / before).toBeLessThan(2);
    // The range weighting is not linear, so a trace of the texture (about
    // 1 % at a 0.2 EV amplitude against the 1 EV sigma) reaches the coarse
    // levels.
    expect(amplitudeEV(coarse, W, 1, 64, W - 64) / before).toBeGreaterThan(0.98);
    expect(amplitudeEV(coarse, W, 1, 64, W - 64) / before).toBeLessThan(1.02);
  });

  it("answers a 128 px structure on scale 6 and not on scale 1", () => {
    const img = sineX(W, H, 128, 0.2, 0.3);
    const before = amplitudeEV(img.data, W, 1, 256, W - 256);
    const mid = applyLocalContrast(img, { scales: scaleGains([5, 100]), halo: 0, noiseFloor: 0 });
    const fine = applyLocalContrast(img, { scales: scaleGains([0, 100]), halo: 0, noiseFloor: 0 });
    expect(amplitudeEV(mid, W, 1, 256, W - 256) / before).toBeGreaterThan(1.3);
    expect(amplitudeEV(fine, W, 1, 256, W - 256) / before).toBeLessThan(1.01);
  });

  it("smooths a texture away at −100 on its scale", () => {
    const img = sineX(W, H, 4, 0.2, 0.3);
    const before = amplitudeEV(img.data, W, 1, 64, W - 64);
    const out = applyLocalContrast(img, { scales: scaleGains([0, -100]), halo: -100, noiseFloor: 0 });
    expect(amplitudeEV(out, W, 1, 64, W - 64) / before).toBeLessThan(0.35);
  });

  it("controls the halo at a step edge", () => {
    const edge = W / 2;
    const img = stepX(W, H, edge, 0.1, 0.8);
    const p = (halo: number) => ({ scales: scaleGains([6, 100], [7, 100]), halo, noiseFloor: 0 });
    const overshoot = (out: Float64Array) => {
      let hi = 0;
      for (let x = edge; x < W; x++) hi = Math.max(hi, out[(1 * W + x) * 3]);
      return Math.log2(hi / 0.8);
    };
    const soft = overshoot(applyLocalContrast(img, p(-100)));
    const strict = overshoot(applyLocalContrast(img, p(100)));
    expect(soft).toBeGreaterThan(0.3);
    expect(strict).toBeLessThan(0.05);
    expect(strict).toBeLessThan(soft / 5);
  });

  it("shrinks shadow detail as the noise floor rises", () => {
    const img = spotColumn(W, H, 0.004, W / 2, 0.001);
    const at = (noiseFloor: number) => decompose(img, { ...DEFAULT_PARAMS, noiseFloor }).details[0][1 * W + W / 2];
    expect(Math.abs(at(0))).toBeGreaterThan(0.2);
    expect(Math.abs(at(1))).toBeLessThan(Math.abs(at(0)) * 0.7);
  });

  it("decomposes into eight details plus a residual whose sum is the log image", () => {
    const img = sineX(W, H, 20, 0.3, 0.25);
    const d = decompose(img, DEFAULT_PARAMS);
    expect(d.details.length).toBe(SCALES);
    for (let i = 0; i < W * H; i++) {
      let sum = d.residual[i];
      for (const band of d.details) sum += band[i];
      expect(sum).toBeCloseTo(logLuminance(img.data[i * 3], 0), 9);
      expect(d.correction[i]).toBe(0);
    }
  });
});
