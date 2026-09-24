# Pyramid Local Contrast for SafeLight

A [SafeLight](https://github.com/anthonyreimche/SafeLight) extension for local
contrast by detail scale. The image's luminance is split into eight scales —
scale 1 the finest texture, scale 8 the broadest local tone, each twice the
size of the last, like the layers of GIMP's wavelet decompose — and every scale
has one slider: up boosts that size of detail, down smooths it away. The
change is a single multiplier on each pixel's RGB, so colour ratios are kept
and the effect does not move with exposure.

## What it does

- **Scale 1 … Scale 8** (−100…+100 %). Scale 1 answers texture about four
  pixels across at the fit-to-screen view, scale 8 structure about a fifth of
  the frame. Boosting scales 6–8 is "clarity"; boosting 1–3 is "texture";
  pulling 1–3 down softens skin and grain; pulling 6–8 down flattens busy
  mid-sized contrast so a subject stands out.
- **Halo control** (−100…+100). Each scale's blur is edge-aware: a neighbour's
  weight falls off with its distance in EV from the pixel, so a strong edge is
  not blurred across and a coarse boost does not ring halos around it. Positive
  values tighten that (edges left alone, less boost right at them); negative
  values let the blur cross edges, the plainer-pyramid look with its halos.
- **Noise floor** (0…5 % of white). Added to the luminance before the log, it
  compresses detail below its level, so fine-scale boosts stop amplifying
  shadow noise.
- **Reset** from the panel's dock header menu.

Settings persist per photo, take part in undo and presets, and render
identically in Develop, thumbnails and export: the scale ladder is anchored to
the image (scale 1 is one pixel at a 2560-px preview), not to the render's
texels. Until a scale leaves zero the stage is a bit-exact no-op and costs
nothing.

## The math

- **Luminance** is the power norm `sqrt((R² + G² + B²) / 3)` — the value for
  greys, and never near zero for a bright saturated primary — taken to `log2`
  with the noise floor and a 2⁻¹⁶ epsilon.
- **Pyramid.** An undecimated B3-spline pyramid: level *k* is the previous
  level blurred by the 5×5 `[1 4 6 4 1]/16` kernel dilated by `2^k` steps, and
  the detail of scale *k* is the difference. Taps are weighted by
  `exp(−½ (ΔL/σ)²)` with σ from halo control (1 EV at rest, 0.25 at +100, 4 at
  −100) and normalised, so the blur never crosses an edge much steeper than σ.
  Each detail is clamped to ±5 EV.
- **Correction.** `Σ gain_k · detail_k`, clamped to ±8 EV, applied as
  `RGB · 2^correction`.

### How it maps onto SafeLight

One stage in SafeLight's scene-linear phase on the stage/prepass framework: a
single pass program run eight times, each draw one 5×5 step (26 texture reads
per pixel) that carries the pixel's linear norm, the current level as an
offset from its own log luminance, and the running correction in the three
channels a pass has; the last draw emits the correction and the inline
multiplies the live scene-linear pixel by `2^correction`. SafeLight caches the
result until a slider or the source changes, so a drag costs eight draws and
everything else — exposure, other panels, pan and zoom — is a cache hit.

Things to know:

- A prepass sees the source after white balance and the base curve and before
  exposure. The log-space detail is exposure-invariant, so the correction is
  right regardless; only the noise floor is referenced to the source's
  exposure rather than the displayed one.
- The steps are anchored to a 2560-px long edge (the Develop preview). At a
  full-size export scale 1 is a little over two pixels; pixel-level detail in
  the export is left to sharpening, and the preview is what you get.
- The range weighting is not linear, so a trace of a fine texture (about 1 %
  at a 0.2 EV amplitude against the 1 EV sigma) reaches the coarse scales.
- The chain stores signed values and needs SafeLight's float render targets
  (`EXT_color_buffer_float`, present on every desktop GPU); on the 8-bit
  fallback the stage degrades.

### Tests

`npm test` runs on the CPU: the model on synthetic scenes (identity at rest,
exposure invariance, colour preserved, each scale answering its own feature
size, halo control at a step edge, the noise floor in the shadows), the bag
bridge, the stage contract with a **per-draw texture-fetch budget** on the
real GLSL, the slider table, and the activation contract.

`npm run test:gpu` runs the stage through a SafeLight checkout's WebGL harness
(headless Chromium on SwiftShader): the pass and the inline compile, zero
scales are a bit-exact no-op, and on a 256² scene of a step edge, sines and a
colour cast the render matches the CPU model for five parameter sets to under
2 % of the change with no sample off by more than 0.01, then again at 96×64.
It needs the SafeLight repository beside this one (or `SAFELIGHT_CORE=<path>`)
with its dev dependencies installed.

## Install

Install from the SafeLight **Extensions** window, or load this folder via
Developer Tools ▸ Extensions during development. A **Pyramid Local Contrast**
panel appears in Develop (right dock). Build from source with `npm install &&
npm run build` (outputs `dist/index.js`). Needs SafeLight 2.5.5 or later.

## License & credits

**MIT.** An original implementation from textbook parts: the Laplacian pyramid
(Burt & Adelson, 1983) in its undecimated B3-spline form (Starck, Murtagh &
Bijaoui's *à trous* algorithm), bilateral range weighting (Tomasi & Manduchi,
1998), and the scene-referred idea of editing local contrast in log luminance
and applying it as a chroma-preserving multiplier, which darktable's 2026
*contrast & texture* module and the discussion around it made a convincing case
for. No code from those projects is used.
