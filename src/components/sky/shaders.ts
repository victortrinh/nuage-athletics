/**
 * All shaders are plain GLSL ES 1.00 (attribute/varying, gl_FragColor).
 * WebGL2 contexts compile this fine — no need for #version 300 es here,
 * and it keeps ogl's implicit uniforms (which assume this dialect) working.
 */

export const VERTEX = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

/**
 * Cloud density field, built the way production volumetric-cloud shaders
 * build one: big smooth masses first, then *erode* their edges with fine
 * noise. Several other approaches were tried and rejected here — thresholded
 * value-noise gave connected ridge/streak contours; a jittered-grid metaball
 * field gave round but evenly bounded blobs that read as cells; and simply
 * blending fine detail *into* the body (adding octaves, or steepening a
 * threshold over a multi-octave sum) either reads as grain/TV static or, if
 * softened enough to kill the grain, collapses into a pale flowing marble
 * with no cloud structure at all.
 *
 * Erosion is what avoids that trade-off. `shape` is a coverage-remapped read
 * of `uNoiseShape` (blurred four times, then contrast-stretched back to the
 * full 0..1 range at build time — see noise.ts), so it has real solid cores
 * and real clear gaps and is smooth everywhere. `erosionNoise` — fine,
 * three-octave, and far too high-frequency to ever be added to the body — is
 * then used as the *low end* of a second remap. That makes the fine noise
 * bite hardest where the shape is already thin (the edges, which fray into
 * billowy cauliflower wisps, exactly what a real cloud boundary looks like)
 * while leaving cores at 1.0 untouched and perfectly smooth. Same detail
 * texture that used to produce static; it just can't, in this position.
 *
 * A separate, cheap, low-frequency "placement" field decides which broad
 * regions lean cloudy at all, and feeds the first remap's threshold — so a
 * region the mask calls clear needs a very solid base reading to show any
 * cloud, and a region it calls cloudy shows nearly all of it.
 *
 * This pass no longer paints anything a visitor sees. It runs at one texel
 * per glyph cell and writes the deck's density into r, which GLYPH below
 * reads to decide which character each cell gets — so the cloud *shapes*
 * are exactly the ones this field always drew, they are just set in type.
 */
export const CLOUD = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uNoise;
  uniform sampler2D uNoiseSharp;
  uniform sampler2D uNoiseShape;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uOffset1;
  uniform vec2 uMacroOffset;
  uniform float uCoverage;
  uniform float uCoverageSoftness;
  uniform float uCoverageBite;

  float n(vec2 p) { return texture2D(uNoise, fract(p)).r; }
  float nSharp(vec2 p) { return texture2D(uNoiseSharp, fract(p)).r; }
  float nShape(vec2 p) { return texture2D(uNoiseShape, fract(p)).r; }

  // Rescales v so that everything at or below lo becomes 0 and 1.0 stays 1.0.
  // Both the coverage cut and the edge erosion are this same operation: it
  // eats into a field from below without ever touching what's already solid.
  float remapFloor(float v, float lo) {
    return clamp((v - lo) / max(1e-4, 1.0 - lo), 0.0, 1.0);
  }

  // A blurred multi-octave fbm sum averages many values together, which by
  // the central limit theorem compresses its own range toward the mean — it
  // almost never gets close to a genuine 0 or 1. Whether sky is "clearly
  // clear" or "clearly cloud" needs that full range, so placement reads the
  // *un*blurred texture and stays dominated by one low-frequency sample (a
  // small second term only roughens the edge) rather than averaging several
  // octaves together.
  float placementNoise(vec2 p) {
    return nSharp(p) * 0.9 + nSharp(p * 2.3 + 11.7) * 0.1;
  }

  // The cloud masses themselves. One full-range read, softly displaced by a
  // low-frequency, *low-contrast* offset so masses lean and curl instead of
  // sitting there as bland ovals. The offset field has to stay low-contrast:
  // warping with anything itself contrast-stretched turns small position
  // jitter into large noisy swings once it lands on this texture's steep
  // gradient.
  float baseShape(vec2 p) {
    vec2 q = vec2(n(p * 0.6) - 0.5, n(p * 0.6 + vec2(5.2, 1.3)) - 0.5);
    return nShape(p + 0.35 * q);
  }

  // Fine three-octave detail, used *only* as the erosion floor above.
  float erosionNoise(vec2 p) {
    return (n(p) * 0.6 + n(p * 2.4) * 0.27 + n(p * 5.76) * 0.1215) / 0.9915;
  }

  void main() {
    // vUv is always 0..1 on both axes regardless of the canvas's actual
    // pixel aspect ratio, so sampling noise directly from it means cloud
    // *feature size* stretches with window shape — on a wide/ultrawide
    // window the pattern spreads out horizontally and leaves large empty
    // gaps, since the same 0..1 span now covers far more physical pixels.
    // Scaling x by the real aspect ratio first keeps feature size (and so
    // coverage) consistent across any window shape.
    vec2 auv = vec2(vUv.x * uAspect, vUv.y);

    // Placement: one low-frequency noise sample, combined through a
    // wide-ish smoothstep. Gradual, not tight: real clouds don't have an
    // edge, they thin out. A single texture2D lookup already sweeps the
    // full 64x64 texture, so it's the *coordinate scale* that sets how many
    // regions appear across the screen (effective frequency is roughly
    // 64 * scale cycles). A lower scale here (~0.06) meant so few cycles fit
    // across a real window that a single contiguous clear run could span
    // 95%+ of the width purely by chance — measured offline across scanlines
    // before picking 0.1, which keeps the largest clear run under ~30% of
    // the width at every aspect ratio tested.
    vec2 placementPos = auv * 0.1 + uMacroOffset;
    float placement = placementNoise(placementPos);
    float mask = smoothstep(uCoverage - uCoverageSoftness, uCoverage + uCoverageSoftness, placement);

    vec2 detailPos = auv * 1.5 + uOffset1;

    // Coverage cut. uCoverageBite caps how much the mask is allowed to eat,
    // so a "clear" region thins to haze rather than to bare sky — the deck
    // is unbroken, with the mask only deciding where it runs thick or thin.
    float coverFloor = (1.0 - mask) * uCoverageBite;
    float shape = remapFloor(baseShape(detailPos), coverFloor);
    // Edge erosion — the step that makes this read as cloud rather than as
    // smooth blobs. Cores (shape near 1) are untouched; thin edges get eaten
    // into billowy, frayed wisps.
    float density = remapFloor(shape, erosionNoise(detailPos * 3.0) * 0.42);
    // No density floor here any more: a floor put a little cloud in every
    // *pixel* so the old deck never opened to bare white, but a glyph is a
    // threshold, and a floor would set a dot in every cell of the page. The
    // coverage bite above already keeps thin regions hazy rather than clear,
    // which is what reads as light cloud once it is set in type.
    gl_FragColor = vec4(density, 0.0, 0.0, 1.0);
  }
`

/**
 * Sets the deck in type. Every screen pixel works out which grid cell it is
 * in, reads that cell's density from CLOUD's one-texel-per-cell target, and
 * draws one character from a ramp that runs light to heavy cloud — so the
 * field is the same weather the deck always was, at the resolution of a
 * monospace grid.
 *
 * Two things move a cell's glyph and tone on top of the drift: ripples (a
 * ring that spreads from a click and fades over uRippleLife seconds, with a
 * weaker trailing crest, like water) and a soft halo round the pointer. Both
 * push density *up*, so a ripple passing through clear sky raises a ring of
 * light marks and one passing through cloud thickens it.
 *
 * The atlas holds every glyph twice: row 0 crisp, row 1 drawn with a blur,
 * which is the glow. Colour comes from the brand tokens alone — mute grey at
 * rest, rising through accent ink to the accent blue with that glow at a
 * ripple's crest. At rest a glyph tops out well under half opacity, so text
 * set over the field is read against what is still mostly paper; uCalm
 * fades the field further behind the few blocks of type that sit directly
 * on it (`data-sky-calm`, read by engine.ts).
 *
 * Coordinates are CSS pixels with y down, so everything the engine passes
 * in — pointer, ripples, calm boxes — comes straight from clientX/Y and
 * getBoundingClientRect() with no conversion.
 */
export const GLYPH = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uCloud;
  uniform sampler2D uAtlas;
  uniform vec2 uViewport;
  uniform vec2 uGrid;
  uniform float uCell;
  uniform float uGlyphCount;
  uniform float uTime;
  uniform vec4 uRipples[8];
  uniform float uRippleSpeed;
  uniform float uRippleLife;
  uniform float uRippleWidth;
  uniform vec2 uPointer;
  uniform vec4 uCalm[4];
  uniform float uCalmCount;
  uniform vec3 uPaper;
  uniform vec3 uMute;
  uniform vec3 uAccentInk;
  uniform vec3 uAccent;

  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uViewport;
    vec2 cell = floor(p / uCell);
    vec2 local = fract(p / uCell);
    vec2 c = (cell + 0.5) * uCell;

    float density = texture2D(uCloud, vec2((cell.x + 0.5) / uGrid.x, 1.0 - (cell.y + 0.5) / uGrid.y)).r;

    float rip = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 r = uRipples[i];
      if (r.w <= 0.0) continue;
      float age = uTime - r.z;
      if (age < 0.0 || age > uRippleLife) continue;
      float d = distance(c, r.xy);
      float k = (d - age * uRippleSpeed) / uRippleWidth;
      float ring = exp(-k * k) + 0.35 * exp(-(k + 2.2) * (k + 2.2));
      rip += r.w * ring * pow(1.0 - age / uRippleLife, 1.6) / (1.0 + d / 900.0);
    }

    vec2 dp = c - uPointer;
    float hover = exp(-dot(dp, dp) / 9800.0);

    float quiet = 1.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uCalmCount) break;
      vec4 z = uCalm[i];
      vec2 q = (c - z.xy) / z.zw;
      quiet = min(quiet, clamp((length(q) - 0.7) / 0.9, 0.08, 1.0));
    }

    // The deck's density bunches in the middle of its range (the coverage
    // bite keeps thin regions hazy, cores sit near 1), which set in type
    // read as one flat grey of dashes. Stretching it before picking a glyph
    // gives haze its light marks, cores their heavy ones, and the shapes
    // between them back.
    float shaped = smoothstep(0.02, 0.8, density);
    float cloud = clamp(shaped + rip * 0.5 + hover * 0.15, 0.0, 1.0);
    float g = floor(cloud * (uGlyphCount - 0.01));
    if (g < 0.5) {
      gl_FragColor = vec4(uPaper, 1.0);
      return;
    }

    float k = clamp((0.12 + cloud * 0.25 + rip * 0.85) * quiet, 0.0, 1.0);
    vec3 col = k < 0.5 ? mix(uMute, uAccentInk, k * 2.0) : mix(uAccentInk, uAccent, (k - 0.5) * 2.0);
    float alpha = 0.10 + 0.9 * pow(k, 1.3);

    vec2 auv = vec2((g + local.x) / uGlyphCount, local.y * 0.5);
    float core = texture2D(uAtlas, auv).a;
    float glow = texture2D(uAtlas, auv + vec2(0.0, 0.5)).a;

    vec3 outc = mix(uPaper, uAccent, glow * smoothstep(0.35, 1.0, k) * 0.9);
    outc = mix(outc, col, core * alpha);
    gl_FragColor = vec4(outc, 1.0);
  }
`
