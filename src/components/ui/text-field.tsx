import {
  TextField as AriaTextField,
  Label as AriaLabel,
  Input as AriaInput,
  FieldError as AriaFieldError,
  type TextFieldProps,
  type LabelProps,
  type InputProps,
  type FieldErrorProps,
} from 'react-aria-components'
import { cn } from './cn'
import { inputVariants, labelVariants, fieldErrorVariants } from './field-variants'
import type { VariantProps } from 'class-variance-authority'

/**
 * Hand-written against react-aria-components@1.21.0 — see button.tsx for
 * why. TextField's real payoff over the plain <input> it replaces
 * (SignupForm.tsx's email field) is automatic aria-invalid/aria-describedby
 * wiring between Input and FieldError — that was missing before and is one
 * of this branch's eight accessibility fixes.
 */
export { AriaTextField as TextField }

export function Label({ className, ...props }: LabelProps) {
  return <AriaLabel className={cn(labelVariants(), className)} {...props} />
}

export interface InputComponentProps extends InputProps, VariantProps<typeof inputVariants> {}

export function Input({ className, variant, ...props }: InputComponentProps) {
  return <AriaInput className={cn(inputVariants({ variant }), className)} {...props} />
}

export function FieldError({ className, ...props }: FieldErrorProps) {
  return <AriaFieldError className={cn(fieldErrorVariants(), className)} {...props} />
}

export type { TextFieldProps }
