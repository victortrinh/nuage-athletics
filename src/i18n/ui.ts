import type { Locale } from './config.ts'

/**
 * Every user-facing string lives here. Bill 96 requires the French version to be
 * complete — not a subset — so a missing key is a compliance bug, not a cosmetic
 * one. The Dict type makes an omission a type error.
 *
 * VOICE — the brand is a cloud, so the copy reads as weather. Two clipped
 * fragments, periods, vouvoiement, no exclamation marks: "Turbulences.
 * Réessayez dans un moment." French is written first and English written
 * beside it, not translated from it — a pun that only works in one language
 * stays in that language ("First drop" is already both a release and a
 * raindrop; the French says "éclaircie" instead of forcing it).
 *
 * The metaphor is for ambience only. These stay literal, deliberately, and a
 * future pass should leave them alone:
 *
 *   - Anything that names a control or is read by a screen reader —
 *     emailLabel, productSizeLabel, productFitLabel,
 *     productGalleryLabel, productImagePosition, productImagePrev,
 *     productImageNext, productChooseSize,
 *     skipToContent, switchTo, navMenu, navMenuClose,
 *     navLabel, navFooterLabel, promptClose.
 *     A weather word in an accessible name is a broken accessible name.
 *   - Errors that tell you how to fix the thing — errorEmail, errorConsent,
 *     errorEmailSend. Cute is hostile when someone is stuck. Errors that are
 *     only "wait and retry" (errorGeneric, errorRate) carry the voice
 *     instead. (There used to be a "choose a size" error here too —
 *     productSelectSizeError — but the buy band's disabled-until-picked
 *     button makes it unreachable, so it was removed rather than left to
 *     rot. See ProductStage.tsx.)
 *   - submitting, successTitle, productAdding, productAdded: progress and
 *     success are announced through a live region, where being understood
 *     on the first hearing beats charm.
 *   - Anything legal or transactional — consentLabel, unsubTitle/unsubBody,
 *     mailUnsub, mailSubject/mailHeading/mailCta, orderCancelled*, privacy,
 *     terms, precontract, rights, productOutOfStock, productAddToCart.
 *   - dropAnnounceAvailability most of the rest: it is the only place the site
 *     tells a shopper when they can buy, on a page anyone can now reach. A
 *     stated availability date is a representation, so it says a real date
 *     plainly or it says nothing — and when the date firms up, this is the
 *     one string per locale that changes.
 *   - consentLabel most of all: it is pinned to CONSENT_VERSION in
 *     src/lib/consent.ts and every subscriber row records the version it was
 *     captured under. Rewording it is a version bump plus two live wordings
 *     forever, not a copy edit.
 *   - tagline, dropLine: tagline renders in <title> and og:title, dropLine
 *     only in the meta description — both are read in search results before
 *     anyone reaches the page, so clarity sells there and the wink has no
 *     audience. tagline doubles as the one country-of-manufacture claim this
 *     brand makes in its most visible copy: it must never say or imply
 *     "Made in Canada" or name a manufacturing country at all unless that is
 *     literally true that day. The garment is designed in Quebec and made in
 *     China (see catalogue.ts's `specs`, which does name both, and
 *     ProductView.astro's `countryOfOrigin`) — a "Made in Canada" claim here
 *     is a Competition Bureau matter, not a style choice.
 *   - ogImageAlt: alt text for the link-preview card, read aloud by the
 *     clients that surface it. Same rule as the gallery alt text in
 *     catalogue.ts — describe the photograph, don't perform.
 */
export type Dict = {
  brand: string
  tagline: string
  dropLine: string
  ogImageAlt: string
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
  errorEmailSend: string
  alreadySubscribed: string
  confirmTitle: string
  confirmBody: string
  unsubTitle: string
  unsubBody: string
  privacy: string
  terms: string
  precontract: string
  contact: string
  rights: string
  switchTo: string
  skipToContent: string
  // nav drawer
  navMenu: string
  navMenuClose: string
  navLabel: string
  navFooterLabel: string
  navHome: string
  instagram: string
  // transactional email
  mailSubject: string
  mailHeading: string
  mailBody: string
  mailCta: string
  mailIgnore: string
  mailUnsub: string
  // drop announcement
  dropAnnounceProduct: string
  dropAnnounceAvailability: string
  // product / checkout
  productDetails: string
  productGalleryLabel: string
  productSizeLabel: string
  productOutOfStock: string
  productFitLabel: string
  productImagePosition: string
  productImagePrev: string
  productImageNext: string
  // product buy band (ProductStage.tsx) — sizes are always visible; this is
  // the accessible hint while no size is picked yet, and the add-to-cart
  // button's three states
  productChooseSize: string
  productAddToCart: string
  productAdding: string
  productAdded: string
  // no-JS fit switch — <noscript> links under the carousel (ProductView.astro)
  productViewFit: string
  errorSoldOut: string
  // cart (src/components/CartView.astro, /api/cart.ts)
  cart: string
  cartTitle: string
  cartSummary: string
  cartEmpty: string
  cartEmptyCta: string
  cartCount: string
  // stepper accessible names — no separate remove button; "−" at quantity 1
  // removes the line, so cartRemoveLabel is that button's name at that point
  cartIncrease: string
  cartDecrease: string
  cartRemoveLabel: string
  cartFit: string
  cartSize: string
  cartQty: string
  cartLineTotal: string
  cartSubtotal: string
  cartShipping: string
  cartTaxes: string
  cartTotal: string
  cartDeferred: string
  cartCheckout: string
  errorCartGeneric: string
  orderConfirmedTitle: string
  orderConfirmedBody: string
  orderCancelledTitle: string
  orderCancelledBody: string
  // background sky effect
  skyPause: string
  skyResume: string
  // bottom-anchored signup prompt (SignupPrompt.astro)
  promptLabel: string
  promptClose: string
}

export const UI: Record<Locale, Dict> = {
  'fr-CA': {
    brand: 'Nuage Athletics',
    tagline: 'Vêtements de sport, sans le plastique.',
    dropLine: 'Première sortie. Automne 2026.',
    ogImageAlt:
      'Le chandail à manches longues 01 de Nuage Athletics, coupe classique, à plat sur fond clair.',
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
    errorEmailSend: "L'envoi du courriel a échoué. Réessayez dans un moment.",
    alreadySubscribed: 'Cette adresse est déjà dans nos prévisions.',
    confirmTitle: 'Inscription confirmée',
    confirmBody: 'Merci. On vous écrit à la première éclaircie.',
    unsubTitle: 'Désabonnement effectué',
    unsubBody: 'Vous ne recevrez plus de courriels de notre part.',
    privacy: 'Confidentialité',
    terms: 'Conditions',
    precontract: 'Informations précontractuelles',
    contact: 'Contact',
    rights: 'Tous droits réservés.',
    switchTo: 'English',
    skipToContent: 'Passer au contenu',
    navMenu: 'Menu',
    navMenuClose: 'Fermer le menu',
    navLabel: 'Navigation du site',
    navFooterLabel: 'Liens du pied de page',
    navHome: 'Accueil',
    instagram: 'Instagram',
    mailSubject: 'Confirmez votre inscription',
    mailHeading: 'Confirmez votre inscription',
    mailBody:
      "Confirmez que vous voulez recevoir nos courriels. C'est la dernière étape avant l'éclaircie.",
    mailCta: 'Confirmer mon inscription',
    mailIgnore: "Si cette inscription ne vient pas de vous, ignorez ce courriel.",
    mailUnsub: 'Se désabonner',
    dropAnnounceProduct: 'LE NOUVEAU {product}',
    dropAnnounceAvailability: 'DISPONIBLE AUTOMNE 2026',
    productDetails: 'Détails',
    productGalleryLabel: 'Images du produit',
    productSizeLabel: 'Taille',
    productOutOfStock: 'Épuisé',
    productFitLabel: 'Coupe',
    productImagePosition: 'Image {n} de {total}',
    productImagePrev: 'Image précédente',
    productImageNext: 'Image suivante',
    productChooseSize: 'Choisir une taille',
    productAddToCart: 'Ajouter au panier',
    productAdding: 'Ajout…',
    productAdded: 'Ajouté…',
    productViewFit: 'Voir en {fit}',
    errorSoldOut: 'Cette taille est épuisée.',
    cart: 'Panier',
    cartTitle: 'Votre panier',
    cartSummary: 'Sommaire de la commande',
    cartEmpty: 'Votre panier est vide.',
    cartEmptyCta: 'Voir le produit',
    cartCount: 'Panier ({n})',
    cartIncrease: 'Augmenter la quantité de {label}',
    cartDecrease: 'Diminuer la quantité de {label}',
    cartRemoveLabel: 'Retirer {label} du panier',
    cartFit: 'Coupe',
    cartSize: 'Taille',
    cartQty: 'Qté',
    cartLineTotal: 'Total de la ligne',
    cartSubtotal: 'Sous-total',
    cartShipping: 'Livraison',
    cartTaxes: 'Taxes',
    cartTotal: 'Total',
    cartDeferred: 'Calculé à la caisse',
    cartCheckout: 'Passer à la caisse',
    errorCartGeneric: "Le panier n'a pas pu être mis à jour. Réessayez dans un moment.",
    orderConfirmedTitle: 'Commande confirmée',
    orderConfirmedBody:
      'Merci. Un courriel de confirmation est en route.',
    orderCancelledTitle: 'Commande annulée',
    orderCancelledBody: "Votre commande n'a pas été complétée. Aucun montant n'a été prélevé.",
    skyPause: 'Figer le ciel',
    skyResume: 'Animer le ciel',
    promptLabel: 'Recevez nos actualités',
    promptClose: "Fermer l'infolettre",
  },
  'en-CA': {
    brand: 'Nuage Athletics',
    tagline: 'Athletic wear, without the plastic.',
    dropLine: 'First drop. Fall 2026.',
    ogImageAlt:
      'Nuage Athletics Long Sleeve 01, classic fit, laid flat on a light background.',
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
    errorEmailSend: 'Sending the email failed. Try again in a moment.',
    alreadySubscribed: 'That address is already in the forecast.',
    confirmTitle: 'Signup confirmed',
    confirmBody: "Thanks. We'll write at the first clearing.",
    unsubTitle: 'Unsubscribed',
    unsubBody: 'You will no longer receive emails from us.',
    privacy: 'Privacy',
    terms: 'Terms',
    precontract: 'Pre-contract information',
    contact: 'Contact',
    rights: 'All rights reserved.',
    switchTo: 'Français',
    skipToContent: 'Skip to content',
    navMenu: 'Menu',
    navMenuClose: 'Close menu',
    navLabel: 'Site navigation',
    navFooterLabel: 'Footer links',
    navHome: 'Home',
    instagram: 'Instagram',
    mailSubject: 'Confirm your signup',
    mailHeading: 'Confirm your signup',
    mailBody: "Confirm you want our emails. That's the last step before it clears.",
    mailCta: 'Confirm my signup',
    mailIgnore: "If this signup wasn't you, ignore this email.",
    mailUnsub: 'Unsubscribe',
    dropAnnounceProduct: 'THE NEW {product}',
    dropAnnounceAvailability: 'AVAILABLE FALL 2026',
    productDetails: 'Details',
    productGalleryLabel: 'Product images',
    productSizeLabel: 'Size',
    productOutOfStock: 'Out of stock',
    productFitLabel: 'Fit',
    productImagePosition: 'Image {n} of {total}',
    productImagePrev: 'Previous image',
    productImageNext: 'Next image',
    productChooseSize: 'Choose a size',
    productAddToCart: 'Add to cart',
    productAdding: 'Adding…',
    productAdded: 'Added…',
    productViewFit: 'View in {fit}',
    errorSoldOut: 'That size is sold out.',
    cart: 'Cart',
    cartTitle: 'Your cart',
    cartSummary: 'Order summary',
    cartEmpty: 'Your cart is empty.',
    cartEmptyCta: 'View the product',
    cartCount: 'Cart ({n})',
    cartIncrease: 'Increase quantity of {label}',
    cartDecrease: 'Decrease quantity of {label}',
    cartRemoveLabel: 'Remove {label} from cart',
    cartFit: 'Fit',
    cartSize: 'Size',
    cartQty: 'Qty',
    cartLineTotal: 'Line total',
    cartSubtotal: 'Subtotal',
    cartShipping: 'Shipping',
    cartTaxes: 'Taxes',
    cartTotal: 'Total',
    cartDeferred: 'Calculated at checkout',
    cartCheckout: 'Checkout',
    errorCartGeneric: 'The cart could not be updated. Try again in a moment.',
    orderConfirmedTitle: 'Order confirmed',
    orderConfirmedBody: 'Thanks. A confirmation email is on its way.',
    orderCancelledTitle: 'Order cancelled',
    orderCancelledBody: 'Your order was not completed. You have not been charged.',
    skyPause: 'Pause the sky',
    skyResume: 'Animate the sky',
    promptLabel: 'Get our updates',
    promptClose: 'Close newsletter prompt',
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
