import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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

/**
 * The product image carousel. Zero-JS was the default (see
 * ProductGallery.astro, which this replaces) but paging through photos and
 * reacting to a fit picked in the separate buy-panel island both genuinely
 * need interaction, so this earns its hydration.
 *
 * All 8 photos (both fits × 4 views) are always in the DOM — only opacity
 * and aria-hidden change on navigation, never `display`, so a lazy image
 * stays fetchable and toggling fit never stalls on a fresh network request.
 * See the loading-priority effect below for how the other 7 get warmed up.
 */
export default function ProductCarousel({ d, productId, fits, initialFit }: Props) {
  const [fit, setFit] = useFit(productId, initialFit)
  const [index, setIndex] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [warm, setWarm] = useState(false)
  const paginationRefs = useRef<(HTMLButtonElement | null)[]>([])
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
          <div className="relative w-full" style={{ aspectRatio: frameAspect }}>
            {fits.map((f) =>
              f.gallery.map((image, i) => {
                const isActive = f.id === fit && i === index
                // The one image blocking first paint. Everything else starts
                // lazy and is flipped to eager once `warm` (see effect above).
                const isInitial = f.id === initialFit && i === 0
                return (
                  <img
                    key={`${f.id}-${i}`}
                    src={image.src}
                    width={image.width}
                    height={image.height}
                    alt={image.alt}
                    aria-hidden={isActive ? undefined : true}
                    loading={isInitial || warm ? 'eager' : 'lazy'}
                    fetchPriority={isInitial ? 'high' : 'low'}
                    decoding="async"
                    className={cn(
                      'absolute inset-0 h-full w-full object-contain transition-opacity duration-150 motion-reduce:transition-none',
                      isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
                    )}
                  />
                )
              })
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1">
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
