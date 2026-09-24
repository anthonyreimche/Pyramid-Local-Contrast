// The GPU side of model.ts, formatted from its constants. One pass program
// runs SCALES iterations; the host hands each draw the previous draw's three
// channels through readPrev (the linearised source on the first draw) and
// binds the last draw as `stageResult` for the inline.
//
// State: x = the linear norm, y = the current level minus the pixel's own log
// luminance, z = the running correction. The ping-pong targets are half-float
// with relative precision, so the norm is what is stored (the log is taken
// per tap) and the level rides as a small offset; the differences that become
// detail keep fine steps.

import { B3, DETAIL_CLAMP, EPSILON, REFERENCE_EDGE, SCALES, TOTAL_CLAMP } from "./model";
import { SCALE_KEYS } from "./params";

/** A GLSL float literal that always carries a decimal point, so integers do
 *  not become int literals and exponents stay valid. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    const m = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
    return `${m}e${Number(exponent)}`;
  }
  return s.includes(".") ? s : `${s}.0`;
}

const lit = glslLiteral;

const gainChain = SCALE_KEYS.slice(0, -1).reduceRight(
  (rest, key, k) => `(k == ${k} ? ${key} : ${rest})`,
  SCALE_KEYS[SCALES - 1],
);

export const HELPERS_GLSL = `
float plcB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${lit(B3[2])} : (d == 1 ? ${lit(B3[1])} : ${lit(B3[0])}); }
float plcLog(float n) { return log2(max(n, 0.0) + noiseFloor * 0.01 + ${lit(EPSILON)}); }
vec3 plcStateOf(vec3 p) { return uPrevRaw ? vec3(sqrt(dot(p, p) / 3.0), 0.0, 0.0) : p; }
vec3 plcState(vec2 uv) { return plcStateOf(readPrev(uv)); }
float plcLevel(vec3 st) { return plcLog(st.x) + st.y; }
float plcGain(int k) { return ${gainChain}; }
`;

export const PASS_GLSL = `
{
  float longEdge = max(1.0 / uTexel.x, 1.0 / uTexel.y);
  float s = exp2(float(uPassIndex)) * longEdge / ${lit(REFERENCE_EDGE)};
  float sigma = exp2(-halo / 50.0);
  vec3 st = plcStateOf(c);
  float Lc = plcLevel(st);
  float sum = 0.0;
  float wsum = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      float Ls = plcLevel(plcState(vUv + vec2(float(dx), float(dy)) * s * uTexel));
      float dL = (Ls - Lc) / sigma;
      float w = plcB3(dx) * plcB3(dy) * exp(-0.5 * dL * dL);
      sum += w * Ls;
      wsum += w;
    }
  }
  float coarse = sum / wsum;
  float d = clamp(Lc - coarse, ${lit(-DETAIL_CLAMP)}, ${lit(DETAIL_CLAMP)});
  float acc = st.z + plcGain(uPassIndex) * 0.01 * d;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(st.x, coarse - plcLog(st.x), acc);
}
`;

export const INLINE_GLSL = `
{
  if (on > 0.5) {
    lin *= exp2(clamp(stageResult.x, ${lit(-TOTAL_CLAMP)}, ${lit(TOTAL_CLAMP)}));
  }
}
`;
