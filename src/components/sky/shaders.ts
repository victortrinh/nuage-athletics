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
 * Cloud density field. Two earlier approaches were tried and rejected here:
 * thresholded value-noise produced connected ridge/streak contours (not
 * clouds), and a jittered-grid metaball field produced round but evenly
 * bounded blobs that read as cells/viruses rather than atmosphere — a
 * metaball has a defined edge, and real clouds don't: they fray into wisps
 * with no boundary at all.
 *
 * What's here instead is domain-warped fbm (the standard technique for
 * painterly clouds/smoke/fire): a low-frequency fbm's output is used to
 * offset the sampling position of a second fbm, twice, before the final
 * detail fbm reads from that twice-displaced position. Every step is still
 * a continuous field — there is no cell, seed, or boundary anywhere in this
 * pipeline — so the result flows and curls organically instead of tiling
 * into discrete shapes.
 *
 * A separate, cheap, low-frequency "placement" fbm decides which broad
 * regions lean cloudy at all; it's combined with the warped detail through
 * a wide smoothstep (not a tight threshold), so clouds fade into clear sky
 * gradually over a real gradient instead of stopping at a crisp edge. The
 * wake still domain-warps the detail sample and subtracts density, both
 * scaled by that placement mask (evaluated at the plain screen position, so
 * there's no feedback loop) — a swipe through a clear gap still does
 * nothing, since there's no cloud there to cut.
 *
 * Output is clamped to [uCloudMin, uCloudMax] grayscale so no pixel ever
 * gets dark enough to threaten text contrast against the ink foreground.
 */
export const CLOUD = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uNoise;
  uniform sampler2D uNoiseSharp;
  uniform sampler2D uFluid;
  uniform float uTime;
  uniform vec2 uOffset1;
  uniform vec2 uMacroOffset;
  uniform float uCoverage;
  uniform float uCoverageSoftness;
  uniform float uCloudMin;
  uniform float uCloudMax;

  float n(vec2 p) { return texture2D(uNoise, fract(p)).r; }
  float nSharp(vec2 p) { return texture2D(uNoiseSharp, fract(p)).r; }

  // A blurred multi-octave fbm sum (used everywhere else in this shader)
  // averages many values together, which by the central limit theorem
  // compresses its own range toward the mean — it almost never gets close
  // to a genuine 0 or 1. Whether sky is "clearly clear" or "clearly cloud"
  // needs that full range, so placement reads the *un*blurred texture and
  // stays dominated by one low-frequency sample (a small second term only
  // roughens the edge) rather than averaging several octaves together.
  float placementNoise(vec2 p) {
    return nSharp(p) * 0.9 + nSharp(p * 2.3 + 11.7) * 0.1;
  }

  // Cheap 3-octave fbm — used both as the placement field and as the inner
  // building block of the warp chain below, where full detail is wasted.
  float fbm3(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 3; i++) {
      sum += amp * n(p * freq);
      freq *= 2.1;
      amp *= 0.5;
    }
    return sum;
  }

  // 3-octave fbm for the final warped read — fewer octaves and a steeper
  // falloff than the original 5, so the fine, grainy frequencies drop out
  // entirely instead of just being faint. Those were reading as sparkle/
  // glare rather than the soft, calm blobs of tone a real cloud shows.
  float fbm5(vec2 p) {
    float sum = 0.0;
    float amp = 0.6;
    float freq = 1.0;
    for (int i = 0; i < 3; i++) {
      sum += amp * n(p * freq);
      freq *= 2.0;
      amp *= 0.35;
    }
    return sum;
  }

  // Domain-warped fbm: q and r are each a 2D fbm field used purely to
  // displace the position fed into the next fbm sample. Nothing here is
  // thresholded or gated by a cell/seed — the whole thing is one continuous,
  // flowing function, which is what gives it curling, wispy structure
  // instead of tiled shapes. The warp magnitude is kept modest (not the
  // aggressive displacement typical of this technique) so the flow reads as
  // calm, soft blobs rather than a busy, agitated swirl.
  float warpedCloud(vec2 p) {
    vec2 q = vec2(fbm3(p), fbm3(p + vec2(5.2, 1.3)));
    vec2 r = vec2(
      fbm3(p + 1.3 * q + vec2(1.7, 9.2)),
      fbm3(p + 1.3 * q + vec2(8.3, 2.8))
    );
    return fbm5(p + 1.1 * r);
  }

  void main() {
    // Placement: one low-frequency noise sample — stretched wider than tall
    // so cloud regions read as sky-like horizontal bands rather than
    // isotropic dots — combined through a wide-ish smoothstep. Gradual, not
    // tight: real clouds don't have an edge, they thin out. A single
    // texture2D lookup already sweeps the full 64x64 texture, so it's the
    // *coordinate scale* that sets how many regions appear across the
    // screen (effective frequency is roughly 64 * scale cycles) — ~0.08-0.1
    // gives a handful, matching the placement analysis this was tuned from.
    vec2 placementPos = vUv * vec2(0.1, 0.065) + uMacroOffset;
    float placement = placementNoise(placementPos);
    float mask = smoothstep(uCoverage - uCoverageSoftness, uCoverage + uCoverageSoftness, placement);

    vec4 fluidData = texture2D(uFluid, vUv);
    vec2 vel = fluidData.rg * 2.0 - 1.0;
    float carve = fluidData.b;

    // The wake only visibly warps/cuts where the placement mask already
    // says "cloud" — evaluated before this warp is applied, so there's no
    // feedback loop.
    vec2 warp = vel * 0.6 * mask;
    // Larger-scale than before — bigger, calmer blobs of tone rather than
    // small, busy repetition.
    vec2 detailPos = vUv * vec2(2.4, 1.5) + uOffset1 + warp;

    float shape = warpedCloud(detailPos);
    // Wider still than the already-wide curve this had — softer transitions
    // between a blob's core tone and the sky around it.
    shape = smoothstep(0.22, 0.78, shape);

    vec2 sunDir = normalize(vec2(0.35, 0.5)) * 0.06;
    float shapeLit = smoothstep(0.22, 0.78, warpedCloud(detailPos - sunDir));
    float light = clamp((shape - shapeLit) * 2.0 + 0.5, 0.0, 1.0);

    float density = mask * shape;
    density = clamp(density - carve * mask * 0.9, 0.0, 1.0);

    float lum = mix(uCloudMax, uCloudMin, density);
    // Gated by density itself (not just the placement mask) so the shadow
    // term can't modulate brightness in pixels that are already at zero
    // density — the same class of bug that leaked detail-shaped texture
    // into clear sky before.
    lum *= mix(1.0, mix(0.95, 1.0, light), density);
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
