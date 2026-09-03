import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { cn } from './cn'
import { buttonVariants, type ButtonVariantProps } from './button-variants'

/**
 * Hand-written against react-aria-components@1.21.0, following shadcn's
 * aria-base file layout (ui.shadcn.com is blocked by this environment's
 * egress policy, so the CLI couldn't generate this directly — see the PR
 * description). Do not re-sync with `shadcn add button`; this file's
 * variants are this codebase's own, not shadcn's default table.
 *
 * Deliberately does NOT re-export buttonVariants — .astro files that need
 * the class table import it from ./button-variants directly, so they never
 * pull react-aria-components into the Astro server graph.
 */
export interface ButtonProps extends AriaButtonProps, ButtonVariantProps {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return <AriaButton className={cn(buttonVariants({ variant }), className)} {...props} />
}
