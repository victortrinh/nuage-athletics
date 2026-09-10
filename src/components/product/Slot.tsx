import { Children, type ReactNode } from 'react'
import { cn } from '../ui/cn'

interface Props {
  /** Which branch is showing. Every branch keeps its box in the layout —
   *  see the comment below on why nothing here uses `display: none`. */
  index: number
  /** Fixed-height branches, one per state. All render at once, stacked. */
  children: ReactNode[]
  className?: string
}

/**
 * The one mechanic the whole redesign hangs off (see CLAUDE.md's product
 * page note, and the plan this shipped from): a fixed-height, `overflow`-
 * clipped roller. Every branch sits in the DOM the whole time, stacked in a
 * flex column; switching `index` is a single `translateY` on that column,
 * never a layout change, so nothing above or below a Slot ever moves.
 *
 * `overflow-y-clip overflow-x-visible`, not `overflow-hidden` on both axes —
 * `hidden` cannot apply to one axis alone (setting it on `y` forces `x` to
 * `auto`), and the French strings this site writes first are the long ones
 * ("CHOISIR LA TAILLE" against "SELECT SIZE"). Clipping only the axis this
 * component actually needs to clip lets a long label breathe sideways
 * instead of truncating.
 *
 * Inactive branches get `inert`, not `hidden`/`display:none`: `inert` (a)
 * pulls the branch out of the accessibility tree and out of tab order —
 * modern browsers derive `aria-hidden` semantics from it — and (b), unlike
 * `hidden`, does not collapse the branch's box, which is exactly what the
 * translateY math below depends on to keep every branch's height reserved.
 *
 * The height math mirrors ProductCarousel's horizontal track exactly: give
 * the wrapper (caller's `className`, e.g. `h-10`) the one fixed size, give
 * the track `h-full` rather than letting it auto-size to the sum of its
 * branches, and give every branch `h-full shrink-0` too. `translateY`'s
 * percentage resolves against the *transformed element's own* box — the
 * track — so with the track pinned to one branch's height, `-100%` moves by
 * exactly one branch, and the un-clipped branches simply overflow it,
 * exactly as the carousel's off-screen slides overflow its track.
 */
export function Slot({ index, children, className }: Props) {
  const branches = Children.toArray(children)
  return (
    <div className={cn('relative overflow-y-clip overflow-x-visible', className)}>
      <div
        className="flex h-full flex-col motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ transform: `translateY(-${index * 100}%)` }}
      >
        {branches.map((branch, i) => (
          <div
            key={i}
            className="flex h-full w-full shrink-0 items-center justify-center"
            inert={i !== index}
          >
            {branch}
          </div>
        ))}
      </div>
    </div>
  )
}
