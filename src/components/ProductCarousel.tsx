import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { FitId, ProductFit } from '../lib/catalogue'
import { useFit } from '../lib/fit-store'
import { fmt, type Dict } from '../i18n/ui'
import { cn } from './ui/cn'

interface Props {
  d: Dict
  productId: string
  fits: ProductFit[]
  initialFit: FitId
}

/** Distance (px) a pointer must travel horizontally before the gesture counts
 *  as a swipe rather than the start of a vertical page scroll or a stray
 *  twitch on a tap. */
const DRAG_INTENT_PX = 8

/**
 * The product image carousel. Zero-JS was the default (see
 * ProductGallery.astro, which this replaces) but paging through photos and
 * reacting to a fit picked in the separate buy-panel island both genuinely
 * need interaction, so this earns its hydration.
 *
 * All 8 photos (both fits × 4 views) are always in the DOM — only opacity
 * and aria-hidden change on a fit switch, never `display`, so a lazy image
 * stays fetchable and toggling fit never stalls on a fresh network request.
 * See the loading-priority effect below for how the other 7 get warmed up.
 *
 * Within a fit the 4 photos sit on a translated flex track rather than a
 * crossfade stack, because a swipe has to show the next photo following the
 * finger — a fade has nothing to drag. The two fits are still two stacked
 * tracks that crossfade, so the DOM invariant above is unchanged.
 */
export default function ProductCarousel({ d, productId, fits, initialFit }: Props) {
  const [fit, setFit] = useFit(productId, initialFit)
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
  const activeImage = activeFit.gallery[index]
  // Front/back are flat-lay shots (~2:1, landscape); front-worn/back-worn are
  // tall (~1:2, portrait). A single fixed aspect box shrinks whichever shape
  // doesn't match it — 4/5 was picked for the worn shots (see the frame's own
  // comment below on why *that* is capped), which let the flat-lay pair
  // shrink to a thin horizontal strip. Following each image's own ratio fixes
  // that; the 4/5 floor only kicks in for the worn shots, preserving the
  // existing cap that keeps them from pushing the pagination row and buy
  // panel below the fold.
  const frameAspect = Math.max(activeImage.width / activeImage.height, 4 / 5)

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

  // Announces a fit switched from the buy panel (ProductActions) — but not
  // on mount, and not on navigation within one fit, which announces itself
  // in goTo below.
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
    // the same flick reads the same on a phone and on a 26rem desktop frame.
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
        the 8 images is ever exposed (the rest are aria-hidden), so a role
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
          Capped at every breakpoint, not just below `lg` — letting the
          frame grow to the full ~624px grid column on desktop made it
          ~780px tall at this 4/5 ratio, pushing the pagination row and the
          whole buy panel below the fold on ordinary laptop viewports.

          This outer box stays fixed at 4/5 — the tallest case, since
          frameAspect is floored at 4/5 — and just centers the actual
          (variable-height) stage inside it. The stage's own height still
          tracks the active image so landscape flat-lay shots aren't
          squeezed into a portrait box, but that no longer resizes this
          wrapper: on mobile, where the carousel is the first thing in the
          document flow, letting the wrapper itself shrink for landscape
          photos moved the pagination row, the fit label, and the buy
          panel up and down the page on every navigation.
        */}
        <div className="relative mx-auto grid aspect-[4/5] w-full max-w-[26rem] place-items-center">
          {/*
            touch-pan-y, not touch-none: a vertical flick that happens to
            start on the photo has to scroll the page — on mobile the
            carousel is most of the first screen, so swallowing vertical
            gestures here would strand the visitor. The aspect transition
            matches the slide duration so the frame reshapes *with* the
            incoming photo (portrait worn shot ⇄ landscape flat-lay)
            instead of snapping under it halfway through.
          */}
          <div
            ref={stageRef}
            className="relative w-full touch-pan-y select-none overflow-hidden transition-[aspect-ratio] duration-300 ease-out motion-reduce:transition-none"
            style={{ aspectRatio: frameAspect }}
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
            className="mr-2 flex size-8 items-center justify-center border border-line text-mute transition-colors hover:border-ink hover:text-ink"
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
                'size-8 border text-xs tabular-nums transition-colors',
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
            className="ml-2 flex size-8 items-center justify-center border border-line text-mute transition-colors hover:border-ink hover:text-ink"
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
      className="pointer-events-none"
    >
      <path d={dir === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
    </svg>
  )
}
