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
  errorChallenge: string
  errorEmailSend: string
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
  skipToContent: string
  // transactional email
  mailSubject: string
  mailHeading: string
  mailBody: string
  mailCta: string
  mailIgnore: string
  mailUnsub: string
  // password gate
  gateTitle: string
  gateLede: string
  gatePasswordLabel: string
  gateSubmit: string
  gateErrorBad: string
  gateSignupLede: string
  // product / checkout
  productDetails: string
  productGalleryLabel: string
  productNotifyTitle: string
  productNotifyBody: string
  productComingSoon: string
  productSizeLabel: string
  productOutOfStock: string
  productBuy: string
  productSelectSizeError: string
  productFitLabel: string
  productImagePosition: string
  orderConfirmedTitle: string
  orderConfirmedBody: string
  orderCancelledTitle: string
  orderCancelledBody: string
  // background sky effect
  skyPause: string
  skyResume: string
}

export const UI: Record<Locale, Dict> = {
  'fr-CA': {
    brand: 'Nuage Athletics',
    tagline: 'Vêtements techniques. Fabriqués au Canada.',
    dropLine: 'Première sortie. Automne 2026.',
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
    errorChallenge: 'La vérification a échoué. Réessayez.',
    errorEmailSend: "L'envoi du courriel a échoué. Réessayez dans un moment.",
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
    skipToContent: 'Passer au contenu',
    mailSubject: 'Confirmez votre inscription',
    mailHeading: 'Confirmez votre inscription',
    mailBody:
      "Confirmez que vous voulez recevoir nos courriels. C'est la seule étape qu'il reste.",
    mailCta: 'Confirmer mon inscription',
    mailIgnore: "Si cette inscription ne vient pas de vous, ignorez ce courriel.",
    mailUnsub: 'Se désabonner',
    gateTitle: 'Accès restreint',
    gateLede: 'Ce site n’est pas encore ouvert. Entrez le mot de passe pour continuer.',
    gatePasswordLabel: 'Mot de passe',
    gateSubmit: 'Entrer',
    gateErrorBad: 'Mot de passe incorrect.',
    gateSignupLede: 'Pas de mot de passe? Soyez averti du lancement.',
    productDetails: 'Détails',
    productGalleryLabel: 'Images du produit',
    productNotifyTitle: 'Soyez averti',
    productNotifyBody:
      'Choisissez votre taille et laissez-nous votre courriel. Nous vous écrirons dès que la vente ouvre.',
    productComingSoon: 'Bientôt',
    productSizeLabel: 'Taille',
    productOutOfStock: 'Épuisé',
    productBuy: 'Acheter',
    productSelectSizeError: 'Choisissez une taille.',
    productFitLabel: 'Coupe',
    productImagePosition: 'Image {n} de {total}',
    orderConfirmedTitle: 'Commande confirmée',
    orderConfirmedBody:
      'Merci pour votre commande. Un courriel de confirmation vous a été envoyé.',
    orderCancelledTitle: 'Commande annulée',
    orderCancelledBody: "Votre commande n'a pas été complétée. Aucun montant n'a été prélevé.",
    skyPause: 'Figer le ciel',
    skyResume: 'Animer le ciel',
  },
  'en-CA': {
    brand: 'Nuage Athletics',
    tagline: 'Technical apparel. Made in Canada.',
    dropLine: 'First drop. Fall 2026.',
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
    errorChallenge: 'Verification failed. Try again.',
    errorEmailSend: 'Sending the email failed. Try again in a moment.',
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
    skipToContent: 'Skip to content',
    mailSubject: 'Confirm your signup',
    mailHeading: 'Confirm your signup',
    mailBody: "Confirm that you want our emails. It's the only step left.",
    mailCta: 'Confirm my signup',
    mailIgnore: "If this signup wasn't you, ignore this email.",
    mailUnsub: 'Unsubscribe',
    gateTitle: 'Restricted access',
    gateLede: 'This site is not open yet. Enter the password to continue.',
    gatePasswordLabel: 'Password',
    gateSubmit: 'Enter',
    gateErrorBad: 'Incorrect password.',
    gateSignupLede: 'No password? Get notified at launch.',
    productDetails: 'Details',
    productGalleryLabel: 'Product images',
    productNotifyTitle: 'Get notified',
    productNotifyBody:
      'Pick your size and leave us your email. We will write the moment it goes on sale.',
    productComingSoon: 'Soon',
    productSizeLabel: 'Size',
    productOutOfStock: 'Out of stock',
    productBuy: 'Buy now',
    productSelectSizeError: 'Choose a size.',
    productFitLabel: 'Fit',
    productImagePosition: 'Image {n} of {total}',
    orderConfirmedTitle: 'Order confirmed',
    orderConfirmedBody: 'Thanks for your order. A confirmation email is on its way.',
    orderCancelledTitle: 'Order cancelled',
    orderCancelledBody: 'Your order was not completed. You have not been charged.',
    skyPause: 'Pause the sky',
    skyResume: 'Animate the sky',
  },
}

export function t(locale: Locale): Dict {
  return UI[locale]
}

/**
 * Minimal `{token}` interpolation for the handful of Dict strings that need
 * a value (e.g. "Image {n} de {total}"). French word order differs from
 * English, so a positional or concatenated string wouldn't be translatable —
 * this keeps the whole sentence in ui.ts, editable as one piece.
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  )
}
