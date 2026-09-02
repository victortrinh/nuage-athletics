import { Renderer, Program, Mesh, Triangle, RenderTarget, Texture } from 'ogl'
import type { OGLRenderingContext } from 'ogl'
import { BLIT, CLOUD, FLUID_STEP, VERTEX } from './shaders'
import { buildNoiseTextures } from './noise'

export interface SkyHandle {
  destroy(): void
  setPaused(paused: boolean): void
}

const GAVE_UP_KEY = 'na-sky-gaveup'
const FLUID_BASE_WIDTH = 320
const SLOW_FRAME_MS = 22
const SLOW_FRAMES_TO_DEGRADE = 90

function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

export function mountSky(canvas: HTMLCanvasElement): SkyHandle {
  if (sessionStorage.getItem(GAVE_UP_KEY) === '1') {
    return { destroy() {}, setPaused() {} }
  }

  const coarse = isCoarsePointer()
  let cloudScale = coarse ? 0.4 : 0.55
  const dprCap = coarse ? 1.0 : 1.5
  let simHz = coarse ? 30 : 60

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
    return { destroy() {}, setPaused() {} }
  }
  const gl = renderer.gl as OGLRenderingContext

  if (!('drawingBufferWidth' in gl)) {
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
  let fluidWidth = FLUID_BASE_WIDTH
  let fluidHeight = FLUID_BASE_WIDTH

  function allocateTargets() {
    const aspect = width / height
    fluidWidth = FLUID_BASE_WIDTH
    fluidHeight = Math.max(90, Math.round(FLUID_BASE_WIDTH / aspect))
    fluidA = makeFluidTarget(fluidWidth, fluidHeight)
    fluidB = makeFluidTarget(fluidWidth, fluidHeight)
    cloudTarget = makeCloudTarget(
      Math.max(1, Math.round(width * cloudScale)),
      Math.max(1, Math.round(height * cloudScale))
    )
    fluidReadIsA = true
  }

  const fluidProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: FLUID_STEP,
    uniforms: {
      uSource: { value: null },
      uDt: { value: 1 / 60 },
      uDissipation: { value: 0.986 },
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
      uFluid: { value: null },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uOffset1: { value: [0, 0] },
      uMacroOffset: { value: [0, 0] },
      uCoverage: { value: 0.4 },
      uCoverageSoftness: { value: 0.12 },
      // Raised from 0.72 — a calmer, softer grey floor. The old value read
      // as glaring/harsh against the near-white sky; there's ample contrast
      // margin against ink text to spare (was 19.3:1/11.35:1, both far past
      // the 4.5:1 AA floor), so this trades some of that margin for comfort.
      uCloudMin: { value: 0.82 },
      uCloudMax: { value: 0.99 },
    },
  })
  const cloudMesh = new Mesh(gl, { geometry, program: cloudProgram })

  const blitProgram = new Program(gl, {
    vertex: VERTEX,
    fragment: BLIT,
    uniforms: { uTex: { value: null } },
  })
  const blitMesh = new Mesh(gl, { geometry, program: blitProgram })

  function resize() {
    const w = Math.round(window.innerWidth)
    const h = Math.round(window.innerHeight)
    if (w === width && h === height) return
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
  let movedSinceLastFrame = false

  function onPointerMove(e: PointerEvent) {
    latestX = e.clientX / window.innerWidth
    latestY = 1 - e.clientY / window.innerHeight
    movedSinceLastFrame = true
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  let paused = false
  let hidden = document.visibilityState === 'hidden'
  function onVisibility() {
    hidden = document.visibilityState === 'hidden'
    if (!hidden && !paused) scheduleFrame()
  }
  document.addEventListener('visibilitychange', onVisibility)

  let rafId: number | null = null
  let lastTime = performance.now()
  let simAccumulator = 0
  let emaFrameMs = 16
  let slowFrameCount = 0
  let degradeTier = 0

  function degrade() {
    degradeTier += 1
    slowFrameCount = 0
    if (degradeTier === 1) {
      cloudScale *= 0.7
      allocateTargets()
    } else if (degradeTier === 2) {
      simHz = Math.max(15, simHz / 2)
    } else {
      giveUp()
    }
  }

  function giveUp() {
    try {
      sessionStorage.setItem(GAVE_UP_KEY, '1')
    } catch {
      // ignore
    }
    canvas.style.opacity = '0'
    stop()
    try {
      const ext = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
      ext?.loseContext()
    } catch {
      // ignore
    }
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
    const dt = Math.min(rawDt, 1 / 15)

    emaFrameMs = emaFrameMs * 0.9 + rawDt * 1000 * 0.1
    if (emaFrameMs > SLOW_FRAME_MS) {
      slowFrameCount += 1
      if (slowFrameCount > SLOW_FRAMES_TO_DEGRADE) degrade()
    } else {
      slowFrameCount = Math.max(0, slowFrameCount - 1)
    }

    simAccumulator += dt
    const simDt = 1 / simHz
    while (simAccumulator >= simDt) {
      simAccumulator -= simDt
      stepFluid(simDt)
      if (simAccumulator > simDt * 4) simAccumulator = 0
    }

    renderCloud(now / 1000)
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
    fluidProgram.uniforms.uPointerPrev.value = [prevFrameX, prevFrameY]
    fluidProgram.uniforms.uPointerCurr.value = [latestX, latestY]
    fluidProgram.uniforms.uPointerActive.value = movedSinceLastFrame ? 1 : 0
    // A precise pointer is good, but the mark still has to be visible enough
    // to read as a contrail cutting through cloud rather than disappear
    // against it — a prior round shrank this specifically for precision,
    // but that now works against "look like a plane going through it."
    fluidProgram.uniforms.uSplatRadius.value = 0.02 + Math.min(speed * 0.008, 0.018)
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
    cloudProgram.uniforms.uOffset1.value = [t * 0.008, t * 0.003]
    // Placement samples at a much lower coordinate scale (~0.1) than the
    // detail layer, so the same drift speed would cross the whole field
    // far faster — keep it slow enough that clouds migrate gradually.
    cloudProgram.uniforms.uMacroOffset.value = [t * 0.00025, t * 0.0001]
    renderer.render({ scene: cloudMesh, target: cloudTarget })

    blitProgram.uniforms.uTex.value = cloudTarget.texture
    renderer.render({ scene: blitMesh })
  }

  // Fade the canvas in once the first real frame has painted.
  requestAnimationFrame(() => {
    renderCloud(performance.now() / 1000)
    canvas.style.opacity = '1'
    lastTime = performance.now()
    scheduleFrame()
  })

  return {
    setPaused(next: boolean) {
      paused = next
      if (paused) stop()
      else {
        lastTime = performance.now()
        scheduleFrame()
      }
    },
    destroy() {
      stop()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibility)
      if (resizeTimer) clearTimeout(resizeTimer)
      try {
        const ext = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
        ext?.loseContext()
      } catch {
        // ignore
      }
    },
  }
}
