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
 * A small tiling RGBA noise texture, one random value per channel. Sampled
 * with wrap and bilinear filtering, this is what the fBm octaves in the
 * cloud shader read from — a texture fetch per octave is much cheaper than
 * an ALU hash, and it ships as zero network bytes since it's built at runtime.
 */
export function buildNoiseTexture(size = 64, seed = 1337): Uint8Array {
  const rand = mulberry32(seed)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = Math.floor(rand() * 256)
    data[i * 4 + 1] = Math.floor(rand() * 256)
    data[i * 4 + 2] = Math.floor(rand() * 256)
    data[i * 4 + 3] = Math.floor(rand() * 256)
  }
  return data
}
