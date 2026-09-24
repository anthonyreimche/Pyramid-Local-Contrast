// The stage: one scene-linear stage on the host's stage/prepass framework.
// One pass, SCALES iterations, 26 fetches per pixel per draw; the host
// caches the result until a pass key or the source changes, so dragging a
// slider costs eight draws and everything else is a cache hit.

import { HELPERS_GLSL, INLINE_GLSL, PASS_GLSL } from "./glsl";
import { SCALES } from "./model";
import { RANGE, SCALE_KEYS, STAGE_ID } from "./params";
import type { ProcessingStageContribution, StagePass, UniformDeclaration } from "./safelight";

function passUniforms(): UniformDeclaration[] {
  const scales: UniformDeclaration[] = SCALE_KEYS.map((key, k) => ({
    key,
    glslType: "float",
    default: 0,
    range: { ...RANGE.scale },
    label: `scale ${k + 1}`,
  }));
  return [
    ...scales,
    { key: "halo", glslType: "float", default: 0, range: { ...RANGE.halo }, label: "halo control" },
    { key: "noiseFloor", glslType: "float", default: 0, range: { ...RANGE.noiseFloor }, label: "noise floor" },
  ];
}

export function pyramidPass(): StagePass {
  return { glsl: PASS_GLSL, helpers: HELPERS_GLSL, iterations: SCALES, uniforms: passUniforms() };
}

export function pyramidStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Pyramid Local Contrast",
    // The multiplier is exposure-invariant; before the colour ports (80–85).
    phase: "scene-linear",
    priority: 60,
    glsl: INLINE_GLSL,
    uniforms: [{ key: "on", glslType: "float", default: 0 }],
    passes: [pyramidPass()],
    presetScope: "global",
  };
}

export function allStages(): ProcessingStageContribution[] {
  return [pyramidStage()];
}
