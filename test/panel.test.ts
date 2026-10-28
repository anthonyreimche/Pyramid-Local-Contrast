// The panel's layout as data — the slider table is what the component
// renders, so pinning it pins the panel without a React render — then the
// component itself, built without React, editing the photo's bag in the dock
// and a mask's in the Masking panel's Adjust tab.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, type Params } from "../src/model";
import { HINT, OPTION_SLIDERS, PyramidPanel, SCALE_SLIDERS } from "../src/Panel";
import { KEY, deriveAll, readParams, scaleKey } from "../src/params";
import { initRuntime } from "../src/runtime";
import type { DevelopStoreState, ParamScope, SafelightAPI, SliderProps } from "../src/safelight";
import { fakeStore } from "./support/fake-store";

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

interface Element {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

const Slider = () => null;
const Stack = () => null;

function sliderProps(node: unknown): SliderProps[] {
  if (!node || typeof node !== "object") return [];
  const el = node as Element;
  const own = el.type === Slider ? [el.props as unknown as SliderProps] : [];
  return [...own, ...el.children.flatMap(sliderProps)];
}

/** The panel over a photo bag, inside a mask holding `maskBag` when one is
 *  given; `sliders()` renders it again and hands back each Slider's props. */
function panelRig(photoBag: Record<string, unknown> = {}, maskBag?: Record<string, unknown>) {
  const commits: string[] = [];
  const photo = fakeStore<DevelopStoreState>({
    photoId: "p1",
    paramBag: photoBag,
    setDynParams: (patch) => photo.setState((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: async (label) => void commits.push(label),
  });
  const mask = fakeStore({ bag: maskBag ?? {} });
  const photoScope: ParamScope = {
    maskId: null,
    getParam: (key) => photo.getState().paramBag[key],
    getParams: () => photo.getState().paramBag,
    setParams: (patch) => photo.getState().setDynParams(patch),
    commit: (label) => void photo.getState().commitEdit(label),
  };
  const maskScope: ParamScope = {
    maskId: "mask-1",
    getParam: (key) => mask.getState().bag[key],
    getParams: () => mask.getState().bag,
    setParams: (patch) => mask.setState((s) => ({ bag: { ...s.bag, ...patch } })),
    commit: (label) => void commits.push(`mask: ${label}`),
  };
  const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({
    type,
    props: props ?? {},
    children,
  });
  initRuntime({
    react: { createElement },
    components: { Slider },
    ui: { Stack, tokens: { textMuted: "grey" } },
    stores: { useDevelopStore: photo },
    develop: { useParamScope: () => (maskBag === undefined ? photoScope : maskScope) },
  } as unknown as SafelightAPI);
  const sliders = () => sliderProps(PyramidPanel());
  const slider = (label: string) => sliders().find((s) => s.label === label)!;
  return { photo, mask, commits, sliders, slider };
}

const withScale = (k: number, value: number, p: Params = DEFAULT_PARAMS): Params => ({
  ...p,
  scales: p.scales.map((g, i) => (i === k ? value : g)),
});

describe("PyramidPanel in the dock", () => {
  it("writes a slider to the photo's bag with its gate and commits under its label", () => {
    const rig = panelRig();
    const scale3 = rig.slider("Scale 3");
    scale3.onChange(35);
    scale3.onCommit?.();
    expect(rig.photo.getState().paramBag).toEqual(deriveAll(withScale(2, 35)));
    expect(rig.commits).toEqual(["Pyramid Local Contrast scale 3"]);
  });
});

// Nothing in the panel measures or picks from the photo, so a mask's has
// every slider the dock's has.
describe("PyramidPanel in a mask", () => {
  it("shows the mask's values, not the photo's, on every slider the dock has", () => {
    const rig = panelRig(
      { [scaleKey(2)]: 20, [KEY.halo]: 10 },
      deriveAll({ ...withScale(2, -40), halo: -30 }),
    );
    expect(rig.sliders().map((s) => s.label)).toEqual([...SCALE_SLIDERS, ...OPTION_SLIDERS].map((s) => s.label));
    expect(rig.slider("Scale 3").value).toBe(-40);
    expect(rig.slider("Halo control").value).toBe(-30);
  });

  it("writes a slider to the mask with its gate, leaves the photo's bag alone, and commits once", () => {
    const rig = panelRig({}, {});
    const scale3 = rig.slider("Scale 3");
    scale3.onChange(35);
    scale3.onCommit?.();
    expect(rig.mask.getState().bag).toEqual(deriveAll(withScale(2, 35)));
    expect(rig.photo.getState().paramBag).toEqual({});
    expect(rig.commits).toEqual(["mask: Pyramid Local Contrast scale 3"]);
  });

  it("starts each change from the mask's values as they are now, not the render's", () => {
    const rig = panelRig({}, {});
    const sliders = rig.sliders();
    sliders.find((s) => s.label === "Scale 3")!.onChange(35);
    sliders.find((s) => s.label === "Halo control")!.onChange(20);
    expect(readParams(rig.mask.getState().bag)).toEqual({ ...withScale(2, 35), halo: 20 });
  });
});
