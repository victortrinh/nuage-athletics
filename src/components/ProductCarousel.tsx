import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { FitId, ProductFit } from '../lib/catalogue'
import { fmt, type Dict } from '../i18n/ui'
import { cn } from './ui/cn'

interface Props {
  d: Dict
  fit: FitId
  fits: ProductFit[]
  initialFit: FitId
  /**
   * Everything in the column *below* the frame — pagination row, fit
   * caption, and whatever the caller puts after this component (the fit
   * picker and buy band, or just the drop announcement) — hand-measured in
   * rem at the base and `sm:` breakpoints. See the frame-sizing comment
   * below for what this drives. The two callers (ProductStage.tsx) pass
   * very different values: the full band is a lot more chrome than a
   * one-line announcement, and reusing one constant for both either
   * shrinks the pre-launch photo for no reason or risks the band falling
   * off a short screen post-launch — see e2e/mobile-layout.e2e.ts's sticky
   * header test, which is what caught the first version reusing one value.
   */
  belowFrameRem: { base: number; sm: number }
}

/** Distance (px) a pointer must travel horizontally before the gesture counts
 *  as a swipe rather than the start of a vertical page scroll or a stray
 *  twitch on a tap. */
const DRAG_INTENT_PX = 8

/**
 * The product image carousel — a presentational child of ProductStage
 * (which owns `fit`) rather than an island of its own. It used to hydrate
 * independently and share the selected fit with a separate buy-panel island
 * through `src/lib/fit-store.ts`; both islands merged into one
 * (ProductStage.tsx) once the redesign put price, sizes and the spec list
 * inside the same interactive band as the carousel — see CLAUDE.md and the
 * removed fit-store.ts for the reasoning that no longer applied. Paging
 * through photos and reacting to `fit` still both need real interaction,
 * which is why this remains a genuine React component rather than static
 * markup — it simply hydrates as part of its parent's root now.
 *
 * All 4 photos (both fits × 2 views — front and back; no worn shots, see
 * catalogue.ts) are always in the DOM — only opacity and aria-hidden change
 * on a fit switch, never `display`, so a lazy image stays fetchable and
 * toggling fit never stalls on a fresh network request. See the
 * loading-priority effect below for how the other 3 get warmed up.
 *
 * Within a fit the 2 photos sit on a translated flex track rather than a
 * crossfade stack, because a swipe has to show the next photo following the
 * finger — a fade has nothing to drag. The two fits are still two stacked
 * tracks that crossfade, so the DOM invariant above is unchanged.
 */
export default function ProductCarousel({ d, fit, fits, initialFit, belowFrameRem }: Props) {
  const [index, setIndex] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [warm, setWarm] = useState(false)
  const [dragDx, setDragDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const paginationRefs = useRef<(HTMLButtonElement | null)[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null)
  const mounted = useRef(false)

  const activeFit = fits.find((f) => f.id === fit) ?? fits[0]
  const total = activeFit.gallery.length

  // Defers the other 7 images to idle — the same deferral pattern
  // Sky.astro uses for its WebGL engine. One ~50KB image blocks first
  // paint; the rest arrive once the browser has nothing better to do, so a
  // fit toggle right after load is already warm.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setWarm(true))
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(() => setWarm(true), 200)
    return () => window.clearTimeout(id)
  }, [])

  function announce(nextIndex: number, nextFit: ProductFit) {
    const position = fmt(d.productImagePosition, { n: nextIndex + 1, total: nextFit.gallery.length })
    setAnnouncement(`${nextFit.label} — ${position}`)
  }

  // Announces a fit switched from the fit picker (rendered by the parent,
  // ProductStage) — but not on mount, and not on navigation within one fit,
  // which announces itself in goTo below.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    announce(index, activeFit)
    // Reacts to `fit` only: an in-fit index change already announces via goTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit])

  function goTo(nextIndex: number, focusPagination = false) {
    const wrapped = (nextIndex + total) % total
    setIndex(wrapped)
    announce(wrapped, activeFit)
    if (focusPagination) paginationRefs.current[wrapped]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const fromPagination = target.dataset.pagination === 'true'
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goTo(index - 1, fromPagination)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goTo(index + 1, fromPagination)
    } else if (e.key === 'Home') {
      e.preventDefault()
      goTo(0, fromPagination)
    } else if (e.key === 'End') {
      e.preventDefault()
      goTo(total - 1, fromPagination)
    }
  }

  // The arrows, the pagination and the arrow keys all wrap; a swipe doesn't.
  // Wrapping a *drag* would mean the finger pulling the last photo left and
  // the track then flying back across the other three to land on the first —
  // the gesture and the animation would point opposite ways. Resistance at
  // the two ends says "nothing further this way" in the gesture's own terms
  // instead, which is also what every native photo viewer does.
  function resist(dx: number) {
    const pullingPastStart = index === 0 && dx > 0
    const pullingPastEnd = index === total - 1 && dx < 0
    return pullingPastStart || pullingPastEnd ? dx * 0.3 : dx
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || e.pointerId !== start.id) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!start.active) {
      // Claim the gesture only once it is clearly horizontal. `touch-pan-y`
      // on the stage already hands vertical panning to the browser (which
      // then sends us pointercancel), but a mouse drag gets no such help.
      if (Math.abs(dx) < DRAG_INTENT_PX || Math.abs(dx) <= Math.abs(dy)) return
      start.active = true
      // Capture so a drag that leaves the frame — or ends over the header —
      // still reports its pointerup here rather than stranding the track
      // mid-slide.
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    }
    setDragDx(resist(dx))
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || e.pointerId !== start.id) return
    drag.current = null
    if (!start.active) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    setDragDx(0)
    if (e.type === 'pointercancel') return

    // Threshold on the *undamped* travel, and proportional to the frame so
    // the same flick reads the same on a phone and on a full-column desktop
    // frame.
    const travelled = e.clientX - start.x
    const width = stageRef.current?.clientWidth ?? 0
    if (Math.abs(travelled) < Math.max(40, width * 0.15)) return
    const next = index + (travelled < 0 ? 1 : -1)
    if (next < 0 || next >= total) return
    goTo(next)
  }

  return (
    <div>
      {/*
        role="group" + aria-roledescription, not a tablist: a tablist would
        collapse the numbered pagination into one tab stop (contradicting
        the "real buttons" requirement) and needs a whole new ui/tabs.tsx
        primitive. Not a landmark region either — Base.astro's <main> is
        already the page's landmark. No per-slide slide roles: only one of
        the 4 images is ever exposed (the rest are aria-hidden), so a role
        that exists to navigate among visible slides has nothing to do here.

        The group wraps the frame AND the pagination row, not just the
        frame: onKeyDown relies on React's bubbling, which follows the DOM
        tree, so a pagination button has to be a descendant of this div for
        an arrow key pressed on it to ever reach the handler below.
      */}
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={d.productGalleryLabel}
        onKeyDown={onKeyDown}
      >
        {/*
          The frame is one fixed box, sized by nothing the visitor can
          change — paging or switching fit never moves the pagination row,
          the fit label or the band below. It used to be sized by width
          alone (a spacer reserving a 4:5 shape, capped at 26rem); now that
          the worn shots are gone (catalogue.ts) and every photo is a
          landscape flat-lay (~2:1–2.6:1), that tall a frame was mostly
          empty letterboxing, and — the actual reason this changed — a
          width-only cap does nothing to stop the frame from pushing the
          band below the fold on a short browser window, the one thing
          yeezy.com's own reference is careful never to let happen.

          So the frame is sized by *height* first: `--chrome-h` is
          everything else in the column — the fixed ~7rem of header plus
          article padding, and `belowFrameRem` (the caller's own pagination
          row, fit caption, fit picker and band, or just the drop
          announcement — see the prop) — measured at each breakpoint, and
          the frame's height is whatever's left of 100dvh after that,
          clamped between a floor (so it never vanishes on a genuinely tiny
          window; scrolling is the fallback past that point, not a broken
          layout) and the old 26rem-equivalent ceiling (so a tall window
          doesn't inflate the photo either). `aspect-[2/1]` turns that
          height into a width automatically — this is a real `<div>`, not
          an `<img>`, so nothing here needs the old two-div spacer/stage
          split: this one box IS the reserved size, and the stage below
          fills it exactly via inset-0.

          `--chrome-*` are deliberately hand-measured constants passed down
          as props, not a `ResizeObserver` computing them live — they need
          updating if the band, fit picker or announcement's own height
          ever changes (all already fixed-height or one line by design, so
          that's a rare, deliberate edit, not a moving target this
          component should be watching for). Two CSS custom properties
          rather than one: `sm:[--chrome-h:var(--chrome-sm)]` is a static
          class Tailwind can see at build time; the numbers behind
          `--chrome-base`/`--chrome-sm` are the only part that's dynamic,
          set via `style` below, which Tailwind's class scanner never needs
          to look at.
        */}
        <div
          className="relative mx-auto aspect-[2/1] max-w-full [--chrome-h:var(--chrome-base)] sm:[--chrome-h:var(--chrome-sm)]"
          style={
            {
              // 11.25rem: header (4rem) + this frame's own pagination row
              // and fit caption below it, at every breakpoint — the part
              // of "everything but the frame" that's fixed regardless of
              // which caller renders below `belowFrameRem`.
              '--chrome-base': `${belowFrameRem.base + 11.25}rem`,
              '--chrome-sm': `${belowFrameRem.sm + 11.25}rem`,
              width: 'clamp(10rem, calc((100dvh - var(--chrome-h)) * 2), 26rem)',
            } as CSSProperties
          }
        >
          {/*
            touch-pan-y, not touch-none: a vertical flick that happens to
            start on the photo has to scroll the page — on mobile the
            carousel is most of the first screen, so swallowing vertical
            gestures here would strand the visitor.
          */}
          <div
            ref={stageRef}
            // A swipe that nothing announces is a swipe nobody on a desktop
            // ever finds: the grab cursor is the only affordance the drag
            // has there, and it is driven by the same `dragging` state the
            // track is, not by :active, so it holds for the whole gesture —
            // pointer capture included — and lets go exactly when the
            // gesture does.
            className={cn(
              'absolute inset-0 touch-pan-y select-none overflow-hidden',
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            {fits.map((f) => {
              const isActiveFit = f.id === fit
              return (
                <div
                  key={f.id}
                  className={cn(
                    'absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none',
                    isActiveFit ? 'opacity-100' : 'pointer-events-none opacity-0'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-full w-full',
                      dragging ? 'transition-none' : 'transition-transform duration-300 ease-out motion-reduce:transition-none'
                    )}
                    style={{
                      transform: `translate3d(calc(${index * -100}% + ${isActiveFit ? dragDx : 0}px), 0, 0)`,
                    }}
                  >
                    {f.gallery.map((image, i) => {
                      const isActive = isActiveFit && i === index
                      // The one image blocking first paint. Everything else
                      // starts lazy and is flipped to eager once `warm` (see
                      // effect above).
                      const isInitial = f.id === initialFit && i === 0
                      return (
                        <img
                          key={`${f.id}-${i}`}
                          src={image.src}
                          width={image.width}
                          height={image.height}
                          alt={image.alt}
                          // Driven by the selection, never by what a drag
                          // happens to have slid into view: exactly one of
                          // the 8 is in the accessibility tree at any moment.
                          aria-hidden={isActive ? undefined : true}
                          loading={isInitial || warm ? 'eager' : 'lazy'}
                          fetchPriority={isInitial ? 'high' : 'low'}
                          decoding="async"
                          // Without this a mouse drag on the photo starts a
                          // native image drag and the swipe dies on the
                          // first pixel.
                          draggable={false}
                          className="h-full w-full shrink-0 object-contain"
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1">
          <button
            type="button"
            aria-label={d.productImagePrev}
            onClick={() => goTo(index - 1)}
            className="group press mr-2 flex size-8 items-center justify-center border border-line text-mute hover:border-ink hover:text-ink"
          >
            <Chevron dir="left" />
          </button>

          {activeFit.gallery.map((_, i) => (
            <button
              key={i}
              type="button"
              ref={(el) => {
                paginationRefs.current[i] = el
              }}
              data-pagination="true"
              aria-label={fmt(d.productImagePosition, { n: i + 1, total })}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => goTo(i)}
              className={cn(
                'press size-8 border text-xs tabular-nums',
                i === index
                  ? 'border-ink bg-ink text-paper forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
                  : 'border-line text-mute hover:border-ink hover:text-ink'
              )}
            >
              {i + 1}
            </button>
          ))}

          <button
            type="button"
            aria-label={d.productImageNext}
            onClick={() => goTo(index + 1)}
            className="group press ml-2 flex size-8 items-center justify-center border border-line text-mute hover:border-ink hover:text-ink"
          >
            <Chevron dir="right" />
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] uppercase tracking-label text-mute">{activeFit.label}</p>
      </div>

      {/* Mirrors SignupForm's live region: exists empty from the start, set
          only in response to user action, never on mount. Outside the
          group so its text is never folded into the carousel's accessible
          description. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/**
 * Inline rather than lucide-react — one 20-byte path doesn't justify the
 * dependency CLAUDE.md keeps out. Square caps and mitred joins because this
 * site has no radii; a round-capped chevron is the same regression as a
 * `rounded-*` class, just one check-guards.sh can't grep for.
 *
 * Leans 2px the way it points while its button is hovered — the same
 * distance in the same direction the photo is about to travel. `motion-safe`
 * rather than `motion-reduce:transition-none`: with the transition merely
 * removed the chevron would still jump to the offset, and a reduced-motion
 * preference is about the movement, not about how it is timed.
 */
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={cn(
        'pointer-events-none motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
        dir === 'left'
          ? 'motion-safe:group-hover:-translate-x-[2px]'
          : 'motion-safe:group-hover:translate-x-[2px]'
      )}
    >
      <path d={dir === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
    </svg>
  )
}
