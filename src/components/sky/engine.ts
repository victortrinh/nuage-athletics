import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from 'ogl'
import type { OGLRenderingContext } from 'ogl'
import { BLIT, CLOUD, FLUID_SEED, FLUID_STEP, VERTEX } from './shaders'
import { buildNoiseTextures } from './noise'
import { hasGivenUp, setGaveUp } from './prefs'

export interface SkyHandle {
  destroy(): void
  setPaused(paused: boolean): void
}

export interface SkyOptions {
  /** Called once the runtime ladder gives up and the canvas is hidden. */
  onGiveUp?: () => void
  /**
   * Called when the engine can't mount at all this session — e.g. WebGL2
   * context creation failed despite passing the earlier capability probe.
   * Unlike onGiveUp, retrying can't help here: the same canvas would build
   * the same context the same way, so the caller should treat the sky as
   * permanently unavailable rather than offering another attempt.
   */
  onUnavailable?: () => void
  /**
   * Called when the GPU context was reclaimed by the browser (not a
   * performance give-up) and has since been restored. Every GL object from
   * the old context is invalid at this point, so recovery means mounting a
   * fresh instance on the same canvas rather than patching resources back —
   * the caller is expected to call mountSky again from here.
   */
  onContextRestored?: () => void
}

/** Desktop frame-time budget. Loosened on coarse pointers below, where the
 * sim already runs at a lower target rate by design. */
const SLOW_FRAME_MS = 22
/** Accumulated slow time before stepping down a degrade tier. */
const SLOW_MS_TO_DEGRADE = 1000
/** Accumulated slow time, still above budget, before skipping straight to
 * giving up rather than walking the remaining tiers. */
const SLOW_MS_HARD_CEILING = 3000

/** Grayscale range the cloud pass writes within. */
const CLOUD_MIN = 0.82
const CLOUD_MAX = 0.99
/** Cloud kept in every pixel, so the deck never opens to bare white. */
const DENSITY_FLOOR = 0.25
/**
 * The tone a full-strength wake thins the deck to — exactly the luminance
 * the density floor alone produces, so a cut parts the cloud to haze and
 * stops there rather than punching through to white.
 */
const CARVE_LUM = CLOUD_MAX + (CLOUD_MIN - CLOUD_MAX) * DENSITY_FLOOR

/**
 * Share of the wake (both the carve and the velocity driving it) still
 * present one second later — a twentieth. The visible trace is effectively
 * gone within about half a second of the pointer moving on, against roughly
 * 3.5s under the old fixed 0.986-per-step decay, so the cloud closes back
 * over behind the pointer instead of holding the mark.
 */
const WAKE_RETENTION_PER_SEC = 0.05

function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

export function mountSky(canvas: HTMLCanvasElement, options: SkyOptions = {}): SkyHandle {
  if (hasGivenUp()) {
    return { destroy() {}, setPaused() {} }
  }

  const coarse = isCoarsePointer()
  let cloudScale = coarse ? 0.4 : 0.55
  const dprCap = coarse ? 1.0 : 1.5
  let simHz = coarse ? 30 : 60
  // The coarse-pointer sim already targets a lower rate by design (30Hz vs
  // 60Hz), so judging it against the desktop frame budget would degrade
  // touch devices that are running exactly as tuned.
  const slowFrameMs = coarse ? 30 : SLOW_FRAME_MS
  // The wake can never be finer than one texel of this buffer. At the old
  // 320 a single texel already covered ~5 screen px, which put a floor under
  // how thin the streak could be drawn; 640 halves that so a genuinely
  // hairline trail survives the sim. The step itself is two texture fetches
  // per texel, so even quadrupled it stays a small fraction of the cloud pass.
  let fluidBaseWidth = coarse ? 384 : 640

  let renderer: Renderer
  try {
    renderer = new Renderer({
      canvas,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Otherwise the drawing buffer can be cleared by the browser between
      // our render call and compositing, which also breaks any attempt to
      // read the canvas back (getImageData/drawImage) for testing.
      preserveDrawingBuffer: true,
      dpr: Math.min(window.devicePixelRatio || 1, dprCap),
      powerPreference: 'low-power',
    })
  } catch {
    setGaveUp()
    options.onUnavailable?.()
    return { destroy() {}, setPaused() {} }
  }
  const gl = renderer.gl as OGLRenderingContext

  if (!gl || !('drawingBufferWidth' in gl)) {
    setGaveUp()
    options.onUnavailable?.()
    return { destroy() {}, setPaused() {} }
  }

  const geometry = new Triangle(gl)

  const noiseData = buildNoiseTextures(64)
  const textureDefaults = {
    width: 64,
    height: 64,
    generateMipmaps: false,
    wrapS: gl.REPEAT,
    wrapT: gl.REPEAT,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    flipY: false,
  }
  const noiseTexture = new Texture(gl, { image: noiseData.detail, ...textureDefaults })
  const noiseSharpTexture = new Texture(gl, { image: noiseData.placement, ...textureDefaults })
  const noiseShapeTexture = new Texture(gl, { image: noiseData.shape, ...textureDefaults })

  let fluidA: RenderTarget
  let fluidB: RenderTarget
  let cloudTarget: RenderTarget
  let fluidReadIsA = true

  function makeFluidTarget(width: number, height: number): RenderTarget {
    return new RenderTarget(gl, {
      width,
      height,
      depth: false,
      stencil: false,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })
  }

  function makeCloudTarget(width: number, height: number): RenderTarget {
    return new RenderTarget(gl, {
      width,
      height,
      depth: false,
      stencil: false,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })
  }

  let width = 1
  let height = 1
  let fluidWidth = fluidBaseWidth
  let fluidHeight = fluidBaseWidth

  function allocateTargets() {
    const aspect = width / height
    fluidWidth = fluidBaseWidth
    fluidHeight = Math.max(90, Math.round(fluidBaseWidth / aspect))
    fluidA = makeFluidTarget(fluidWidth, fluidHeight)
    fluidB = makeFluidTarget(fluidWidth, fluidHeight)
    cloudTarget = makeCloudTarget(
      Math.max(1, Math.round(width * cloudScale)),
      Math.max(1, Math.round(height * cloudScale))
    )
    fluidReadIsA = true
    // Both buffers must be written to their neutral encoding before anything
    // samples them — see FLUID_SEED. A zero-filled target is not a still
    // fluid, it is one moving diagonally at full speed.
    renderer.render({ scene: seedMesh, target: fluidA })
    renderer.render({ scene: seedMesh, target: fluidB })
  }

  const fluidProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: FLUID_STEP,
    uniforms: {
      uSource: { value: null },
      uDt: { value: 1 / 60 },
      // Overwritten every step from WAKE_RETENTION_PER_SEC and the step's
      // own duration — see stepFluid.
      uDissipation: { value: 1 },
      uAspect: { value: 1 },
      uPointerPrev: { value: [0.5, 0.5] },
      uPointerCurr: { value: [0.5, 0.5] },
      uPointerActive: { value: 0 },
      uSplatRadius: { value: 0.06 },
      uSplatStrength: { value: 1.2 },
    },
  })
  const fluidMesh = new Mesh(gl, { geometry, program: fluidProgram })

  const cloudProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: CLOUD,
    uniforms: {
      uNoise: { value: noiseTexture },
      uNoiseSharp: { value: noiseSharpTexture },
      uNoiseShape: { value: noiseShapeTexture },
      uFluid: { value: null },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uOffset1: { value: [0, 0] },
      uMacroOffset: { value: [0, 0] },
      // A *threshold* on the placement field, so lower means more cloud.
      // With uCoverageBite below capping how far the mask can cut, this now
      // only decides where the deck runs thick versus thin.
      uCoverage: { value: 0.3 },
      uCoverageSoftness: { value: 0.14 },
      // Together these are what guarantee no bare-white sky anywhere:
      // uCoverageBite caps the mask's cut so thin regions stay hazy rather
      // than going clear, and uDensityFloor puts a little cloud in every
      // pixel regardless. Measured offline across four aspect ratios:
      // exactly zero pixels at the flat-white ceiling, while the deck still
      // reads as billowy structure rather than a flat grey wash.
      uCoverageBite: { value: 0.5 },
      uDensityFloor: { value: DENSITY_FLOOR },
      // Raised from 0.72 — a calmer, softer grey floor. The old value read
      // as glaring/harsh against the near-white sky; there's ample contrast
      // margin against ink text to spare (was 19.3:1/11.35:1, both far past
      // the 4.5:1 AA floor), so this trades some of that margin for comfort.
      uCloudMin: { value: CLOUD_MIN },
      uCloudMax: { value: CLOUD_MAX },
    },
  })
  const cloudMesh = new Mesh(gl, { geometry, program: cloudProgram })

  const blitProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: BLIT,
    uniforms: {
      uTex: { value: null },
      uFluid: { value: null },
      uCarveLum: { value: CARVE_LUM },
    },
  })
  const blitMesh = new Mesh(gl, { geometry, program: blitProgram })

  // Must exist before the first allocateTargets() call below, which seeds
  // each freshly created fluid buffer with it.
  const seedProgram = new Program(gl, { vertex: VERTEX, fragment: FLUID_SEED })
  const seedMesh = new Mesh(gl, { geometry, program: seedProgram })

  // iOS Safari fires `resize` on every URL-bar collapse/expand: a
  // height-only delta of roughly 60-90px with the width unchanged.
  // Reallocating every fluid render target for that is what makes the sky
  // stutter mid-scroll, so a height-only change under this threshold is
  // absorbed into the existing CSS box instead of triggering a reallocation.
  // An ~11% vertical stretch of an abstract cloud field is invisible; the
  // reallocation isn't.
  const TOOLBAR_RESIZE_SLOP = 120

  function resize() {
    const w = Math.round(window.innerWidth)
    const h = Math.round(window.innerHeight)
    if (w === width && Math.abs(h - height) < TOOLBAR_RESIZE_SLOP) return
    width = w
    height = h
    renderer.setSize(width, height)
    allocateTargets()
  }
  resize()

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(resize, 150)
  }
  window.addEventListener('resize', onResize)

  let latestX = 0.5
  let latestY = 0.5
  let prevFrameX = 0.5
  let prevFrameY = 0.5
  let hasPointerPosition = false
  let movedSinceLastFrame = false

  function onPointerMove(e: PointerEvent) {
    latestX = e.clientX / window.innerWidth
    latestY = 1 - e.clientY / window.innerHeight
    if (!hasPointerPosition) {
      // Otherwise the very first pointer sample after mount computes a
      // splat segment from the default center position to wherever the
      // real cursor already was — reads as an unintended streak tearing
      // across the sky the instant the page loads, before the visitor has
      // moved the mouse at all.
      prevFrameX = latestX
      prevFrameY = latestY
      hasPointerPosition = true
    }
    movedSinceLastFrame = true
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  let paused = false
  let hidden = document.visibilityState === 'hidden'
  function onVisibility() {
    hidden = document.visibilityState === 'hidden'
    if (!hidden && !paused) {
      resync()
      scheduleFrame()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  let clock = 0
  let rafId: number | null = null
  let lastTime = performance.now()
  let simAccumulator = 0
  let emaFrameMs = 16
  let slowMs = 0
  let degradeTier = 0
  /** A gap this long is a stalled rAF (backgrounded tab, sleeping laptop,
   * blocked main thread), not a slow renderer — feeding it to the degrade
   * ladder below reads as catastrophic slowness and gives the whole sky up
   * on the first frame back. */
  const STALL_MS = 500

  // Shared by the visibility resume path and the stall guard in frame():
  // the pointer listener keeps updating latestX/Y while nothing is
  // stepping, so the first sim step after a gap would otherwise splat a
  // streak from the stale prevFrameX/Y to wherever the cursor is now — the
  // same failure mode the first-sample guard in onPointerMove exists to
  // avoid, just triggered by a gap instead of a fresh mount.
  function resyncPointer() {
    prevFrameX = latestX
    prevFrameY = latestY
    movedSinceLastFrame = false
  }

  function resync() {
    lastTime = performance.now()
    simAccumulator = 0
    resyncPointer()
  }

  function degrade(hardCeiling: boolean) {
    degradeTier += 1
    slowMs = 0
    if (hardCeiling || degradeTier > 2) {
      giveUp()
    } else if (degradeTier === 1) {
      cloudScale *= 0.7
      // Give back the resolution the finer wake costs before giving up
      // anything else — a slightly coarser streak beats a dropped frame.
      fluidBaseWidth = Math.round(fluidBaseWidth * 0.7)
      allocateTargets()
    } else {
      simHz = Math.max(15, simHz / 2)
    }
  }

  function giveUp() {
    setGaveUp()
    canvas.style.opacity = '0'
    stop()
    try {
      const ext = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
      ext?.loseContext()
    } catch {
      // ignore
    }
    options.onGiveUp?.()
  }

  function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
  }

  function scheduleFrame() {
    if (rafId === null) rafId = requestAnimationFrame(frame)
  }

  function frame(now: number) {
    rafId = null
    if (paused || hidden) return

    const rawDt = (now - lastTime) / 1000
    lastTime = now

    if (rawDt * 1000 > STALL_MS) {
      // Treat this exactly like a fresh resume: don't judge the gap as slow
      // frames, and don't let a stale pointer position draw a wake streak.
      simAccumulator = 0
      resyncPointer()
      scheduleFrame()
      return
    }

    const dt = Math.min(rawDt, 1 / 15)

    emaFrameMs = emaFrameMs * 0.9 + rawDt * 1000 * 0.1
    if (emaFrameMs > slowFrameMs) {
      slowMs += rawDt * 1000
      if (slowMs > SLOW_MS_HARD_CEILING) degrade(true)
      else if (slowMs > SLOW_MS_TO_DEGRADE) degrade(false)
    } else {
      slowMs = Math.max(0, slowMs - rawDt * 1000)
    }

    simAccumulator += dt
    const simDt = 1 / simHz
    while (simAccumulator >= simDt) {
      simAccumulator -= simDt
      stepFluid(simDt)
      if (simAccumulator > simDt * 4) simAccumulator = 0
    }

    clock += dt
    renderCloud(clock)
    scheduleFrame()
  }

  function stepFluid(simDt: number) {
    const read = fluidReadIsA ? fluidA : fluidB
    const write = fluidReadIsA ? fluidB : fluidA

    const dx = latestX - prevFrameX
    const dy = latestY - prevFrameY
    const dist = Math.hypot(dx, dy)
    const speed = dist / Math.max(simDt, 1 / 240)

    fluidProgram.uniforms.uSource.value = read.texture
    fluidProgram.uniforms.uDt.value = simDt
    fluidProgram.uniforms.uAspect.value = width / height
    // Raised to a per-*second* rate rather than a fixed per-step factor: the
    // sim runs at 60Hz normally, 30Hz on coarse pointers and as low as 15Hz
    // after the degrade path steps in, and a per-step constant would make the
    // wake linger two or four times as long on exactly the devices least able
    // to carry it.
    fluidProgram.uniforms.uDissipation.value = Math.pow(WAKE_RETENTION_PER_SEC, simDt)
    fluidProgram.uniforms.uPointerPrev.value = [prevFrameX, prevFrameY]
    fluidProgram.uniforms.uPointerCurr.value = [latestX, latestY]
    fluidProgram.uniforms.uPointerActive.value = movedSinceLastFrame ? 1 : 0
    // Radius is in the aspect-corrected space the splat is measured in,
    // where one unit spans the viewport's *height* — so on a 950px-tall
    // window 0.004 is a hair under 4px, and the visible mark (the falloff
    // reaches ~0.37 at exactly this radius) lands around 6-10px wide
    // depending on speed. Deliberately hairline: it should read as a wire
    // drawn through the deck, not a swathe.
    fluidProgram.uniforms.uSplatRadius.value = 0.005 + Math.min(speed * 0.0015, 0.003)
    // Strength is left where it was. The impulse is what makes a mark this
    // thin still register — a narrower splat carrying a weaker push would
    // simply vanish into the cloud.
    fluidProgram.uniforms.uSplatStrength.value = 1.0 + Math.min(speed * 1.5, 1.8)

    renderer.render({ scene: fluidMesh, target: write })

    prevFrameX = latestX
    prevFrameY = latestY
    movedSinceLastFrame = false
    fluidReadIsA = !fluidReadIsA
  }

  function renderCloud(t: number) {
    const fluidRead = fluidReadIsA ? fluidA : fluidB
    cloudProgram.uniforms.uFluid.value = fluidRead.texture
    cloudProgram.uniforms.uTime.value = t
    cloudProgram.uniforms.uAspect.value = width / height
    // Drift is deliberately constant from the first frame — no fade-in, no
    // ease-in ramp. Anything that changes over the first seconds after mount
    // reads as an animation playing at page load, which is exactly what this
    // background should not do: the clouds should simply already be there,
    // drifting as slowly as they always will. The speed below is slow enough
    // that nothing appears to "start".
    cloudProgram.uniforms.uOffset1.value = [t * 0.008, t * 0.003]
    // Placement samples at a much lower coordinate scale (~0.1) than the
    // detail layer, so the same drift speed would cross the whole field
    // far faster — keep it slow enough that clouds migrate gradually.
    cloudProgram.uniforms.uMacroOffset.value = [t * 0.00025, t * 0.0001]
    renderer.render({ scene: cloudMesh, target: cloudTarget })

    blitProgram.uniforms.uTex.value = cloudTarget.texture
    blitProgram.uniforms.uFluid.value = fluidRead.texture
    renderer.render({ scene: blitMesh })
  }

  // Fade the canvas in once the first real frame has painted.
  requestAnimationFrame(() => {
    renderCloud(clock)
    canvas.style.opacity = '1'
    lastTime = performance.now()
    scheduleFrame()
  })

  function onContextLost(e: Event) {
    // Without preventDefault() the browser never attempts to restore the
    // context — this is the one call in this whole file that has to run
    // synchronously inside the event handler.
    e.preventDefault()
    stop()
    canvas.style.opacity = '0'
  }
  function onContextRestoredEvent() {
    // Every GL object built against the old context is invalid now; patching
    // them back individually isn't worth it when the caller can just mount a
    // fresh instance on the same canvas.
    destroy()
    options.onContextRestored?.()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestoredEvent)

  function destroy() {
    stop()
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('visibilitychange', onVisibility)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    canvas.removeEventListener('webglcontextrestored', onContextRestoredEvent)
    if (resizeTimer) clearTimeout(resizeTimer)
  }

  return {
    setPaused(next: boolean) {
      paused = next
      if (paused) stop()
      else {
        resync()
        scheduleFrame()
      }
    },
    destroy() {
      destroy()
      try {
        const ext = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
        ext?.loseContext()
      } catch {
        // ignore
      }
    },
  }
}
