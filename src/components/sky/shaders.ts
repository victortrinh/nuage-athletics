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
  uniform vec2 uCellDensity;
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

  // Thresholding value-noise (independent random texels, bilinearly
  // interpolated) tends to produce elongated, connected ridge/streak
  // contours rather than round blobs — that's an inherent property of the
  // noise, not a tuning knob. Round, countable clouds instead come from an
  // explicit jittered-grid metaball field: one pseudo-random seed point per
  // grid cell (hashed from the cell coordinate, so no extra texture/state
  // needed) with a radial Gaussian falloff, maxed over the 3x3 neighbourhood
  // so blobs near a cell border still read correctly. Cloud *count* is then
  // just the grid density (uCellDensity) — directly controllable — and
  // every blob is round by construction.
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }

  float cloudField(vec2 uv, vec2 offset) {
    vec2 p = uv * uCellDensity + offset;
    // Warp the sample position before splitting into cells, so a blob's
    // silhouette reads as an irregular, organic shape rather than a perfect
    // circle — a plain metaball grid alone looks like even polka dots.
    vec2 warp = (vec2(n(p * 0.7 + 3.1), n(p * 0.7 + 9.4)) - 0.5) * 0.7;
    p += warp;
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float field = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 h = hash2(cell + neighbor);
        // Only some cells actually carry a cloud seed — a real sky isn't
        // one evenly-spaced blob per grid cell, it's sparse and irregular.
        float exists = step(0.35, h.x);
        vec2 seedPos = neighbor + 0.15 + h.yx * 0.7;
        float radius = mix(0.26, 0.62, fract(h.x * 7.0));
        vec2 diff = f - seedPos;
        float d2 = dot(diff, diff);
        field = max(field, exists * exp(-d2 / (radius * radius)));
      }
    }
    return field;
  }

  void main() {
    float macro = cloudField(vUv, uMacroOffset);
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
