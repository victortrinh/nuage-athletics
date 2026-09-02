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
      float falloff = exp(-(dist * dist) / (r * r));

      vec2 dir = normalize(ab + 1e-6);
      vec2 perp = vec2(-dir.y, dir.x);
      float across = dot(p - proj, perp);
      float vortexFalloff = exp(-(across * across) / (r * r * 0.4));

      vel += dir * falloff * uSplatStrength;
      vel += perp * sign(across) * vortexFalloff * falloff * uSplatStrength * 1.3;
      carve += falloff * 0.9;
    }

    carve = clamp(carve, 0.0, 1.0);
    gl_FragColor = vec4(encodeVel(vel), carve, 1.0);
  }
`

/**
 * Cloud density field: a low-res texture-sampled fBm (bilinear-filtered
 * noise doubles as the smooth base value, so each octave is one fetch) at
 * two scales/speeds for parallax. A second fBm sample offset toward a fixed
 * sun direction gives a cheap self-shadow term without raymarching.
 *
 * A separate, coarser "macro" noise (fewer octaves, lower frequency — a
 * placement mask needs to stay smooth, not grainy) is thresholded into a
 * soft-edged `coverage` value: ~0 is clear sky, ~1 is solidly cloud. The fine
 * detail fbm is multiplied by it, so clear regions collapse to flat bright
 * sky regardless of what the detail layer is doing there — this is what
 * splits the single continuous field into separate, gapped clouds.
 *
 * The wake field domain-warps the detail lookup and subtracts density, both
 * scaled by that same `coverage` value (evaluated at the plain screen
 * position, so there's no feedback loop) — a swipe through a clear gap does
 * nothing, since there's no cloud there to cut.
 *
 * Output is clamped to [uCloudMin, uCloudMax] grayscale so no pixel ever
 * gets dark enough to threaten text contrast against the ink foreground.
 */
export const CLOUD = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uNoise;
  uniform sampler2D uFluid;
  uniform float uTime;
  uniform vec2 uOffset1;
  uniform vec2 uOffset2;
  uniform vec2 uMacroOffset;
  uniform float uCoverage;
  uniform float uCoverageSoftness;
  uniform float uCloudMin;
  uniform float uCloudMax;

  float n(vec2 p) { return texture2D(uNoise, fract(p)).r; }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.55;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      sum += amp * n(p * freq);
      freq *= 2.03;
      amp *= 0.45;
    }
    return sum;
  }

  // A single texture2D lookup already sweeps the full 64x64 noise texture,
  // i.e. 64 independent random texels — so the *coordinate scale* passed in
  // (not an octave count) is what controls how many soft blobs appear across
  // the screen: effective spatial frequency is roughly 64 * scale cycles.
  // A scale around 0.08-0.09 gives a handful of blobs, matching the
  // "scattered, moderate coverage" cloud placement this is meant to produce.
  float macroNoise(vec2 p) {
    // The secondary term only nudges the edges of a region the primary term
    // has already decided is cloud or clear — too much weight here lets it
    // independently flip the coverage threshold in small scattered patches
    // far from any real cloud, which is what read as persistent grain in
    // supposedly-clear sky.
    return n(p) * 0.92 + n(p * 2.3 + 11.7) * 0.08;
  }

  void main() {
    float macro = macroNoise(vUv * 0.085 + uMacroOffset);
    float coverage = smoothstep(uCoverage - uCoverageSoftness, uCoverage + uCoverageSoftness, macro);
    // A second easing pass doesn't widen the transition band in screen space,
    // but it does push any lingering faint-but-nonzero coverage within that
    // band decisively toward 0 — this is what actually flattens "clear" sky
    // to true white instead of leaving faint detail-texture grain visible.
    coverage = coverage * coverage * (3.0 - 2.0 * coverage);

    vec4 fluidData = texture2D(uFluid, vUv);
    vec2 vel = fluidData.rg * 2.0 - 1.0;
    float carve = fluidData.b;

    vec2 warp = vel * 0.5 * coverage;
    vec2 p1 = vUv * 2.6 + uOffset1 + warp;
    vec2 p2 = vUv * 5.2 + uOffset2 + warp * 1.4;

    float detail = fbm(p1) * 0.65 + fbm(p2) * 0.35;
    // A contrast S-curve biases mid-tones toward a solid puff-core or a
    // soft gap instead of continuous fine marbling — this is what gives
    // each cloud lobe a rounder, more solid cumulus-like body.
    detail = smoothstep(0.25, 0.75, detail);

    vec2 sunDir = normalize(vec2(0.35, 0.5)) * 0.05;
    float detailLit = fbm(p1 - sunDir) * 0.65 + fbm(p2 - sunDir) * 0.35;
    detailLit = smoothstep(0.25, 0.75, detailLit);
    float light = clamp((detail - detailLit) * 2.0 + 0.5, 0.0, 1.0);

    float density = coverage * detail;
    density = clamp(density - carve * coverage * 0.6, 0.0, 1.0);

    float lum = mix(uCloudMax, uCloudMin, density);
    // The self-shadow term has to be gated by coverage too — otherwise it
    // modulates brightness by the fine detail fbm's own shape everywhere,
    // including where density is already 0, which is what was injecting
    // detail-shaped texture into supposedly-flat clear sky.
    lum *= mix(1.0, mix(0.9, 1.0, light), coverage);
    lum = clamp(lum, uCloudMin, uCloudMax);

    gl_FragColor = vec4(vec3(lum), 1.0);
  }
`

/** Upsamples the low-res cloud render target to the display canvas. */
export const BLIT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  void main() {
    gl_FragColor = texture2D(uTex, vUv);
  }
`
