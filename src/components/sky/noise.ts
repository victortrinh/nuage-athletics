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

export interface NoiseTextures {
  /** Blurred — smooth gradients, no texel-boundary ramp. Used for fbm detail/warp. */
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
}

/**
 * A small tiling RGBA noise texture, one random value per channel. Sampled
 * with wrap and bilinear filtering, this is what the fBm octaves in the
 * cloud shader read from — a texture fetch per octave is much cheaper than
 * an ALU hash, and it ships as zero network bytes since it's built at runtime.
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
  return { detail: boxBlur(data, size), placement: data }
}
