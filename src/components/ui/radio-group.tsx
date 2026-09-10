import {
  RadioGroup as AriaRadioGroup,
  Radio as AriaRadio,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
} from 'react-aria-components'
import { cn } from './cn'

/**
 * Hand-written against react-aria-components@1.21.0 — see button.tsx for
 * why. Replaces the size-selector chips originally in ProductActions.tsx
 * (now ProductStage.tsx), which put aria-pressed on five mutually-exclusive
 * <button>s — valid ARIA, but the wrong widget for "pick exactly one": no
 * arrow-key roving, no role="radiogroup". This is the one primitive on this
 * branch that RAC genuinely earns its weight for.
 *
 * Note the resulting behaviour change: the old buttons could be deselected
 * by clicking the active one again (`setVariantId(id === v.id ? '' : v.id)`
 * in the pre-migration code). A radio group cannot represent "none selected
 * after one was picked" — selecting a size is now one-way, same as any
 * native <input type="radio"> group.
 */
export interface RadioGroupProps extends AriaRadioGroupProps {}

export function RadioGroup({ className, ...props }: RadioGroupProps) {
  return <AriaRadioGroup className={className} {...props} />
}

export interface RadioProps extends AriaRadioProps {
  /**
   * How much room the control takes, for the two cases on the product page
   * that can't use the default (ProductStage.tsx):
   *
   * - `compact` — smaller type and padding both ways, for a secondary
   *   picker that shouldn't carry the same weight as the primary one on
   *   the same page: the fit tabs against the size row. Its label is
   *   centred in the cell rather than sitting where the text happens to
   *   start: the two tabs are a grid of equal columns with labels of
   *   unequal length ("Classique" against "Crop"), so left-aligned text
   *   reads as two boxes whose contents don't line up with each other.
   * - `tight` — default type and *vertical* padding; it fills its grid
   *   cell instead of padding out to its own text, so seven sizes whose
   *   labels run from "S" to "XXL" are seven identically sized buttons
   *   rather than seven boxes the width of their own text. For a row that
   *   has to fit across a phone: it's the primary control, so shrinking
   *   the text or the 44px-tall tap target to buy the width would be the
   *   wrong trade. It does carry 2px of its own left padding (`pl-0.5`) —
   *   see the branch below.
   *
   * A prop rather than something the caller passes through `className`:
   * `cn()` is clsx only (no tailwind-merge, see cn.ts), so a `px-2` from a
   * caller and the `px-3` below would both land in the class attribute and
   * the winner would be whichever Tailwind happens to emit later — decided
   * by the framework's sort order, not by this file. Branching inside the
   * one `cn()` call keeps exactly one padding utility in play.
   */
  density?: 'compact' | 'tight'
}

export function Radio({ className, density, ...props }: RadioProps) {
  return (
    <AriaRadio
      className={(renderProps) =>
        cn(
          // cursor-pointer stays local: the global rule in global.css
          // covers button/summary, and cannot know that this particular
          // <label> is the control itself.
          'press cursor-pointer uppercase tracking-label',
          // `bg-paper` on every density except `tight`: over the sky, a
          // filled cell is what gives an unselected control an edge to
          // read as a box. That's right for the fit tabs (whose hairline
          // separators are drawn by the gaps between those fills) and
          // wrong for the size row, which is meant to read as bare
          // lettering until one is chosen.
          density !== 'tight' && 'bg-paper',
          density === 'compact' && 'flex items-center justify-center px-2 py-2 text-center text-[10px]',
          // min-h-11 + centring rather than more `py-`: padding alone left
          // this at 40px, and it's the primary control on the page. `w-full`
          // and no `px-` beyond `pl-0.5`: the width comes from the grid cell,
          // which is what makes every size the same size. `pl-0.5` is a 2px
          // nudge, not a `px-0.5` pair — the label is still `justify-center`,
          // so adding it to both sides would cancel out; this shifts the
          // centred lettering 1px right instead of indenting it from a
          // left edge.
          density === 'tight' &&
            'flex min-h-11 w-full items-center justify-center py-3 pl-0.5 text-xs',
          !density && 'px-3 py-3 text-xs',
          'hover:bg-ink hover:text-paper',
          'data-[selected]:bg-ink data-[selected]:text-paper',
          // In forced-colors mode bg-ink/text-paper are both flattened to
          // system colors and selected/unselected become indistinguishable —
          // same failure mode CLAUDE.md documents for checkbox.tsx. Highlight
          // the selected state explicitly rather than relying on the
          // (removed) background contrast.
          'forced-colors:border forced-colors:border-[ButtonBorder]',
          'forced-colors:data-[selected]:bg-[Highlight] forced-colors:data-[selected]:text-[HighlightText]',
          'data-[focus-visible]:focus-block',
          'data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:text-mute data-[disabled]:line-through',
          typeof className === 'function' ? className(renderProps) : className
        )
      }
      {...props}
    />
  )
}
