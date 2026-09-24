// The Develop panel: the eight scale sliders, a one-line hint, then halo
// control and the noise floor — core sliders only. Sliders write the bag live
// and commit on release with their own label.

import type { CSSProperties } from "react";
import { DEFAULT_PARAMS, SCALES, type Params } from "./model";
import { RANGE, deriveAll, readParams } from "./params";
import { api, h } from "./runtime";

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  read(p: Params): number;
  write(p: Params, value: number): Params;
  commitLabel: string;
}

export const SCALE_SLIDERS: readonly SliderSpec[] = Array.from({ length: SCALES }, (_, k) => ({
  label: `Scale ${k + 1}`,
  ...RANGE.scale,
  read: (p) => p.scales[k],
  write: (p, value) => ({ ...p, scales: p.scales.map((g, i) => (i === k ? value : g)) }),
  commitLabel: `scale ${k + 1}`,
}));

export const OPTION_SLIDERS: readonly SliderSpec[] = [
  {
    label: "Halo control",
    ...RANGE.halo,
    read: (p) => p.halo,
    write: (p, halo) => ({ ...p, halo }),
    commitLabel: "halo control",
  },
  {
    label: "Noise floor",
    ...RANGE.noiseFloor,
    read: (p) => p.noiseFloor,
    write: (p, noiseFloor) => ({ ...p, noiseFloor }),
    commitLabel: "noise floor",
  },
];

export const HINT =
  "Scale 1 is the finest texture, scale 8 the broadest local tone; each scale is twice the size of the last. Up boosts, down smooths.";

const COLUMN: CSSProperties = { display: "flex", flexDirection: "column", gap: 1 };

export function PyramidPanel() {
  const { Slider } = api().components;
  const { Stack, tokens } = api().ui;
  const dev = api().stores.useDevelopStore;
  const paramBag = dev((s) => s.paramBag);
  const p = readParams(paramBag);

  const live = (): Params => readParams(dev.getState().paramBag);
  const apply = (next: Params) => dev.getState().setDynParams(deriveAll(next));
  const commit = (what: string) => void dev.getState().commitEdit(`Pyramid Local Contrast ${what}`);

  const slider = (spec: SliderSpec) =>
    h(Slider, {
      key: spec.label,
      label: spec.label,
      value: spec.read(p),
      min: spec.min,
      max: spec.max,
      step: spec.step,
      defaultValue: spec.read(DEFAULT_PARAMS),
      onChange: (v: number) => apply(spec.write(live(), v)),
      onCommit: () => commit(spec.commitLabel),
    });

  const hintStyle: CSSProperties = { margin: 0, fontSize: 10, lineHeight: 1.4, color: tokens.textMuted };

  return h(
    Stack,
    { gap: 6, style: { padding: "6px 8px 8px" } },
    h("div", { key: "scales", style: COLUMN }, ...SCALE_SLIDERS.map(slider)),
    h("p", { key: "hint", style: hintStyle }, HINT),
    h("div", { key: "options", style: COLUMN }, ...OPTION_SLIDERS.map(slider)),
  );
}
