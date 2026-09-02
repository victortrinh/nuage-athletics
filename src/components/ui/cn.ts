import clsx, { type ClassValue } from 'clsx'

/**
 * No tailwind-merge: there are two call sites in this codebase and neither
 * needs conflicting-utility resolution, so it isn't worth the ~7KB gz. If a
 * future `shadcn add` assumes merge behaviour, add tailwind-merge then.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
