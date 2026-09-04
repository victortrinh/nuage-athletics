import {
  ModalOverlay as AriaModalOverlay,
  Modal as AriaModal,
  Dialog as AriaDialog,
  type ModalOverlayProps as AriaModalOverlayProps,
  type DialogProps as AriaDialogProps,
} from 'react-aria-components'
import { cn } from './cn'

/**
 * Hand-written against react-aria-components@1.21.0 — see button.tsx for
 * why. Backs NavMenu.tsx's slide-out drawer. RAC earns its weight here more
 * than anywhere else on the site: focus trap, Escape-to-close, background
 * scroll lock and focus-return to the trigger all come for free, none of
 * which a hand-rolled <dialog> gets without re-deriving them.
 *
 * No variant table — unlike button.tsx there is exactly one caller and one
 * look, so the class strings live on the caller (NavMenu.tsx) rather than
 * behind a props surface nothing else would use.
 */
export interface ModalOverlayProps extends AriaModalOverlayProps {}

export function ModalOverlay({ className, ...props }: ModalOverlayProps) {
  return <AriaModalOverlay className={className} {...props} />
}

// Modal shares ModalOverlayProps with ModalOverlay (react-aria-components
// doesn't give it its own type) — it's the standalone version, used here
// nested inside ModalOverlay so the veil and the panel can animate on
// independent timings.
export interface ModalProps extends AriaModalOverlayProps {}

export function Modal({ className, ...props }: ModalProps) {
  return <AriaModal className={className} {...props} />
}

export interface DialogProps extends AriaDialogProps {}

export function Dialog({ className, ...props }: DialogProps) {
  return <AriaDialog className={cn('outline-none', className)} {...props} />
}
