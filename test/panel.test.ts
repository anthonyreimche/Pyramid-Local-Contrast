// The panel's layout as data — the slider table is what the component
// renders, so pinning it pins the panel without a React render.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/model";
import { HINT, OPTION_SLIDERS, SCALE_SLIDERS } from "../src/Panel";

describe("slider table", () => {
  it("lists the eight scales, finest first, on the scale range", () => {
    expect(SCALE_SLIDERS.map((s) => s.label)).toEqual([
      "Scale 1",
      "Scale 2",
      "Scale 3",
      "Scale 4",
      "Scale 5",
      "Scale 6",
      "Scale 7",
      "Scale 8",
    ]);
    for (const s of SCALE_SLIDERS) {
      expect([s.min, s.max, s.step]).toEqual([-100, 100, 1]);
      expect(s.read(DEFAULT_PARAMS)).toBe(0);
    }
    const p = SCALE_SLIDERS[2].write(DEFAULT_PARAMS, 35);
    expect(p.scales).toEqual([0, 0, 35, 0, 0, 0, 0, 0]);
    expect(SCALE_SLIDERS[2].read(p)).toBe(35);
    expect(DEFAULT_PARAMS.scales[2]).toBe(0);
    expect(SCALE_SLIDERS[2].commitLabel).toBe("scale 3");
  });

  it("follows with halo control and the noise floor", () => {
    expect(OPTION_SLIDERS.map((s) => [s.label, s.min, s.max, s.step])).toEqual([
      ["Halo control", -100, 100, 1],
      ["Noise floor", 0, 5, 0.01],
    ]);
    expect(OPTION_SLIDERS[0].write(DEFAULT_PARAMS, -30).halo).toBe(-30);
    expect(OPTION_SLIDERS[1].write(DEFAULT_PARAMS, 1.5).noiseFloor).toBe(1.5);
    expect(OPTION_SLIDERS[0].commitLabel).toBe("halo control");
  });

  it("explains the ladder in one line", () => {
    expect(HINT).toBe(
      "Scale 1 is the finest texture, scale 8 the broadest local tone; each scale is twice the size of the last. Up boosts, down smooths.",
    );
  });
});
