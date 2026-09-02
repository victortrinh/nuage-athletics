import { cva } from 'class-variance-authority'

/**
 * The two text inputs in the codebase share one underline treatment and
 * differ only in type scale: the email field is body text, the gate
 * password field is set in a wide-tracked monospace to read like a PIN
 * entry. Also imported directly by .astro (GateScreen.astro) — keep this
 * file free of React/RAC imports.
 */
export const inputVariants = cva(
  'w-full border-0 border-b border-ink bg-transparent px-0 py-2 transition-colors focus:outline-none focus-visible:border-accent-ink',
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
