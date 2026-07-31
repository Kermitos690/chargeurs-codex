# Stripe Checkout QR — staging test

Date de configuration : 31 juillet 2026.

## État prouvé

- Compte Stripe `Chargeurs.ch`, environnement **Test** uniquement.
- Destination webhook active :
  `https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/stripe-webhook`.
- Événements abonnés :
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed` et
  `charge.refunded`.
- Un événement `checkout.session.expired` généré par Stripe Test a reçu
  `200 OK` du webhook staging le 31 juillet 2026 à 16:42 CEST.
- Cartes, Apple Pay, Google Pay et TWINT sont activés dans la configuration de
  paiement Stripe Test par défaut. Leur affichage final reste décidé par Stripe
  selon le navigateur, l'appareil, la devise et l'éligibilité du compte.
- Les secrets Stripe sont conservés dans le coffre des Edge Functions Supabase.
  Ils ne sont ni versionnés, ni exposés au frontend, ni embarqués dans l'APK.

## Modèle de paiement implémenté

Le kiosk demande au serveur une session de location. Le serveur valide le
snapshot tarifaire immuable et crée une session Checkout dont l'URL est rendue
sous forme de QR code. Le navigateur de succès n'autorise jamais l'éjection.

- Carte, Apple Pay et Google Pay : tentative d'autorisation/capture manuelle de
  la garantie de 30 CHF, puis capture du montant final lorsqu'elle est encore
  possible.
- TWINT et moyens à capture automatique : paiement initial de 30 CHF, puis
  remboursement du solde inutilisé au règlement final.
- Non-retour : total cible 99 CHF, avec complément éventuel de 69 CHF seulement
  lorsqu'un moyen de paiement et un consentement Stripe valides le permettent.

Le texte client doit parler d'`autorisation` uniquement lorsque Stripe renvoie
réellement `requires_capture`. Pour un moyen prépayé, le montant est encaissé et
le solde est remboursé ; il ne doit pas être présenté comme simplement réservé.

## Garde-fous

Les fonctions financières refusent désormais de démarrer sauf si :

- `STRIPE_MODE=test` ;
- `STRIPE_LIVE_ENABLED=false` ;
- la clé commence par `sk_test_` ou `rk_test_` ;
- le webhook possède un secret `whsec_` valide.

`STRIPE_TERMINAL_ENABLED=false`, `STRIPE_TAP_TO_PAY_ENABLED=false` et
`HARDWARE_EJECTION_ENABLED=false` restent hors du parcours actif.

## Validation encore requise

Le webhook signé et la configuration du compte sont testés. La création d'une
session Checkout par une vraie location staging, le paiement avec une carte de
test Stripe, le rapprochement du PaymentIntent et le remboursement doivent être
exécutés pendant la recette utilisateur. Aucune transaction live ni éjection
matérielle n'a été réalisée.
