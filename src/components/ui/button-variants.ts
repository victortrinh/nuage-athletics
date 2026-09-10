import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Written from scratch, not shadcn's default table (default/destructive/
 * outline/secondary/ghost/link × sm/default/lg/icon) — nothing on this site
 * matches those shapes. There are exactly two button treatments in the
 * codebase: the bordered ink/paper block button (every submit/buy action)
 * and the underlined text-only toggle (the sky pause/resume control).
 *
 * Plain .ts, no React/RAC import — this file is imported directly by
 * .astro files (Base.astro) so their submit/toggle buttons share the exact
 * same class table as the React islands without ever pulling
 * react-aria-components into the Astro server graph.
 *
 * `press` (global.css) rather than `transition-colors`: it eases the same
 * colour properties and adds the 1px sink under the pointer that every
 * control on the site shares. The two can't be combined — see the note on
 * the utility.
 */
export const buttonVariants = cva('press', {
  variants: {
    variant: {
      solid:
        'w-full border border-ink bg-ink px-6 py-3 text-[11px] uppercase tracking-label text-paper hover:bg-paper hover:text-ink disabled:opacity-40',
      // The icon-only sky pause/resume toggle — accessible name comes from
      // aria-label, not visible text, so hover has to carry the whole
      // "this is a control" signal: it undims, and picks up the same accent
      // the header's other two links use.
      quiet: 'opacity-70 hover:text-accent-ink hover:opacity-100',
      /**
       * The confirm tap and the "information" disclosure inside the
       * product page's band (ProductStage.tsx) — plain uppercase text, no
       * border or fill. A bordered block here would fight the band's own
       * device: every other piece of text in it is a roller branch (see
       * product/Slot.tsx), and a box drawn around one of those branches
       * would read as a different kind of control breaking a rhythm the
       * rest of the row is built from. Kept distinct from `quiet` (which
       * exists for an icon-only toggle and dims by default) — this starts
       * at full opacity, since it doubles as the band's readable label text
       * until the moment it becomes interactive.
       */
      text: 'text-center uppercase tracking-label hover:opacity-70 disabled:opacity-40 disabled:pointer-events-none',
    },
  },
  defaultVariants: {
    variant: 'solid',
  },
})

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
