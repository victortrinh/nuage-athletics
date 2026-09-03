import type { Locale } from './config.ts'

/**
 * Every user-facing string lives here. Bill 96 requires the French version to be
 * complete — not a subset — so a missing key is a compliance bug, not a cosmetic
 * one. The Dict type makes an omission a type error.
 *
 * VOICE — the brand is a cloud, so the copy reads as weather. Two clipped
 * fragments, periods, vouvoiement, no exclamation marks: "Ciel couvert. Le mot
 * de passe dégage la vue." French is written first and English written beside
 * it, not translated from it — a pun that only works in one language stays in
 * that language ("First drop" is already both a release and a raindrop; the
 * French says "éclaircie" instead of forcing it).
 *
 * The metaphor is for ambience only. These stay literal, deliberately, and a
 * future pass should leave them alone:
 *
 *   - Anything that names a control or is read by a screen reader —
 *     emailLabel, gatePasswordLabel, productSizeLabel, productFitLabel,
 *     productGalleryLabel, productImagePosition, productImagePrev,
 *     productImageNext, skipToContent, switchTo.
 *     A weather word in an accessible name is a broken accessible name.
 *   - Errors that tell you how to fix the thing — errorEmail, errorConsent,
 *     productSelectSizeError, errorChallenge, errorEmailSend. Cute is hostile
 *     when someone is stuck. Errors that are only "wait and retry"
 *     (errorGeneric, errorRate) carry the voice instead.
 *   - submitting, successTitle: progress and success are announced through a
 *     live region, where being understood on the first hearing beats charm.
 *   - Anything legal or transactional — consentLabel, unsubTitle/unsubBody,
 *     mailUnsub, mailSubject/mailHeading/mailCta, orderCancelled*, privacy,
 *     terms, rights, productOutOfStock, productBuy.
 *   - consentLabel most of all: it is pinned to CONSENT_VERSION in
 *     src/lib/consent.ts and every subscriber row records the version it was
 *     captured under. Rewording it is a version bump plus two live wordings
 *     forever, not a copy edit.
 *   - dropLine: it renders only in the meta description, so it is read in
 *     search results and nowhere else. Clarity sells there; the wink has no
 *     audience.
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
  productImagePrev: string
  productImageNext: string
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
      'Un lien de confirmation vient de partir. Un clic et le ciel se dégage.',
    errorGeneric: 'Turbulences. Réessayez dans un moment.',
    errorEmail: 'Entrez une adresse courriel valide.',
    errorConsent: 'Vous devez accepter de recevoir nos courriels.',
    errorRate: 'Trop de tentatives. Laissez passer quelques minutes.',
    errorChallenge: 'La vérification a échoué. Réessayez.',
    errorEmailSend: "L'envoi du courriel a échoué. Réessayez dans un moment.",
    alreadySubscribed: 'Cette adresse est déjà dans nos prévisions.',
    confirmTitle: 'Inscription confirmée',
    confirmBody: 'Merci. On vous écrit à la première éclaircie.',
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
      "Confirmez que vous voulez recevoir nos courriels. C'est la dernière étape avant l'éclaircie.",
    mailCta: 'Confirmer mon inscription',
    mailIgnore: "Si cette inscription ne vient pas de vous, ignorez ce courriel.",
    mailUnsub: 'Se désabonner',
    gateTitle: 'Ciel couvert',
    gateLede: 'Ciel couvert. Le mot de passe dégage la vue.',
    gatePasswordLabel: 'Mot de passe',
    gateSubmit: 'Entrer',
    gateErrorBad: 'Toujours couvert.',
    gateSignupLede: "Pas de mot de passe? On vous écrit à l'éclaircie.",
    productDetails: 'Détails',
    productGalleryLabel: 'Images du produit',
    productNotifyTitle: "Avis d'éclaircie",
    productNotifyBody:
      'Choisissez votre taille, laissez votre courriel. On vous écrit dès que le ciel se dégage.',
    productComingSoon: "À l'horizon",
    productSizeLabel: 'Taille',
    productOutOfStock: 'Épuisé',
    productBuy: 'Acheter',
    productSelectSizeError: 'Choisissez une taille.',
    productFitLabel: 'Coupe',
    productImagePosition: 'Image {n} de {total}',
    productImagePrev: 'Image précédente',
    productImageNext: 'Image suivante',
    orderConfirmedTitle: 'Commande confirmée',
    orderConfirmedBody:
      'Merci. Un courriel de confirmation est en route.',
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
      'A confirmation link just went out. One click and the sky clears.',
    errorGeneric: 'Turbulence. Try again in a moment.',
    errorEmail: 'Enter a valid email address.',
    errorConsent: 'You need to agree to receive our emails.',
    errorRate: 'Too many attempts. Let a few minutes pass.',
    errorChallenge: 'Verification failed. Try again.',
    errorEmailSend: 'Sending the email failed. Try again in a moment.',
    alreadySubscribed: 'That address is already in the forecast.',
    confirmTitle: 'Signup confirmed',
    confirmBody: "Thanks. We'll write at the first clearing.",
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
    mailBody: "Confirm you want our emails. That's the last step before it clears.",
    mailCta: 'Confirm my signup',
    mailIgnore: "If this signup wasn't you, ignore this email.",
    mailUnsub: 'Unsubscribe',
    gateTitle: 'Overcast',
    gateLede: 'Overcast. The password clears the view.',
    gatePasswordLabel: 'Password',
    gateSubmit: 'Enter',
    gateErrorBad: 'Still overcast.',
    gateSignupLede: "No password? We'll write when it clears.",
    productDetails: 'Details',
    productGalleryLabel: 'Product images',
    productNotifyTitle: 'Clearing advisory',
    productNotifyBody:
      'Pick your size, leave your email. We write the moment the sky clears.',
    productComingSoon: 'On the horizon',
    productSizeLabel: 'Size',
    productOutOfStock: 'Out of stock',
    productBuy: 'Buy now',
    productSelectSizeError: 'Choose a size.',
    productFitLabel: 'Fit',
    productImagePosition: 'Image {n} of {total}',
    productImagePrev: 'Previous image',
    productImageNext: 'Next image',
    orderConfirmedTitle: 'Order confirmed',
    orderConfirmedBody: 'Thanks. A confirmation email is on its way.',
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
