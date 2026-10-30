import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from 'ogl'
import type { OGLRenderingContext } from 'ogl'
import { CLOUD, GLYPH, VERTEX } from './shaders'
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

/** Floor of the desktop frame-time budget — the budget itself floats above
 * this with the display's own refresh cadence (see BUDGET_CEILING_MS).
 * Loosened on coarse pointers below, where the sim already runs at a lower
 * target rate by design. */
const SLOW_FRAME_MS = 22
/**
 * Hard upper bound on the adaptive budget below. A display that refreshes at
 * 30Hz hands us 33ms frames no matter how little work we do, so a fixed 22ms
 * budget reads a perfectly healthy panel as a permanently slow renderer —
 * hence the budget floats up with the observed refresh cadence. This caps how
 * far it may float, so a device that is genuinely rendering at 20fps can't
 * hide behind its own slowness: past 40ms per frame it is always over budget.
 */
const BUDGET_CEILING_MS = 40
/**
 * Most a single frame may charge against the budget below.
 *
 * A GC pause, a video decode starting, dragging the window between displays —
 * all produce one frame of a few hundred milliseconds on hardware that is
 * otherwise comfortably fast. Charging such a frame its full duration let two
 * of them inside a second spend the entire allowance and step the ladder down,
 * which is what retired the sky on machines that were never slow. Sustained
 * slowness doesn't need the headroom: a renderer genuinely stuck at 50ms per
 * frame is only ~27ms over budget each time, well under this cap, so it still
 * accumulates at full rate and still degrades.
 */
const MAX_FRAME_DEBIT_MS = 50
/** Accumulated over-budget time before stepping down a degrade tier. */
const SLOW_MS_TO_DEGRADE = 1000
/** Accumulated over-budget time, still above budget, before skipping straight
 * to giving up rather than walking the remaining tiers. */
const SLOW_MS_HARD_CEILING = 3000

/**
 * The deck's density ramp, light cloud to heavy, one character per step.
 * Index 0 is a space and is never drawn — clear sky is paper. Everything here
 * is a plain text glyph rather than a symbol a platform might swap for an
 * emoji, and each is in every system monospace stack the atlas falls back
 * through.
 */
const GLYPHS = ' ·.:-~=≈+*#'
/** Side of one grid cell, in CSS pixels. */
const CELL_PX = 12

/**
 * The field's palette, as 0..1 RGB for the glyph pass — greys only, the
 * same family as the cloud deck it replaced. An accent-blue glow at a
 * ripple's crest was tried on the preview and swapped for grey. Paper and mute are the global.css tokens; the crest is mute
 * halfway to ink; the glow is the brand grey the logo uses (too light for
 * text, which is exactly why it suits a haze).
 */
const PAPER = rgb(0xfa, 0xfa, 0xfa)
const MUTE = rgb(0x63, 0x69, 0x6e)
const CREST = rgb(0x36, 0x39, 0x3c)
const GLOW = rgb(0x9b, 0xa1, 0xa6)

/** Most ripples alive at once — the shader loops over a fixed array this size. */
const MAX_RIPPLES = 8
/** How fast a ring travels outward, CSS px per second. */
const RIPPLE_SPEED = 320
/** Seconds a ripple takes to fade out entirely. */
const RIPPLE_LIFE = 2.6
/** Thickness of a ring's crest, CSS px. */
const RIPPLE_WIDTH = 46
/**
 * Seconds between the ripples the field starts on its own, so it reads as
 * weather rather than as a surface waiting for a click. The first is held
 * back past this range's floor on purpose: nothing should appear to *start*
 * as the page loads (see the drift note in renderField).
 */
const IDLE_RIPPLE_MIN_S = 3.5
const IDLE_RIPPLE_SPREAD_S = 3.5
const IDLE_RIPPLE_AMP = 0.55

/** Most `data-sky-calm` boxes the shader fades the field behind. */
const MAX_CALM = 4

/**
 * Clicking a control should feel like the control, not like the backdrop
 * behind it, so a press on anything interactive raises no ripple.
 */
const NO_RIPPLE = 'a, button, input, label, select, textarea, summary, [role="button"], [contenteditable]'

function rgb(r: number, g: number, b: number): [number, number, number] {
  return [r / 255, g / 255, b / 255]
}

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
  // Type wants the display's real density to stay crisp — a glyph rendered
  // at 1x and stretched to a 2x screen reads as soft grey fuzz. The field is
  // one cheap pass (a texture read for the cell, two for its glyph), so full
  // resolution costs far less here than the old cloud pass did at 0.55x.
  let dpr = Math.min(window.devicePixelRatio || 1, 2)
  // Touch devices render at a lower target rate by design, so judging them
  // against the desktop frame budget would degrade them while running
  // exactly as tuned.
  let frameHz = coarse ? 30 : 60
  const slowFrameMs = coarse ? 30 : SLOW_FRAME_MS

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
      dpr,
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

  /**
   * Every glyph, drawn white on transparent at the exact device-pixel size
   * of one cell: row 0 crisp, row 1 again with a blur round it (the glow).
   * The shader reads only alpha, so the colour is decided there, from the
   * brand tokens, rather than baked in. Rebuilt whenever dpr changes, since
   * a cell's device size changes with it.
   */
  function buildAtlas(): HTMLCanvasElement {
    const size = Math.max(1, Math.round(CELL_PX * dpr))
    const atlas = document.createElement('canvas')
    atlas.width = size * GLYPHS.length
    atlas.height = size * 2
    const ctx = atlas.getContext('2d')
    if (!ctx) return atlas
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(size * 0.72)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    ctx.fillStyle = '#fff'
    for (let g = 1; g < GLYPHS.length; g++) {
      const x = g * size + size / 2
      ctx.fillText(GLYPHS[g], x, size / 2)
      ctx.shadowColor = '#fff'
      ctx.shadowBlur = size * 0.6
      ctx.fillText(GLYPHS[g], x, size * 1.5)
      ctx.shadowBlur = 0
    }
    return atlas
  }
  const atlasTexture = new Texture(gl, {
    image: buildAtlas(),
    generateMipmaps: false,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    flipY: false,
  })

  let cloudTarget: RenderTarget
  let cols = 1
  let rows = 1

  // One texel per glyph cell: the glyph pass reads each cell's density at
  // its centre, so anything finer would be computed and thrown away.
  function allocateTargets() {
    cols = Math.max(1, Math.ceil(width / CELL_PX))
    rows = Math.max(1, Math.ceil(height / CELL_PX))
    cloudTarget = new RenderTarget(gl, {
      width: cols,
      height: rows,
      depth: false,
      stencil: false,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    })
  }

  let width = 1
  let height = 1

  const cloudProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: CLOUD,
    uniforms: {
      uNoise: { value: noiseTexture },
      uNoiseSharp: { value: noiseSharpTexture },
      uNoiseShape: { value: noiseShapeTexture },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uOffset1: { value: [0, 0] },
      uMacroOffset: { value: [0, 0] },
      // A *threshold* on the placement field, so lower means more cloud.
      // With uCoverageBite below capping how far the mask can cut, this now
      // only decides where the deck runs thick versus thin.
      uCoverage: { value: 0.3 },
      uCoverageSoftness: { value: 0.14 },
      // Caps the mask's cut so thin regions stay hazy rather than going
      // clear — in type, the difference between a scatter of light marks and
      // a hole in the page.
      uCoverageBite: { value: 0.5 },
    },
  })
  const cloudMesh = new Mesh(gl, { geometry, program: cloudProgram })

  // Plain arrays, not Float32Array: ogl resolves `uRipples[0]` by walking
  // into the value with Array.isArray(), which a typed array fails — the
  // uniform is then silently skipped and every ripple reads as zero.
  const ripples: number[] = new Array(MAX_RIPPLES * 4).fill(0)
  const calm: number[] = new Array(MAX_CALM * 4).fill(0)
  const glyphProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: GLYPH,
    uniforms: {
      uCloud: { value: null },
      uAtlas: { value: atlasTexture },
      uViewport: { value: [1, 1] },
      uGrid: { value: [1, 1] },
      uCell: { value: CELL_PX },
      uGlyphCount: { value: GLYPHS.length },
      uTime: { value: 0 },
      uRipples: { value: ripples },
      uRippleSpeed: { value: RIPPLE_SPEED },
      uRippleLife: { value: RIPPLE_LIFE },
      uRippleWidth: { value: RIPPLE_WIDTH },
      uPointer: { value: [-1e4, -1e4] },
      uCalm: { value: calm },
      uCalmCount: { value: 0 },
      uPaper: { value: PAPER },
      uMute: { value: MUTE },
      uCrest: { value: CREST },
      uGlow: { value: GLOW },
    },
  })
  const glyphMesh = new Mesh(gl, { geometry, program: glyphProgram })

  // iOS Safari fires `resize` on every URL-bar collapse/expand: a
  // height-only delta of roughly 60-90px with the width unchanged.
  // Reallocating the cell grid for that is what makes the sky
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
    // OGL's setSize does not only size the drawing buffer — it also pins the
    // element's CSS box to those exact pixels, inline. That is wrong for this
    // canvas twice over. `height` comes from window.innerHeight, the *visual*
    // viewport, which on iOS Safari excludes the URL bar, while the canvas's
    // containing block is Sky.astro's `fixed inset-0` layer, which is the
    // *large* viewport — toolbar included. So the pinned canvas sat 60-90px
    // short of its own layer, and the static sky-fallback underneath showed
    // through as a flat band across the bottom of the page. The pin is also
    // what kept TOOLBAR_RESIZE_SLOP above from doing what it says: a
    // sub-threshold change can only be "absorbed into the existing CSS box"
    // if that box is free to follow the viewport. Clearing the inline size
    // hands sizing back to the element's own h-full/w-full — the buffer stays
    // exactly as allocated here, stretched over whatever the layer measures
    // in every toolbar state.
    canvas.style.width = ''
    canvas.style.height = ''
    allocateTargets()
  }
  resize()

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(resize, 150)
  }
  window.addEventListener('resize', onResize)

  // CSS pixels, y down, matching the glyph pass. Off-screen until the first
  // real sample, so no halo sits in the middle of the page on load.
  let pointerX = -1e4
  let pointerY = -1e4
  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return
    pointerX = e.clientX
    pointerY = e.clientY
  }
  function onPointerLeave() {
    pointerX = -1e4
    pointerY = -1e4
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onPointerLeave)

  let nextRipple = 0
  function addRipple(x: number, y: number, amp: number) {
    const o = nextRipple * 4
    ripples[o] = x
    ripples[o + 1] = y
    // Stamped on the field's own clock, not wall time, so a ring frozen by
    // a pause resumes where it stopped rather than having aged meanwhile.
    ripples[o + 2] = clock
    ripples[o + 3] = amp
    nextRipple = (nextRipple + 1) % MAX_RIPPLES
  }
  function onPointerDown(e: PointerEvent) {
    if (paused || !e.isPrimary || e.button > 0) return
    if (e.target instanceof Element && e.target.closest(NO_RIPPLE)) return
    addRipple(e.clientX, e.clientY, 1)
  }
  window.addEventListener('pointerdown', onPointerDown, { passive: true })

  const calmEls = Array.from(document.querySelectorAll('[data-sky-calm]')).slice(0, MAX_CALM)
  // Read every frame rather than on scroll: the canvas is fixed and the
  // text scrolls under it, and two or three getBoundingClientRect() calls
  // on a page with nothing dirtying layout cost less than keeping a scroll
  // listener honest.
  function readCalm() {
    let n = 0
    for (const el of calmEls) {
      const r = el.getBoundingClientRect()
      if (!r.width || r.bottom < 0 || r.top > height) continue
      const o = n * 4
      calm[o] = r.left + r.width / 2
      calm[o + 1] = r.top + r.height / 2
      calm[o + 2] = r.width / 2 + 40
      calm[o + 3] = r.height / 2 + 32
      n++
    }
    glyphProgram.uniforms.uCalmCount.value = n
  }

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
  let frameAccumulator = 0
  let nextIdleRipple = IDLE_RIPPLE_MIN_S + Math.random() * IDLE_RIPPLE_SPREAD_S
  /**
   * Shortest frame seen since mount — a read of how often the display
   * actually refreshes, since a frame can never come in under one vsync
   * period however cheap it is. Only ever lowered, so it can't drift upward
   * on a device that starts fast and then bogs down; a device that is slow
   * from the first frame keeps a high reading, which is exactly what
   * BUDGET_CEILING_MS is there to stop from excusing it.
   */
  let fastestFrameMs = Number.POSITIVE_INFINITY
  let slowMs = 0
  let degradeTier = 0
  /** A gap this long is a stalled rAF (backgrounded tab, sleeping laptop,
   * blocked main thread), not a slow renderer — feeding it to the degrade
   * ladder below reads as catastrophic slowness and gives the whole sky up
   * on the first frame back. */
  const STALL_MS = 500

  function resync() {
    lastTime = performance.now()
    frameAccumulator = 0
  }

  function degrade(hardCeiling: boolean) {
    degradeTier += 1
    slowMs = 0
    if (hardCeiling || degradeTier > 2) {
      giveUp()
    } else if (degradeTier === 1 && dpr > 1) {
      // Give back resolution before anything else: slightly softer type
      // beats a dropped frame. The grid itself is in CSS px and doesn't move.
      dpr = 1
      renderer.dpr = dpr
      renderer.setSize(width, height)
      canvas.style.width = ''
      canvas.style.height = ''
      atlasTexture.image = buildAtlas()
      atlasTexture.needsUpdate = true
    } else {
      frameHz = Math.max(15, frameHz / 2)
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
      // frames.
      frameAccumulator = 0
      scheduleFrame()
      return
    }

    const dt = Math.min(rawDt, 1 / 15)

    // A leaky bucket over how far each frame runs *past* budget, rather than
    // an average of raw frame times. The distinction is the whole point: an
    // average is dragged upward by one outlier for the dozen-odd frames it
    // takes to decay back, so a single hitch used to charge the ladder its
    // own duration and then keep charging it while healthy frames rebuilt the
    // average. Here a fast frame credits the bucket the moment it lands, and
    // only time genuinely spent over budget ever accumulates.
    const frameMs = rawDt * 1000
    if (frameMs < fastestFrameMs) fastestFrameMs = frameMs
    const budgetMs = Number.isFinite(fastestFrameMs)
      ? Math.min(BUDGET_CEILING_MS, Math.max(slowFrameMs, fastestFrameMs * 1.4))
      : slowFrameMs
    const overBudgetMs = frameMs - budgetMs
    if (overBudgetMs > 0) {
      slowMs += Math.min(overBudgetMs, MAX_FRAME_DEBIT_MS)
      if (slowMs > SLOW_MS_HARD_CEILING) degrade(true)
      else if (slowMs > SLOW_MS_TO_DEGRADE) degrade(false)
    } else {
      slowMs = Math.max(0, slowMs + overBudgetMs)
    }

    // The field only needs redrawing at frameHz; on a faster display the
    // spare vsyncs are skipped rather than spent repainting the same frame.
    frameAccumulator += dt
    const step = 1 / frameHz
    if (frameAccumulator + 1e-4 < step) {
      scheduleFrame()
      return
    }
    clock += frameAccumulator
    frameAccumulator = 0
    if (clock > nextIdleRipple) {
      addRipple(Math.random() * width, Math.random() * height, IDLE_RIPPLE_AMP)
      nextIdleRipple = clock + IDLE_RIPPLE_MIN_S + Math.random() * IDLE_RIPPLE_SPREAD_S
    }
    renderField(clock)
    scheduleFrame()
  }

  function renderField(t: number) {
    cloudProgram.uniforms.uTime.value = t
    cloudProgram.uniforms.uAspect.value = width / height
    // Drift is deliberately constant from the first frame — no fade-in, no
    // ease-in ramp. Anything that changes over the first seconds after mount
    // reads as an animation playing at page load, which is exactly what this
    // background should not do: the clouds should simply already be there,
    // drifting as slowly as they always will. Faster than the old deck's
    // 0.008: a cell is a coarse unit, and at the old speed a glyph changed
    // so rarely the field read as static.
    cloudProgram.uniforms.uOffset1.value = [t * 0.02, t * 0.006]
    // Placement samples at a much lower coordinate scale (~0.1) than the
    // detail layer, so the same drift speed would cross the whole field
    // far faster — keep it slow enough that clouds migrate gradually.
    cloudProgram.uniforms.uMacroOffset.value = [t * 0.0006, t * 0.0002]
    renderer.render({ scene: cloudMesh, target: cloudTarget })

    readCalm()
    const u = glyphProgram.uniforms
    u.uCloud.value = cloudTarget.texture
    u.uViewport.value = [width, height]
    u.uGrid.value = [cols, rows]
    u.uTime.value = t
    u.uPointer.value = [pointerX, pointerY]
    renderer.render({ scene: glyphMesh })
  }

  // Fade the canvas in once the first real frame has painted.
  requestAnimationFrame(() => {
    renderField(clock)
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
    window.removeEventListener('pointerdown', onPointerDown)
    document.documentElement.removeEventListener('pointerleave', onPointerLeave)
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
