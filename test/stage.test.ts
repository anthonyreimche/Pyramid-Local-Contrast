// The GPU stage as a contract: the keys it declares with which defaults (the
// bag bridge relies on them), that the GLSL is formatted from the model's
// constants, that the inline mutates `lin` inside the gate and reads the
// host's stageResult only, and the per-draw texture-fetch budget on the real
// GLSL — the class of cost the CPU reference never sees.

import { describe, expect, it } from "vitest";
import { HELPERS_GLSL, INLINE_GLSL, PASS_GLSL, glslLiteral } from "../src/glsl";
import { B3, DETAIL_CLAMP, EPSILON, REFERENCE_EDGE, SCALES, TOTAL_CLAMP } from "../src/model";
import { KEY, SCALE_KEYS, STAGE_ID } from "../src/params";
import { allStages, pyramidPass, pyramidStage } from "../src/stage";
import { fetchBudget, inlineFetches } from "./support/fetch-budget";

describe("glslLiteral", () => {
  it("always carries a decimal point, exponents included", () => {
    expect(glslLiteral(0.5)).toBe("0.5000000000");
    expect(glslLiteral(2560)).toBe("2560.000000");
    expect(glslLiteral(EPSILON)).toBe("0.00001525878906");
    expect(glslLiteral(-5)).toBe("-5.000000000");
    expect(glslLiteral(1.17549435e-38)).toMatch(/^1\.17549435\d*e-38$/);
  });
});

describe("pyramidStage", () => {
  const stage = pyramidStage();
  const pass = pyramidPass();

  it("runs again inside masks", () => {
    expect(stage.mask).toEqual({ maskable: true });
  });

  it("is one scene-linear stage before the colour ports, in presets, with one eight-draw pass", () => {
    expect(stage.id).toBe(STAGE_ID);
    expect(stage.name).toBe("Pyramid Local Contrast");
    expect(stage.phase).toBe("scene-linear");
    expect(stage.priority).toBe(60);
    expect(stage.presetScope).toBe("global");
    expect(allStages().map((s) => s.id)).toEqual([STAGE_ID]);
    expect(stage.passes?.length).toBe(1);
    expect(stage.passes?.[0].iterations).toBe(SCALES);
  });

  it("declares the scales, halo and floor on the pass and the gate inline, all zero at rest", () => {
    const passKeys = (pass.uniforms ?? []).map((u) => u.key);
    expect(passKeys).toEqual([...SCALE_KEYS, "halo", "noiseFloor"]);
    for (const u of pass.uniforms ?? []) {
      expect(u.glslType).toBe("float");
      expect(u.default).toBe(0);
    }
    const byKey = Object.fromEntries((pass.uniforms ?? []).map((u) => [u.key, u]));
    expect(byKey.scale1.range).toEqual({ min: -100, max: 100, step: 1 });
    expect(byKey.scale1.label).toBe("scale 1");
    expect(byKey.halo.range).toEqual({ min: -100, max: 100, step: 1 });
    expect(byKey.noiseFloor.range).toEqual({ min: 0, max: 5, step: 0.01 });
    expect(stage.uniforms.map((u) => [u.key, u.glslType, u.default])).toEqual([["on", "float", 0]]);
    expect(Object.values(KEY).map((k) => k.slice(STAGE_ID.length + 1))).toEqual(["halo", "noiseFloor", "on"]);
  });

  it("formats the GLSL from the model's constants", () => {
    const glsl = `${pass.helpers}\n${pass.glsl}\n${stage.glsl}`;
    expect(glsl).toContain(glslLiteral(REFERENCE_EDGE));
    expect(glsl).toContain(glslLiteral(EPSILON));
    expect(glsl).toContain(glslLiteral(B3[2]));
    expect(glsl).toContain(glslLiteral(B3[1]));
    expect(glsl).toContain(glslLiteral(B3[0]));
    expect(glsl).toContain(`clamp(Lc - coarse, ${glslLiteral(-DETAIL_CLAMP)}, ${glslLiteral(DETAIL_CLAMP)})`);
    expect(glsl).toContain(`clamp(stageResult.x, ${glslLiteral(-TOTAL_CLAMP)}, ${glslLiteral(TOTAL_CLAMP)})`);
    expect(glsl).toContain("exp2(-halo / 50.0)");
    for (const key of SCALE_KEYS) expect(pass.helpers).toContain(key);
  });

  it("mutates lin inside the gate and reads only the host's stageResult", () => {
    expect(stage.glsl).toMatch(/if \(on > 0\.5\)/);
    expect(stage.glsl).toContain("lin *= exp2(");
    expect(stage.glsl).not.toContain("texture(");
    expect(stage.glsl).not.toContain("texelFetch(");
    expect(stage.helpers).toBeUndefined();
  });

  it("emits the correction on the last draw and carries the state otherwise", () => {
    expect(pass.glsl).toContain(
      "uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(st.x, coarse - plcLog(st.x), acc)",
    );
    expect(pass.helpers).toContain("uPrevRaw ? vec3(sqrt(dot(p, p) / 3.0), 0.0, 0.0) : p");
  });

  it("stays within the per-draw texture-fetch budget", () => {
    expect(fetchBudget(pass.glsl, pass.helpers ?? "")).toBe(26);
    expect(inlineFetches(stage.glsl, stage.helpers ?? "")).toBe(0);
  });

  it("exports the same strings the stage carries", () => {
    expect(pass.glsl).toBe(PASS_GLSL);
    expect(pass.helpers).toBe(HELPERS_GLSL);
    expect(stage.glsl).toBe(INLINE_GLSL);
  });
});
