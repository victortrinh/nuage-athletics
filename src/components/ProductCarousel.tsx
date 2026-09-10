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
   * Everything in the caller's column that isn't this frame — whatever it
   * puts after this component (the fit picker and buy band, or just the
   * drop announcement) plus anything it pads above it — hand-measured in
   * rem at the base and `sm:` breakpoints. This component's own chrome
   * (the marker row and the gap above it) is not the caller's to know and
   * is added below. See the frame-sizing comment for what this drives.
   * The two callers (ProductStage.tsx) pass very different values: the
   * full band is a lot more chrome than a one-line announcement, and
   * reusing one constant for both either shrinks the pre-launch photo for
   * no reason or risks the band falling off a short screen post-launch —
   * see e2e/mobile-layout.e2e.ts's sticky header test, which is what
   * caught the first version reusing one value.
   */
  chromeRem: { base: number; sm: number }
}

/**
 * The part of `--chrome-h` this component owns, per breakpoint: the fixed
 * 4rem header plus ProductView.astro's 3rem of article padding, plus the
 * marker row (1.5rem) and the gap above it — `mt-8` at the base width,
 * `mt-4` from `sm:` up, which is where the two numbers differ. Re-measure
 * both if either changes.
 */
const FRAME_CHROME_REM = { base: 10.5, sm: 9.5 }

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
export default function ProductCarousel({ d, fit, fits, initialFit, chromeRem }: Props) {
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
        collapse the pagination markers into one tab stop (contradicting
        the "real buttons" requirement) and needs a whole new ui/tabs.tsx
        primitive. Not a landmark region either — Base.astro's <main> is
        already the page's landmark. No per-slide slide roles: only one of
        the 4 images is ever exposed (the rest are aria-hidden), so a role
        that exists to navigate among visible slides has nothing to do here.

        The group wraps the frame AND the marker row, not just the frame:
        onKeyDown relies on React's bubbling, which follows the DOM tree,
        so a marker button has to be a descendant of this div for an arrow
        key pressed on it to ever reach the handler below. The prev/next
        arrows flank the frame (see below) — still descendants, so that
        still holds for them too.
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
          everything else in the column — the fixed 11.25rem of header,
          article padding, and this frame's own pagination row and fit
          caption, plus `belowFrameRem` (the caller's own fit picker and
          band, or just the drop announcement — see the prop) — measured
          at each breakpoint, and the frame's height is whatever's left of
          100dvh after that, floored (so it never vanishes on a genuinely
          tiny window; scrolling is the fallback past that point, not a
          broken layout). `aspect-[2/1]` turns that height into a width
          automatically — this is a real `<div>`, not an `<img>`, so
          nothing here needs the old two-div spacer/stage split: this one
          box IS the reserved size, and the stage below fills it exactly
          via inset-0.

          `max-w-[min(56rem,calc(100vw-3rem))]`, not `max-w-full`: the fit
          picker and band below live in ProductView.astro's 34rem article
          column, and capping the photo at that same 34rem badly
          undersells the height-fit above it — a 2:1 photo can't get past
          ~17rem tall at a 34rem width no matter how much vertical room a
          tall window actually has, which is exactly the dead space this
          was meant to close. Letting the frame break out wider than the
          column it sits in — same idea the pre-height-fit version of this
          component used to apply to the *stage* alone, extended to the
          whole frame now that stage and frame are one box — means width
          stops binding well before a realistic window's height does, so
          the photo actually uses the room `100dvh - chrome` computes
          instead of stalling at the text column's width. `mx-auto`
          still centers it correctly even wider than its own containing
          block, via negative margins, same mechanism as any breakout.
          `calc(100vw-3rem)` is the real floor on a narrow phone, where
          56rem never binds and the column's own width would have; from
          `md:` up it tightens to `calc(100vw-10rem)`, which is that same
          3rem of page margin plus the two 2.75rem arrows and the 0.75rem
          gaps either side of the frame — they are `hidden` below `md:` and
          take no room there, so the floor only has to make space for them
          at the widths where they actually render. 56rem
          is deliberately less than `main`'s 80rem ceiling (Base.astro) —
          wide enough to fill real vertical headroom, not so wide a single
          garment photo reads as mostly empty background.

          Growing the photo like this is safe specifically because nothing
          below it needs protecting from a tall window: ProductView.astro's
          wrapper (commerce-enabled branch) separately reserves a full
          `100dvh - header` regardless of how tall the photo ends up, so the
          CPA disclosure after it never peeks into the first screenful
          either way — the photo filling more of that reserved space is
          pure upside, not a tradeoff against that guarantee.

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
        {/*
          flex + justify-center, not mx-auto, on the frame below (which is
          the middle of this row's three items, the prev/next arrows being
          the other two): `margin: auto` only centers a box *narrower* than
          its containing block —
          CSS resolves both auto margins to 0 (left-aligning, not
          centering) the moment the box is wider, which is exactly the
          breakout case above. Flexbox's justify-content doesn't have that
          edge case; it centers an overflowing item the same way as a
          normal one, symmetrically past the container's own edges — as
          long as the item doesn't shrink back down to fit first, which a
          flex child does by default; `shrink-0` on the frame below is
          what keeps it at its full computed width instead of being
          compressed to the flex container's own (narrower) box.
        */}
        <div className="flex items-center justify-center gap-3">
          {/*
            The arrows flank the photo rather than sitting in a row under it,
            matching the reference — but *beside* the frame, not pinned inside
            its edges. Inside, they sat over the photo itself: `object-contain`
            only leaves margin when the shot is taller in ratio than the 2:1
            frame, so on a 2:1 flat-lay the chevron landed on the garment and
            was, depending on the photo, invisible. Out here they always have
            paper behind them. That room is bought from the frame's own width
            cap below (`md:max-w-…calc(100vw-10rem)`), so nothing overflows the
            column on the narrowest viewport that renders them.

            Siblings of the stage, not children: pointer events on an arrow
            never reach the stage's drag handlers this way, so a click on one
            can't also be read as the start of a swipe.

            `hidden md:flex` — on a phone the swipe and the markers below
            already cover this, and two more controls crowding a small frame
            buys nothing. Hiding them takes them out of the accessibility tree
            along with the layout, which is the honest outcome: on that
            viewport they genuinely aren't there, and nothing is left
            announcing a control that can't be reached. Arrow keys still page
            the carousel at every width — that handler is on the group, not on
            these buttons.
          */}
          <button
            type="button"
            aria-label={d.productImagePrev}
            onClick={() => goTo(index - 1)}
            className="group press hidden size-11 shrink-0 items-center justify-center text-mute hover:text-ink md:flex"
          >
            <Chevron dir="left" />
          </button>
          <div
            className="relative shrink-0 aspect-[2/1] max-w-[min(56rem,calc(100vw-3rem))] md:max-w-[min(56rem,calc(100vw-10rem))] [--chrome-h:var(--chrome-base)] sm:[--chrome-h:var(--chrome-sm)]"
            style={
              {
                // The caller's own chrome plus this component's own —
                // FRAME_CHROME_REM, above, which is where the header, the
                // article padding and the marker row are accounted for.
                '--chrome-base': `${chromeRem.base + FRAME_CHROME_REM.base}rem`,
                '--chrome-sm': `${chromeRem.sm + FRAME_CHROME_REM.sm}rem`,
                // No numeric ceiling here — the className's max-w is the
                // only cap, and it's deliberately wider than the column
                // (above), so a tall window lets the photo grow toward the
                // room `100dvh - chrome` actually leaves, instead of
                // stalling at the text column's width well short of that.
                width: 'max(10rem, calc((100dvh - var(--chrome-h)) * 2))',
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
                            // the 4 is in the accessibility tree at any moment.
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
          <button
            type="button"
            aria-label={d.productImageNext}
            onClick={() => goTo(index + 1)}
            className="group press hidden size-11 shrink-0 items-center justify-center text-mute hover:text-ink md:flex"
          >
            <Chevron dir="right" />
          </button>
        </div>

        {/*
          Markers, not numbers — the reference's own device, and with two
          photos per fit a numbered row was reading as more machinery than
          the thing deserves. Round, and the one deliberate exception to the
          no-radii rule the rest of the site is built on: these read as dots
          on the reference, a 6px square reads as a speck of grit, and every
          other way of drawing a circle here would be the same exception
          taken quietly instead — the sanctioned form is `rounded-full` with
          a `guard-allow-rounded` marker check-guards.sh honours. `rounded`
          anywhere else still fails the build, and the Chevron's square caps
          below stay square: the exception is these dots, not a change of
          mind about radii.

          The visible mark is 6px and the row is gapless, so the dots sit as
          one cluster rather than a spaced-out row; the button around each is
          16px, close enough to the mark that the tap target doesn't read as
          its own gap between dots. The row also sits further
          below the photo on a phone (`mt-8`) than from `sm:` up (`mt-4`) —
          air the band under it would otherwise trail as slack, see the pad
          note in ProductStage. Both numbers are in FRAME_CHROME_REM above.

          The accessible name is unchanged from the numbered version
          ("Image 1 de 2") — a marker with no name is the usual way this
          pattern gets shipped broken.
        */}
        <div className="mt-8 flex items-center justify-center gap-0 sm:mt-4">
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
              className="press group flex size-4 items-center justify-center"
            >
              {/* `bg-mute`, not `bg-line`, for the inactive marker: the
                  hairline colour is meant for rules against paper and
                  effectively disappears at 6px over the sky's own texture.
                  Mute is 5:1 on paper, so both states clear the 3:1 that
                  non-text UI wants on their own, and they're still plainly
                  different from each other (mid grey against near-black). */}
              <span
                aria-hidden="true"
                className={cn(
                  'block size-1.5 rounded-full', // guard-allow-rounded: the markers are dots, see above
                  i === index
                    ? 'bg-ink forced-colors:bg-[Highlight]'
                    : 'bg-mute group-hover:bg-ink forced-colors:bg-[GrayText]'
                )}
              />
            </button>
          ))}
        </div>
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
