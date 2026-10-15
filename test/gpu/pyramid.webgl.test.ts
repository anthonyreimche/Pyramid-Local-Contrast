// The stage on the real renderer. Run via `npm run test:gpu` (test/gpu/run.cjs
// copies this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//
//  • the pass program and the inline compile and link on a real GLSL ES 3.00
//    driver, with the host's uniform and helper namespacing;
//  • zero scales are a bit-exact no-op through the host's gate, also with
//    halo control and the noise floor set (the chain then runs and sums zero);
//  • eight draws on half-float targets, with bilinear taps at the fractional
//    steps a 256-px frame gets, match the CPU model;
//  • a 96×64 frame matches the model at its own anchoring;
//  • a source with channels below black, as a RAW decode keeps colours beyond
//    the sRGB primaries, stays finite and matches the model, signs included.
//
// The timings it prints are SwiftShader (CPU) numbers, only useful relative
// to each other.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, applyLocalContrast, type Image, type Params } from "@plc/model";
import { deriveAll } from "@plc/params";
import { allStages } from "@plc/stage";
import { fill } from "@plc-test/support/scenes";
import {
  LINEAR_PROBE_PIPELINE,
  type Frame,
  builtinStages,
  floatImage,
  identityParams,
  withRenderer,
} from "@/rendering/webgl/webgl.test-support";

// ── Scenes ───────────────────────────────────────────────────────────────────

/** Four horizontal bands: a 2.6 EV step edge, sines at periods 8 and 32 px
 *  over a gentle gradient, a mixed band with periods 16 and 24 px and a
 *  colour cast, and a 64 px sine with another cast. Values stay under the
 *  probe pipeline's filmic knee (0.85) after a moderate boost, so its tone
 *  chain is the identity on the comparison. */
function scene(w: number, h: number): Image {
  return fill(w, h, (x, y) => {
    const band = Math.floor((4 * y) / h);
    const t = x / w;
    if (band === 0) {
      const v = x < w / 2 ? 0.08 : 0.48;
      return [v, v, v];
    }
    if (band === 1) {
      const v = (0.12 + 0.2 * t) * 2 ** (0.3 * Math.sin((2 * Math.PI * x) / 8) + 0.3 * Math.sin((2 * Math.PI * x) / 32));
      return [v, v, v];
    }
    if (band === 2) {
      const v = 0.25 * 2 ** (0.4 * Math.sin((2 * Math.PI * x) / 16) + 0.25 * Math.sin((2 * Math.PI * y) / 24));
      return [v * 1.3, v, v * 0.7];
    }
    const v = 0.3 * 2 ** (0.5 * Math.sin((2 * Math.PI * x) / 64));
    return [v * 0.8, v, v * 1.2];
  });
}

/** A RAW decode's colours beyond the sRGB primaries, as channels below black:
 *  a band with blue under zero, one with green under zero at a Rec. 709 luma
 *  of about zero, and one whose blue crosses zero along the texture. */
function signedScene(w: number, h: number): Image {
  return fill(w, h, (x, y) => {
    const band = Math.floor((3 * y) / h);
    const v = 0.2 * 2 ** (0.4 * Math.sin((2 * Math.PI * x) / 16) + 0.3 * Math.sin((2 * Math.PI * y) / 24));
    if (band === 0) return [1.3 * v, v, -0.25 * v];
    if (band === 1) return [v, -0.3 * v, 0.03 * v];
    return [0.5 * v, 0.4 * v, 0.1 * Math.sin((2 * Math.PI * x) / 32)];
  });
}

/** The probe handing the working colour back negated, so channels below black
 *  survive the display clamp; the probe itself keeps those at or above it. */
const NEGATED_PROBE_PIPELINE = {
  ...LINEAR_PROBE_PIPELINE,
  id: "plc.negated-probe",
  glsl: "vec3 pipelineToDisplay(vec3 lin) { return -lin; }",
  sig: "plc.negated-probe",
};

/** float32 → binary16 → float32, round to nearest even: the source upload is
 *  RGBA16F, so this is the value the GPU actually receives. */
function f16round(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  const stepSize = Math.pow(2, Math.max(e, -14) - 10);
  const q = a / stepSize;
  const f = Math.floor(q);
  const frac = q - f;
  const r = frac > 0.5 || (frac === 0.5 && f % 2 === 1) ? f + 1 : f;
  return sign * r * stepSize;
}

const toFloatImage = (img: Image) =>
  floatImage(img.width, img.height, (x, y) => {
    const i = (y * img.width + x) * 3;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  });

// ── Reference and comparison ─────────────────────────────────────────────────

function reference(img: Image, p: Params): { input: Float64Array; output: Float64Array } {
  const input = img.data.map(f16round);
  const output = applyLocalContrast({ ...img, data: input }, p);
  return { input, output };
}

interface Comparison {
  rmse: number;
  changeRms: number;
  max: number;
  clipped: number;
  outliers: number;
  worst: string;
}

// Beyond these the probe pipeline's knee and clamp make a sample incomparable;
// a signed frame (the probe less the negated probe) is bounded at −CLIP_HI.
const CLIP_LO = 0.002;
const CLIP_HI = 0.8;

function compare(
  on: Frame,
  off: Frame,
  ref: { input: Float64Array; output: Float64Array },
  w: number,
  lo = CLIP_LO,
): Comparison {
  const n = on.width * on.height;
  let se = 0;
  let change = 0;
  let count = 0;
  let clipped = 0;
  let max = 0;
  let outliers = 0;
  let worst = "";
  for (let p = 0; p < n; p++) {
    const out = [ref.output[p * 3], ref.output[p * 3 + 1], ref.output[p * 3 + 2]];
    if (out.some((v) => v < lo || v > CLIP_HI)) {
      clipped++;
      continue;
    }
    for (let ch = 0; ch < 3; ch++) {
      const g = on.data[p * 4 + ch] - off.data[p * 4 + ch];
      const r = out[ch] - ref.input[p * 3 + ch];
      const e = g - r;
      se += e * e;
      change += r * r;
      count++;
      if (Math.abs(e) > 0.01) outliers++;
      if (Math.abs(e) > max) {
        max = Math.abs(e);
        worst = `x=${p % w} y=${Math.floor(p / w)} ch=${ch} in=${ref.input[p * 3 + ch].toFixed(4)} ref=${out[ch].toFixed(4)} gpu=${on.data[p * 4 + ch].toFixed(4)} off=${off.data[p * 4 + ch].toFixed(4)}`;
      }
    }
  }
  return {
    rmse: Math.sqrt(se / Math.max(1, count)),
    changeRms: Math.sqrt(change / Math.max(1, count)),
    max,
    clipped: clipped / n,
    outliers,
    worst,
  };
}

/** The working colour, signed, from the probe and the negated probe. */
function signedFrame(probe: Frame, negated: Frame): Frame {
  return { ...probe, data: probe.data.map((v, i) => v - negated.data[i]) };
}

function expectBitExact(a: Frame | null, b: Frame | null): void {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  for (let i = 0; i < a!.data.length; i++) expect(a!.data[i]).toBe(b!.data[i]);
}

const MAX_ERROR_FRACTION = 0.02;
const MAX_ERROR_FLOOR = 1e-4;

const gains = (...pairs: [number, number][]): number[] => {
  const g = Array.from({ length: 8 }, () => 0);
  for (const [k, v] of pairs) g[k] = v;
  return g;
};

const COARSE: Params = { scales: gains([5, 60], [6, 100], [7, 100]), halo: 0, noiseFloor: 0 };

const CASES: [string, Params][] = [
  ["coarse boost", COARSE],
  ["fine smooth", { scales: gains([0, -100], [1, -100], [2, -100], [3, -100], [4, -60]), halo: 0, noiseFloor: 0 }],
  ["mixed, halo 30, floor 0.5", { scales: gains([0, 40], [2, -50], [4, 30], [5, -30], [6, 50]), halo: 30, noiseFloor: 0.5 }],
  ["coarse boost, halo +100", { ...COARSE, halo: 100 }],
  ["coarse boost, halo −100", { ...COARSE, halo: -100 }],
];

describe("Pyramid Local Contrast stage on the real renderer", () => {
  const W = 256;
  const H = 256;
  const SCENE = scene(W, H);
  const SCENE_IMAGE = toFloatImage(SCENE);

  it("is a bit-exact no-op at zero scales, also with halo control and the floor set", () => {
    // Renderers share one context and a nested one's dispose() tears down GL
    // state the outer one relies on, so the frames are taken in sequence.
    const bare = withRenderer({ stages: builtinStages(), pipeline: LINEAR_PROBE_PIPELINE }, (r) => {
      r.setImage(SCENE_IMAGE);
      r.setParams(identityParams());
      return r.captureFloatFrame();
    });
    const idle = withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (r) => {
      r.setImage(SCENE_IMAGE);
      r.setParams(identityParams());
      r.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = r.captureFloatFrame();
      r.setContributedParams(deriveAll({ ...DEFAULT_PARAMS, halo: 70, noiseFloor: 2 }));
      const options = r.captureFloatFrame();
      return { off, options };
    });
    expectBitExact(idle.off, bare);
    expectBitExact(idle.options, bare);
  });

  it("matches the model for every parameter set", () => {
    withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(SCENE_IMAGE);
      renderer.setParams(identityParams());
      renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = renderer.captureFloatFrame();
      expect(off).not.toBeNull();
      expect(off!.width).toBe(W);
      expect(off!.height).toBe(H);
      for (const [name, p] of CASES) {
        renderer.setContributedParams(deriveAll(p));
        const t0 = performance.now();
        const on = renderer.captureFloatFrame();
        const ms = performance.now() - t0;
        expect(on).not.toBeNull();
        const s = compare(on!, off!, reference(SCENE, p), W);
        console.log(
          `[plc-gpu] ${name}: ${ms.toFixed(0)} ms; model change rms ${s.changeRms.toExponential(2)}; ` +
            `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
            `max ${s.max.toExponential(2)}, ${s.outliers} outliers, ${(100 * s.clipped).toFixed(2)}% clipped; worst ${s.worst}`,
        );
        expect(s.changeRms).toBeGreaterThan(1e-3);
        expect(s.clipped).toBeLessThan(0.1);
        expect(s.outliers).toBe(0);
        expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
      }
    });
  });

  it("matches the model at a small frame's own anchoring", () => {
    const w = 96;
    const h = 64;
    const small = scene(w, h);
    const image = toFloatImage(small);
    const frames = withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(image);
      renderer.setParams(identityParams());
      renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = renderer.captureFloatFrame();
      renderer.setContributedParams(deriveAll(COARSE));
      const on = renderer.captureFloatFrame();
      return { off, on };
    });
    expect(frames.off).not.toBeNull();
    expect(frames.on).not.toBeNull();
    const s = compare(frames.on!, frames.off!, reference(small, COARSE), w);
    console.log(
      `[plc-gpu] ${w}x${h}: change rms ${s.changeRms.toExponential(2)}; error rms ${s.rmse.toExponential(2)} ` +
        `(${((100 * s.rmse) / s.changeRms).toFixed(2)}%), max ${s.max.toExponential(2)}, ${s.outliers} outliers; worst ${s.worst}`,
    );
    expect(s.changeRms).toBeGreaterThan(1e-3);
    expect(s.outliers).toBe(0);
    expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
  });

  // The prepass reads the source straight, so a RAW colour beyond the
  // primaries reaches the norm and the log with a channel below black.
  it("matches the model on channels below black, finite throughout", () => {
    const signed = signedScene(W, H);
    const image = toFloatImage(signed);
    const [probe, negated] = [LINEAR_PROBE_PIPELINE, NEGATED_PROBE_PIPELINE].map((pipeline) =>
      withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline }, (renderer) => {
        renderer.setImage(image);
        renderer.setParams(identityParams());
        renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
        const off = renderer.captureFloatFrame();
        renderer.setContributedParams(deriveAll(COARSE));
        const on = renderer.captureFloatFrame();
        return { off, on };
      }),
    );
    for (const frame of [probe.off, probe.on, negated.off, negated.on]) {
      expect(frame).not.toBeNull();
      expect(frame!.data.every((v) => Number.isFinite(v))).toBe(true);
    }
    const ref = reference(signed, COARSE);
    let below = 0;
    for (let i = 0; i < ref.input.length; i++) if (ref.input[i] < 0 && Math.abs(ref.output[i] - ref.input[i]) > 1e-3) below++;
    const s = compare(signedFrame(probe.on!, negated.on!), signedFrame(probe.off!, negated.off!), ref, W, -CLIP_HI);
    console.log(
      `[plc-gpu] signed: ${below} changed channels below black; change rms ${s.changeRms.toExponential(2)}; ` +
        `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
        `max ${s.max.toExponential(2)}, ${s.outliers} outliers, ${(100 * s.clipped).toFixed(2)}% clipped; worst ${s.worst}`,
    );
    expect(below).toBeGreaterThan(W * H * 0.1);
    expect(s.changeRms).toBeGreaterThan(1e-3);
    expect(s.clipped).toBeLessThan(0.1);
    expect(s.outliers).toBe(0);
    expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
  });
});
