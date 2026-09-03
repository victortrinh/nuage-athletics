import { Checkbox as AriaCheckbox, type CheckboxProps as AriaCheckboxProps } from 'react-aria-components'
import { cn } from './cn'

/**
 * Hand-written against react-aria-components@1.21.0 — see button.tsx for
 * why. Replaces the one native `<input type="checkbox">` in the codebase
 * (the CASL consent box, SignupForm.tsx), which correctly rendered for free
 * in Windows High Contrast mode. This custom indicator needs its own
 * forced-colors rule (global.css) to not regress that — verified by the
 * a11y-forced-colors Playwright project.
 */
export interface CheckboxProps extends AriaCheckboxProps {}

export function Checkbox({ className, children, ...props }: CheckboxProps) {
  return (
    <AriaCheckbox
      className={(renderProps) =>
        cn(
          'group flex items-start gap-3 text-sm leading-relaxed',
          typeof className === 'function' ? className(renderProps) : className
        )
      }
      {...props}
    >
      {(renderProps) => (
        <>
          <div
            aria-hidden="true"
            className={cn(
              'mt-1 flex size-4 shrink-0 items-center justify-center border border-ink bg-paper text-paper',
              'group-data-[selected]:bg-ink',
              'group-data-[focus-visible]:focus-block',
              'forced-colors:group-data-[selected]:bg-[Highlight] forced-colors:border-[ButtonBorder]'
            )}
          >
            {renderProps.isSelected && (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
                className="h-3 w-3 forced-colors:text-[HighlightText]"
              >
                <path d="M3 8.5 6.5 12 13 4" />
              </svg>
            )}
          </div>
          {typeof children === 'function' ? children(renderProps) : children}
        </>
      )}
    </AriaCheckbox>
  )
}
