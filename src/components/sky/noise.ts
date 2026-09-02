/** Seeded PRNG (mulberry32) so the noise texture is stable across reloads. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Raw independent-random texel values, bilinearly interpolated, still show
 * a visibly sharp "diamond" ramp at each texel boundary — there's no actual
 * smoothing *between* neighbouring random values. A small wrapping box blur
 * removes that, so the GPU's own bilinear sampling produces genuinely smooth
 * gradients instead. One-time cost at startup (size^2 texels), never repeated.
 */
function boxBlur(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(data.length)
  const wrap = (v: number) => ((v % size) + size) % size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += data[(wrap(y + dy) * size + wrap(x + dx)) * 4 + c]
          }
        }
        out[(y * size + x) * 4 + c] = Math.round(sum / 9)
      }
    }
  }
  return out
}

/**
 * Stretches each channel's values back out to fill the full 0-255 range
 * based on its own observed min/max. Repeated box blurring is a repeated
 * local average, which (central limit theorem, same reasoning as the
 * placement texture below) compresses the value range toward the mean each
 * pass — after four passes a channel that started at 0-255 might only
 * actually span ~70-190. That's fine for something sampled as a small
 * modulation, but the cloud *shape* read needs to reach genuine 0 and 1 to
 * ever show a real solid core or a real clear gap. Stretching is a global,
 * monotonic remap applied once at build time — it doesn't add any new
 * per-texel variation, so it can't reintroduce the grain the blur removed.
 */
function stretchContrast(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let c = 0; c < 4; c++) {
    let min = 255
    let max = 0
    for (let i = c; i < data.length; i += 4) {
      if (data[i] < min) min = data[i]
      if (data[i] > max) max = data[i]
    }
    const range = Math.max(1, max - min)
    for (let i = c; i < data.length; i += 4) {
      out[i] = Math.round(((data[i] - min) / range) * 255)
    }
  }
  return out
}

export interface NoiseTextures {
  /** Blurred — smooth gradients, no texel-boundary ramp. Used for the cloud warp offset. */
  detail: Uint8Array
  /**
   * Unblurred. The box blur averages 9 independent random values together,
   * which (central limit theorem) compresses the value range by roughly 3x —
   * fine for smooth detail texture, but it means a low-frequency sample of
   * the blurred texture almost never gets close to 0 or 1, so nothing built
   * on it can ever resolve to a *genuinely* clear or *genuinely* solid
   * region. The cloud placement mask needs that full range to tell clear
   * sky from cloud at all, so it reads from this sharp version instead.
   */
  placement: Uint8Array
  /**
   * Blurred twice again past `detail` (four passes total), then contrast-
   * stretched back to the full range. This is what the cloud shape itself
   * reads: a single sample gives a genuine solid core in some spots and a
   * genuine clear gap in others, instead of the pale, narrow-range midtone
   * a multi-octave sum of `detail` produces.
   */
  shape: Uint8Array
}

/**
 * A small tiling RGBA noise texture, one random value per channel. Sampled
 * with wrap and bilinear filtering, this is what the cloud shader reads from
 * — a texture fetch is much cheaper than an ALU hash, and it ships as zero
 * network bytes since it's built at runtime.
 */
export function buildNoiseTextures(size = 64, seed = 1337): NoiseTextures {
  const rand = mulberry32(seed)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = Math.floor(rand() * 256)
    data[i * 4 + 1] = Math.floor(rand() * 256)
    data[i * 4 + 2] = Math.floor(rand() * 256)
    data[i * 4 + 3] = Math.floor(rand() * 256)
  }
  // Two passes (not one) for the detail texture — a single 3x3 blur still
  // leaves enough high-frequency content to read as fine grain/sparkle once
  // it's driving the warp offset; a second pass smooths that into calm,
  // soft tonal blobs instead.
  const detail = boxBlur(boxBlur(data, size), size)
  const shape = stretchContrast(boxBlur(boxBlur(detail, size), size))
  return { detail, placement: data, shape }
}
