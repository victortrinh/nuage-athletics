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
 * Fluid step: advects the previous frame's velocity + carve field, decays it
 * toward zero, and splats a new disturbance along the segment the pointer
 * travelled since the last frame. The splat adds a forward velocity impulse
 * plus a counter-rotating vortex pair either side of the path — the pair is
 * what makes the wake curl like a contrail instead of just smearing.
 *
 * Channels: rg = velocity (encoded 0..1, decode v*2-1), b = carve amount.
 * No pressure projection: for a decorative wisp field this reads convincingly
 * close to a real fluid solve at a fraction of the cost of Jacobi iterations.
 */
export const FLUID_STEP = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uSource;
  uniform float uDt;
  uniform float uDissipation;
  uniform float uAspect;

  uniform vec2 uPointerPrev;
  uniform vec2 uPointerCurr;
  uniform float uPointerActive;
  uniform float uSplatRadius;
  uniform float uSplatStrength;

  vec2 decodeVel(vec2 v) { return v * 2.0 - 1.0; }
  vec2 encodeVel(vec2 v) { return clamp(v, -1.0, 1.0) * 0.5 + 0.5; }

  void main() {
    vec4 data = texture2D(uSource, vUv);
    vec2 vel = decodeVel(data.rg);

    vec2 backCoord = vUv - vel * uDt * 0.6;
    vec4 advected = texture2D(uSource, clamp(backCoord, 0.0, 1.0));
    vel = decodeVel(advected.rg);
    float carve = advected.b;

    vel *= uDissipation;
    carve *= uDissipation;

    if (uPointerActive > 0.5) {
      vec2 p = vUv; p.x *= uAspect;
      vec2 a = uPointerPrev; a.x *= uAspect;
      vec2 b = uPointerCurr; b.x *= uAspect;
      vec2 ab = b - a;
      float abLen2 = max(dot(ab, ab), 1e-6);
      float t = clamp(dot(p - a, ab) / abLen2, 0.0, 1.0);
      vec2 proj = a + ab * t;
      float dist = distance(p, proj);
      float r = max(uSplatRadius, 1e-4);
      // A moderately steep falloff (power ~2.5) gives a somewhat defined,
      // plateau-topped cleared channel down the middle — reads as an actual
      // cut/parting rather than a soft blurry smudge — without going so
      // steep it shrinks the visible affected width down to nothing.
      float rr = dist / r;
      float falloff = exp(-pow(rr * rr, 1.25));

      vec2 dir = normalize(ab + 1e-6);
      vec2 perp = vec2(-dir.y, dir.x);
      float across = dot(p - proj, perp);
      float vortexFalloff = exp(-(across * across) / (r * r * 0.4));

      vel += dir * falloff * uSplatStrength;
      vel += perp * sign(across) * vortexFalloff * falloff * uSplatStrength * 1.7;
      // A decisive clear-channel: the core of a real contrail reads as
      // fully parted cloud, not a partial fade.
      carve += falloff * 1.15;
    }

    carve = clamp(carve, 0.0, 1.0);
    gl_FragColor = vec4(encodeVel(vel), carve, 1.0);
  }
`

/**
 * Seeds a fluid target to its neutral state.
 *
 * This is not cosmetic. Velocity lives in rg as `v * 0.5 + 0.5`, so zero
 * velocity encodes to 0.5 — but a freshly allocated render target is
 * *zero*-filled, and 0.0 decodes back to -1.0. Left alone, every fluid
 * buffer therefore starts out claiming a full-magnitude (-1,-1) velocity
 * across the entire field, which the cloud pass reads as a position warp of
 * (-0.6,-0.6) — around a quarter of the screen — that then slides back to
 * true over the several seconds the bogus velocity takes to dissipate. That
 * was the diagonal sweep the whole sky appeared to perform on every page
 * load, and no amount of fading the canvas in could have hidden it.
 */
export const FLUID_SEED = /* glsl */ `
  precision highp float;
  void main() {
    gl_FragColor = vec4(0.5, 0.5, 0.0, 1.0);
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
 * cloud, and a region it calls cloudy shows nearly all of it. The wake
 * displaces the shape sample and subtracts density, both scaled by that
 * mask (evaluated at the plain screen position, so there's no feedback
 * loop) — a swipe through a clear gap still does nothing, since there's no
 * cloud there to cut.
 *
 * Output is clamped so no pixel ever gets dark enough to threaten text
 * contrast against the ink foreground (measured: the deepest shadowed core
 * still clears AAA).
 */
export const CLOUD = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uNoise;
  uniform sampler2D uNoiseSharp;
  uniform sampler2D uNoiseShape;
  uniform sampler2D uFluid;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uOffset1;
  uniform vec2 uMacroOffset;
  uniform float uCoverage;
  uniform float uCoverageSoftness;
  uniform float uCoverageBite;
  uniform float uDensityFloor;
  uniform float uCloudMin;
  uniform float uCloudMax;

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

    // Only the velocity is read here. The wake's actual clearing cut is made
    // in the blit pass instead, at full display resolution — see BLIT.
    vec2 vel = texture2D(uFluid, vUv).rg * 2.0 - 1.0;

    vec2 warp = vel * 0.6;
    vec2 detailPos = auv * 1.5 + uOffset1 + warp;

    // Coverage cut. uCoverageBite caps how much the mask is allowed to eat,
    // so a "clear" region thins to haze rather than to bare sky — the deck
    // is unbroken, with the mask only deciding where it runs thick or thin.
    float coverFloor = (1.0 - mask) * uCoverageBite;
    float shape = remapFloor(baseShape(detailPos), coverFloor);
    // Edge erosion — the step that makes this read as cloud rather than as
    // smooth blobs. Cores (shape near 1) are untouched; thin edges get eaten
    // into billowy, frayed wisps.
    float density = remapFloor(shape, erosionNoise(detailPos * 3.0) * 0.42);
    // Every pixel keeps at least this much cloud, so the deck never opens to
    // bare white anywhere.
    density = uDensityFloor + (1.0 - uDensityFloor) * density;

    // Self-shadow: compare against the un-eroded shape a short step toward
    // the sun. Skipping erosion in this second sample costs three texture
    // fetches less per pixel and is visually indistinguishable — the shading
    // term is low-frequency anyway.
    vec2 sunDir = normalize(vec2(0.35, 0.5)) * 0.09;
    float shapeLit = remapFloor(baseShape(detailPos - sunDir), coverFloor);
    float light = clamp((density - shapeLit) * 2.2 + 0.5, 0.0, 1.0);

    float lum = mix(uCloudMax, uCloudMin, density);
    // Volume shading. Scaled by density so it can't tint pixels that hold no
    // cloud at all — the same class of bug that once leaked detail-shaped
    // texture into clear sky. This is where the puffiness comes from: it
    // darkens undersides without making the field as a whole any greyer,
    // which is what "glaring" felt like when the flat tone was pushed instead.
    lum *= 1.0 - density * 0.18 * (1.0 - light);
    lum = clamp(lum, uCloudMin - 0.18, uCloudMax);

    gl_FragColor = vec4(vec3(lum), 1.0);
  }
`

/**
 * Upsamples the low-res cloud render target to the display canvas, and cuts
 * the wake's clearing line while doing it.
 *
 * The cut lives here rather than in the cloud pass for a resolution reason:
 * the cloud pass runs at a fraction of the display size, so a wake drawn
 * only a few pixels wide is thinner than one of its texels and dissolves
 * into nothing. This pass runs per display pixel, so the line stays crisp
 * however fine it gets. The velocity warp stays in the cloud pass — that
 * part *wants* to be soft and low-frequency.
 *
 * uCarveLum is the haze tone the deck thins to, never bare white: a swipe
 * parts the cloud, it doesn't punch a hole through to nothing. Cutting
 * toward max() also means the line can only ever lighten, so it can't leave
 * a dark seam where it crosses sky already lighter than that tone.
 */
export const BLIT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform sampler2D uFluid;
  uniform float uCarveLum;
  void main() {
    float lum = texture2D(uTex, vUv).r;
    float carve = clamp(texture2D(uFluid, vUv).b, 0.0, 1.0);
    lum = mix(lum, max(lum, uCarveLum), carve * 0.9);
    gl_FragColor = vec4(vec3(lum), 1.0);
  }
`
