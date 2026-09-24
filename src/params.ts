// The bridge between the panel's params and the develop param bag. Every key
// is a scalar under the stage id and every default is zero, so an untouched
// or reset photo carries an all-zero bag and the host's idle gate (any
// non-zero key) never runs the prepass. `on` is derived — some scale off
// zero — and gates the inline, which keeps the stage a bit-exact no-op when
// the prepass is skipped and the host binds another texture as its result.

import { DEFAULT_PARAMS, SCALES, effectActive, type Params } from "./model";

export const EXT_ID = "pyramid-local-contrast";

/** The host prefixes a stage's GLSL names with a 4-char hash of its id
 *  (shader-compiler.ts hashStageId). Mirrored to salt the id until its prefix
 *  is unique among this extension's stages. */
export function stagePrefix4(stageId: string): string {
  let h = 0;
  for (let i = 0; i < stageId.length; i++) h = ((h << 5) - h + stageId.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 4);
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  let id = base;
  for (let salt = 1; taken.has(stagePrefix4(id)) && salt < 1000; salt++) id = `${base}-${salt}`;
  return id;
}

export const STAGE_ID = uniqueId(`${EXT_ID}.pyramid`, new Set());

export const SCALE_KEYS: readonly string[] = Array.from({ length: SCALES }, (_, k) => `scale${k + 1}`);

export const SCALAR = ["halo", "noiseFloor", "on"] as const;
export type Scalar = (typeof SCALAR)[number];

export const KEY: Readonly<Record<Scalar, string>> = Object.fromEntries(
  SCALAR.map((k) => [k, `${STAGE_ID}.${k}`]),
) as Record<Scalar, string>;

export function scaleKey(scale: number): string {
  return `${STAGE_ID}.${SCALE_KEYS[scale]}`;
}

export interface Range {
  min: number;
  max: number;
  step: number;
}

export const RANGE: Readonly<Record<"scale" | "halo" | "noiseFloor", Range>> = {
  scale: { min: -100, max: 100, step: 1 },
  halo: { min: -100, max: 100, step: 1 },
  noiseFloor: { min: 0, max: 5, step: 0.01 },
};

/** Every qualified key, scales first. */
export function allKeys(): string[] {
  return [...SCALE_KEYS.map((_, k) => scaleKey(k)), KEY.halo, KEY.noiseFloor, KEY.on];
}

export type Bag = Record<string, unknown>;
export type Patch = Record<string, number>;

function num(bag: Bag, key: string, range: Range, fallback: number): number {
  const v = bag[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v < range.min ? range.min : v > range.max ? range.max : v;
}

/** The panel's params from a bag; the defaults for anything missing or foreign. */
export function readParams(bag: Bag): Params {
  return {
    scales: SCALE_KEYS.map((_, k) => num(bag, scaleKey(k), RANGE.scale, DEFAULT_PARAMS.scales[k])),
    halo: num(bag, KEY.halo, RANGE.halo, DEFAULT_PARAMS.halo),
    noiseFloor: num(bag, KEY.noiseFloor, RANGE.noiseFloor, DEFAULT_PARAMS.noiseFloor),
  };
}

/** Everything to persist and drive the GPU for a parameter set. */
export function deriveAll(p: Params): Patch {
  const out: Patch = {};
  SCALE_KEYS.forEach((_, k) => {
    out[scaleKey(k)] = p.scales[k];
  });
  out[KEY.halo] = p.halo;
  out[KEY.noiseFloor] = p.noiseFloor;
  out[KEY.on] = effectActive(p) ? 1 : 0;
  return out;
}

export function resetPatch(): Patch {
  return deriveAll(DEFAULT_PARAMS);
}

/** A bag holding this stage's scales but a gate that disagrees with them (a
 *  preset that carried only some keys, an edit from another release) gets the
 *  whole patch re-derived; null when the bag has no scale keys or is already
 *  consistent. */
export function rederivePatch(bag: Bag): Patch | null {
  if (!SCALE_KEYS.some((_, k) => scaleKey(k) in bag)) return null;
  const expected = deriveAll(readParams(bag));
  return bag[KEY.on] === expected[KEY.on] ? null : expected;
}
