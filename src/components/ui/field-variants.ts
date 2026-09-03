import { cva } from 'class-variance-authority'

/**
 * The two text inputs in the codebase share one underline treatment and
 * differ only in type scale: the email field is body text, the gate
 * password field is set in a wide-tracked monospace to read like a PIN
 * entry. Also imported directly by .astro (GateScreen.astro) — keep this
 * file free of React/RAC imports.
 *
 * No focus-visible:border-accent-ink and no focus:outline-none: the global
 * :focus-visible rule in global.css is unlayered CSS, which wins over any
 * Tailwind utility layer regardless — so focus:outline-none never actually
 * suppressed anything, and the accent-colored border fired at the same time
 * as the outline box. On an input whose only visible edge is this one
 * bottom line, that doubled signal read as one dense rectangle sitting
 * right on the text rather than two separate cues.
 */
export const inputVariants = cva(
  'w-full border-0 border-b border-ink bg-transparent px-0 py-2 transition-colors',
  {
    variants: {
      variant: {
        default: 'text-base',
        mono: 'font-mono text-lg tracking-[0.25em]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export const labelVariants = cva('block text-[11px] uppercase tracking-label text-mute')

export const fieldErrorVariants = cva('text-sm text-danger')
