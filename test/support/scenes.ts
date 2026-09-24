// Synthetic scene-linear images for the model and GPU suites. Values live in
// the probe pipeline's linear range so the GPU comparison stays clean.

import type { Image } from "../../src/model";

export function fill(width: number, height: number, texel: (x: number, y: number) => readonly [number, number, number]): Image {
  const data = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = texel(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return { data, width, height };
}

export function flat(width: number, height: number, value: number): Image {
  return fill(width, height, () => [value, value, value]);
}

/** A grey sine along x: `base · 2^(amplitude · sin(2πx / period))`, amplitude in EV. */
export function sineX(width: number, height: number, period: number, amplitudeEV: number, base: number): Image {
  return fill(width, height, (x) => {
    const v = base * 2 ** (amplitudeEV * Math.sin((2 * Math.PI * x) / period));
    return [v, v, v];
  });
}

/** A grey step edge at `edge`: `left` before it, `right` from it on. */
export function stepX(width: number, height: number, edge: number, left: number, right: number): Image {
  return fill(width, height, (x) => {
    const v = x < edge ? left : right;
    return [v, v, v];
  });
}

/** A flat field with one column at another value. */
export function spotColumn(width: number, height: number, field: number, column: number, value: number): Image {
  return fill(width, height, (x) => {
    const v = x === column ? value : field;
    return [v, v, v];
  });
}

/** Peak-to-peak amplitude in EV of channel 0 along one row between x0 and x1. */
export function amplitudeEV(data: Float64Array, width: number, row: number, x0: number, x1: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = x0; x < x1; x++) {
    const v = data[(row * width + x) * 3];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return Math.log2(hi / lo);
}
