import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Written from scratch, not shadcn's default table (default/destructive/
 * outline/secondary/ghost/link × sm/default/lg/icon) — nothing on this site
 * matches those shapes. There are exactly two button treatments in the
 * codebase: the bordered ink/paper block button (every submit/buy action)
 * and the underlined text-only toggle (the sky pause/resume control).
 *
 * Plain .ts, no React/RAC import — this file is imported directly by
 * .astro files (GateScreen.astro, Base.astro) so their submit/toggle
 * buttons share the exact same class table as the React islands without
 * ever pulling react-aria-components into the Astro server graph.
 */
export const buttonVariants = cva('transition-colors', {
  variants: {
    variant: {
      solid:
        'w-full border border-ink bg-ink px-6 py-3 text-[11px] uppercase tracking-label text-paper hover:bg-paper hover:text-ink disabled:opacity-40',
      quiet: 'text-xs tracking-widest uppercase underline underline-offset-4 opacity-70 hover:opacity-100',
    },
  },
  defaultVariants: {
    variant: 'solid',
  },
})

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
