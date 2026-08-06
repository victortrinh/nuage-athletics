import type { Locale } from './config.ts'

/**
 * Every user-facing string lives here. Bill 96 requires the French version to be
 * complete — not a subset — so a missing key is a compliance bug, not a cosmetic
 * one. The Dict type makes an omission a type error.
 */
export type Dict = {
  brand: string
  tagline: string
  dropLine: string
  emailLabel: string
  emailPlaceholder: string
  consentLabel: string
  submit: string
  submitting: string
  successTitle: string
  successBody: string
  errorGeneric: string
  errorEmail: string
  errorConsent: string
  errorRate: string
  alreadySubscribed: string
  confirmTitle: string
  confirmBody: string
  unsubTitle: string
  unsubBody: string
  privacy: string
  terms: string
  contact: string
  rights: string
  switchTo: string
  // transactional email
  mailSubject: string
  mailHeading: string
  mailBody: string
  mailCta: string
  mailIgnore: string
  mailUnsub: string
}

export const UI: Record<Locale, Dict> = {
  'fr-CA': {
    brand: 'Nuage Athletics',
    tagline: 'Vêtements techniques. Fabriqués au Canada.',
    dropLine: 'Première sortie — automne 2026.',
    emailLabel: 'Courriel',
    emailPlaceholder: 'vous@exemple.com',
    consentLabel:
      "J'accepte de recevoir des courriels de Nuage Athletics au sujet des nouvelles sorties et des nouvelles de la marque. Je peux me désabonner en tout temps.",
    submit: "M'inscrire",
    submitting: 'Un instant…',
    successTitle: 'Vérifiez vos courriels',
    successBody:
      'Nous vous avons envoyé un lien de confirmation. Cliquez dessus pour compléter votre inscription.',
    errorGeneric: 'Une erreur est survenue. Réessayez dans un moment.',
    errorEmail: 'Entrez une adresse courriel valide.',
    errorConsent: 'Vous devez accepter de recevoir nos courriels.',
    errorRate: 'Trop de tentatives. Réessayez dans quelques minutes.',
    alreadySubscribed: 'Cette adresse est déjà inscrite.',
    confirmTitle: 'Inscription confirmée',
    confirmBody: 'Merci. Vous serez parmi les premiers avertis.',
    unsubTitle: 'Désabonnement effectué',
    unsubBody: 'Vous ne recevrez plus de courriels de notre part.',
    privacy: 'Confidentialité',
    terms: 'Conditions',
    contact: 'Contact',
    rights: 'Tous droits réservés.',
    switchTo: 'English',
    mailSubject: 'Confirmez votre inscription — Nuage Athletics',
    mailHeading: 'Confirmez votre inscription',
    mailBody:
      'Cliquez sur le lien ci-dessous pour confirmer que vous souhaitez recevoir nos courriels.',
    mailCta: 'Confirmer mon inscription',
    mailIgnore:
      "Si vous n'avez pas demandé cette inscription, ignorez simplement ce courriel.",
    mailUnsub: 'Se désabonner',
  },
  'en-CA': {
    brand: 'Nuage Athletics',
    tagline: 'Technical apparel. Made in Canada.',
    dropLine: 'First drop — fall 2026.',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    consentLabel:
      'I agree to receive emails from Nuage Athletics about new releases and brand news. I can unsubscribe at any time.',
    submit: 'Sign up',
    submitting: 'One moment…',
    successTitle: 'Check your email',
    successBody:
      'We sent you a confirmation link. Click it to complete your signup.',
    errorGeneric: 'Something went wrong. Try again in a moment.',
    errorEmail: 'Enter a valid email address.',
    errorConsent: 'You need to agree to receive our emails.',
    errorRate: 'Too many attempts. Try again in a few minutes.',
    alreadySubscribed: 'That address is already signed up.',
    confirmTitle: 'Signup confirmed',
    confirmBody: "Thanks. You'll be among the first to know.",
    unsubTitle: 'Unsubscribed',
    unsubBody: 'You will no longer receive emails from us.',
    privacy: 'Privacy',
    terms: 'Terms',
    contact: 'Contact',
    rights: 'All rights reserved.',
    switchTo: 'Français',
    mailSubject: 'Confirm your signup — Nuage Athletics',
    mailHeading: 'Confirm your signup',
    mailBody:
      'Click the link below to confirm you want to receive our emails.',
    mailCta: 'Confirm my signup',
    mailIgnore: "If you didn't request this, you can safely ignore this email.",
    mailUnsub: 'Unsubscribe',
  },
}

export function t(locale: Locale): Dict {
  return UI[locale]
}
