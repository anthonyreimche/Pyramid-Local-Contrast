// The bag bridge as a contract: the keys, what a foreign or partial bag reads
// as, the clamps, the derived gate, and re-derivation when a loaded bag's gate
// disagrees with its scales.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, SCALES } from "../src/model";
import {
  EXT_ID,
  KEY,
  RANGE,
  SCALE_KEYS,
  STAGE_ID,
  allKeys,
  deriveAll,
  readParams,
  rederivePatch,
  resetPatch,
  scaleKey,
  stagePrefix4,
} from "../src/params";

describe("keys", () => {
  it("live under the salted stage id", () => {
    expect(EXT_ID).toBe("pyramid-local-contrast");
    expect(STAGE_ID.startsWith("pyramid-local-contrast.pyramid")).toBe(true);
    expect(stagePrefix4(STAGE_ID)).toMatch(/^[0-9a-z]{4}$/);
    expect(SCALE_KEYS).toEqual(["scale1", "scale2", "scale3", "scale4", "scale5", "scale6", "scale7", "scale8"]);
    expect(scaleKey(0)).toBe(`${STAGE_ID}.scale1`);
    expect(KEY.halo).toBe(`${STAGE_ID}.halo`);
    expect(KEY.noiseFloor).toBe(`${STAGE_ID}.noiseFloor`);
    expect(KEY.on).toBe(`${STAGE_ID}.on`);
    expect(allKeys()).toEqual([...SCALE_KEYS.map((_, k) => scaleKey(k)), KEY.halo, KEY.noiseFloor, KEY.on]);
  });

  it("pins the slider ranges", () => {
    expect(RANGE.scale).toEqual({ min: -100, max: 100, step: 1 });
    expect(RANGE.halo).toEqual({ min: -100, max: 100, step: 1 });
    expect(RANGE.noiseFloor).toEqual({ min: 0, max: 5, step: 0.01 });
  });
});

describe("readParams", () => {
  it("reads the defaults from an empty bag", () => {
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
  });

  it("reads each key, defaulting foreign values and clamping", () => {
    const bag = {
      [scaleKey(0)]: 40,
      [scaleKey(2)]: "x",
      [scaleKey(5)]: 250,
      [scaleKey(7)]: -300,
      [KEY.halo]: Number.NaN,
      [KEY.noiseFloor]: 9,
    };
    expect(readParams(bag)).toEqual({ scales: [40, 0, 0, 0, 0, 100, 0, -100], halo: 0, noiseFloor: 5 });
  });
});

describe("deriveAll / resetPatch", () => {
  it("writes every key and the derived gate", () => {
    const p = { scales: [0, 0, 10, 0, 0, 0, 0, 0], halo: -20, noiseFloor: 0.5 };
    const patch = deriveAll(p);
    expect(Object.keys(patch).sort()).toEqual(allKeys().sort());
    expect(patch[scaleKey(2)]).toBe(10);
    expect(patch[KEY.halo]).toBe(-20);
    expect(patch[KEY.noiseFloor]).toBe(0.5);
    expect(patch[KEY.on]).toBe(1);
    expect(deriveAll({ ...p, scales: DEFAULT_PARAMS.scales })[KEY.on]).toBe(0);
  });

  it("round-trips through the bag", () => {
    const p = { scales: [1, -2, 3, -4, 5, -6, 7, -8], halo: 33, noiseFloor: 1.25 };
    expect(readParams(deriveAll(p))).toEqual(p);
  });

  it("resets to all zeros", () => {
    const patch = resetPatch();
    expect(Object.keys(patch).length).toBe(SCALES + 3);
    for (const v of Object.values(patch)) expect(v).toBe(0);
  });
});

describe("rederivePatch", () => {
  it("is null for a bag without this stage's scales", () => {
    expect(rederivePatch({})).toBeNull();
    expect(rederivePatch({ [KEY.halo]: 5, "other.stage.scale1": 3 })).toBeNull();
  });

  it("is null when the gate agrees", () => {
    expect(rederivePatch(deriveAll({ scales: [0, 0, 0, 0, 0, 0, 0, 30], halo: 0, noiseFloor: 0 }))).toBeNull();
    expect(rederivePatch(deriveAll(DEFAULT_PARAMS))).toBeNull();
  });

  it("re-derives when a preset carried scales but no gate, or a stale one", () => {
    const partial = { [scaleKey(3)]: 50 };
    expect(rederivePatch(partial)).toEqual(deriveAll({ ...DEFAULT_PARAMS, scales: [0, 0, 0, 50, 0, 0, 0, 0] }));
    const stale = { ...deriveAll({ ...DEFAULT_PARAMS, scales: [0, 0, 0, 50, 0, 0, 0, 0] }), [KEY.on]: 0 };
    expect(rederivePatch(stale)?.[KEY.on]).toBe(1);
  });
});
