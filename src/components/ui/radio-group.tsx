import {
  RadioGroup as AriaRadioGroup,
  Radio as AriaRadio,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
} from 'react-aria-components'
import { cn } from './cn'

/**
 * Hand-written against react-aria-components@1.21.0 — see button.tsx for
 * why. Replaces the size-selector chips in ProductActions.tsx, which put
 * aria-pressed on five mutually-exclusive <button>s — valid ARIA, but the
 * wrong widget for "pick exactly one": no arrow-key roving, no
 * role="radiogroup". This is the one primitive on this branch that RAC
 * genuinely earns its weight for.
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

export interface RadioProps extends AriaRadioProps {}

export function Radio({ className, ...props }: RadioProps) {
  return (
    <AriaRadio
      className={(renderProps) =>
        cn(
          'cursor-pointer bg-paper px-3 py-3 text-xs uppercase tracking-label transition-colors',
          'hover:bg-ink hover:text-paper',
          'data-[selected]:bg-ink data-[selected]:text-paper',
          'data-[focus-visible]:focus-block',
          'data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:text-mute data-[disabled]:line-through',
          typeof className === 'function' ? className(renderProps) : className
        )
      }
      {...props}
    />
  )
}
