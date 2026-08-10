# Configuration Stripe

## Comptes et environnements

Utiliser les clés test sur local/staging et les clés live uniquement en production. Renseigner la clé secrète et le secret webhook dans Supabase, jamais dans Vite ou Android. Activer carte, Apple Pay, Google Pay et TWINT dans le Dashboard selon l'éligibilité du compte suisse.

## Webhook

Créer un endpoint vers `.../functions/v1/stripe-webhook`. Écouter au minimum les événements Checkout/PaymentIntent/refund gérés dans la fonction. Copier le secret de signature dans l'environnement correspondant. Un secret test ne valide pas un événement live.

## Checkout QR

Le backend crée une session unique pour la garantie serveur de 30 CHF. Le QR contient uniquement l'URL Stripe hébergée. Les URLs succès/annulation reviennent sur l'application mais ne déclenchent jamais l'éjection.

## Vérification test

Avec Stripe CLI, transmettre les événements au webhook staging, exécuter Checkout réussi/refusé/expiré/asynchrone, rejouer le même événement, altérer montant/devise/snapshot et vérifier le refus. Tester remboursement total après échec d'éjection et remboursement partiel au retour.

## Live

Avant activation : identité et compte bancaire Stripe validés, moyens de paiement activés, domaine Apple Pay enregistré si requis, webhook live sain, alertes et rapprochement opérationnels. Aucun test automatisé ne doit créer un paiement live.

Voir `STRIPE_PAYMENT_MODEL.md` et `docs/PAYMENT_SETTLEMENT.md`.
