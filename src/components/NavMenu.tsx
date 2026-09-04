import { DialogTrigger, Button } from 'react-aria-components'
import { ModalOverlay, Modal, Dialog } from './ui/modal'
import { buttonVariants } from './ui/button-variants'
import { cn } from './ui/cn'

interface NavLink {
  label: string
  href: string
  external?: boolean
}

interface Props {
  links: NavLink[]
  openLabel: string
  closeLabel: string
  navLabel: string
}

/**
 * The site's one navigation control, hydrated in the header's left grid
 * cell (Base.astro) — see that file for why this is `client:load` on every
 * route rather than the zero-JS default. react-aria-components earns its
 * weight here more than anywhere else in the codebase: focus trap,
 * Escape-to-close, background scroll lock and focus-return to the trigger
 * all come for free.
 *
 * The trigger icon and the panel's close icon are two states of the same
 * three-stroke motif the sky toggle uses for its wind lines (Base.astro) —
 * unequal-length rounded strokes reading as cloud strata. There is no
 * bars→X morph on the trigger itself: RAC makes the header inert while the
 * dialog is open, so the trigger can't animate once it's unreachable. The
 * close button instead sits at the trigger's own position inside the panel,
 * and that position continuity is what reads as the transformation.
 */
export function NavMenu({ links, openLabel, closeLabel, navLabel }: Props) {
  return (
    <DialogTrigger>
      <Button
        aria-label={openLabel}
        className={cn(
          buttonVariants({ variant: 'quiet' }),
          'group flex size-8 items-center justify-center'
        )}
      >
        <NavIcon variant="bars" />
      </Button>
      <ModalOverlay
        isDismissable
        className={({ isEntering, isExiting }) =>
          cn(
            'fixed inset-0 z-50 bg-ink/15',
            isEntering && 'motion-safe:[animation:veil-in_200ms_ease-out]',
            isExiting && 'motion-safe:[animation:veil-out_150ms_ease-in]'
          )
        }
      >
        <Modal
          className={({ isEntering, isExiting }) =>
            cn(
              'fixed inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col',
              'border-r border-line bg-paper forced-colors:border-[CanvasText]',
              'pt-safe pr-6 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]',
              'pl-[calc(1.5rem+env(safe-area-inset-left,0px))]',
              isEntering && 'motion-safe:[animation:drawer-in_300ms_ease-out]',
              isExiting && 'motion-safe:[animation:drawer-out_200ms_ease-in]'
            )
          }
        >
          <Dialog aria-label={navLabel} className="flex h-full flex-col outline-none">
            {({ close }) => (
              <>
                <Button
                  onPress={close}
                  aria-label={closeLabel}
                  className={cn(
                    buttonVariants({ variant: 'quiet' }),
                    'group flex size-8 items-center justify-center self-start'
                  )}
                >
                  <NavIcon variant="close" />
                </Button>
                <nav aria-label={navLabel} className="mt-10 flex flex-col gap-6 text-lg">
                  {links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      {...(link.external ? { rel: 'noopener' } : {})}
                      onClick={close}
                      className="underline-sweep self-start hover:text-accent-ink"
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}

/**
 * Three unequal-length rounded strokes, drawn at the same viewBox and stroke
 * weight as the sky toggle's wind lines (Base.astro) so the two read as one
 * icon language. `bars` drifts each stroke a different distance on hover,
 * staggered, so the set reads as wind rather than a rigid block; `close`
 * carries no hover drift of its own since it sits inside the panel it just
 * opened. Both stay static under prefers-reduced-motion — only the travel
 * is gated, never the state.
 */
function NavIcon({ variant }: { variant: 'bars' | 'close' }) {
  return (
    <svg
      className="h-4 w-6 overflow-visible"
      viewBox="0 0 26 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {variant === 'bars' ? (
        <>
          <line
            x1="3"
            y1="4"
            x2="23"
            y2="4"
            className="motion-safe:transition-[translate] motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:translate-x-[2px]"
          />
          <line
            x1="3"
            y1="8"
            x2="17"
            y2="8"
            className="motion-safe:transition-[translate] motion-safe:duration-300 motion-safe:delay-75 motion-safe:ease-out motion-safe:group-hover:translate-x-[3px]"
          />
          <line
            x1="3"
            y1="12"
            x2="20"
            y2="12"
            className="motion-safe:transition-[translate] motion-safe:duration-300 motion-safe:delay-150 motion-safe:ease-out motion-safe:group-hover:translate-x-[1px]"
          />
        </>
      ) : (
        <>
          <line x1="6" y1="3" x2="20" y2="13" />
          <line x1="20" y1="3" x2="6" y2="13" />
        </>
      )}
    </svg>
  )
}
