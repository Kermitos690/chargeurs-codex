# Architecture Chargeurs.ch

## Vue d'ensemble

Le dépôt contient une plateforme unique : application React publique/kiosque/client/admin, PostgreSQL et Auth Supabase, Edge Functions Deno, intégrations Stripe et ChargeNow, et application Android native dans `android-kiosk/`.

```text
Téléphone client -> Stripe Checkout -> webhook signé -> Supabase
                                                    -> Rental Orchestrator
Kiosque React <-> Edge Functions <-> PostgreSQL     -> ChargeNow -> borne
       ^
       | WebView origine autorisée + pont natif signé
Application Android -> Keystore / watchdog / diagnostic matériel
```

## Sources de vérité

- PostgreSQL : locations, règles tarifaires, paiements, remboursements, bornes, terminaux et audits.
- Snapshot tarifaire immuable + empreinte SHA-256 : prix d'une location déjà créée.
- Webhook Stripe valide : preuve de paiement. La redirection `success_url` n'est jamais une preuve.
- Rental Orchestrator : transitions métier critiques et idempotence.
- Callback/réconciliation ChargeNow : preuve matérielle d'éjection ou de retour.

## Frontières de sécurité

- Le navigateur ne choisit ni prix, ni devise, ni slot, ni état final.
- Un kiosque dispose d'un token individuel haché en base et lié à une station.
- L'enrôlement Android utilise un code temporaire à usage unique.
- Une commande locale d'éjection doit porter un JWS RS256, durer au plus 120 secondes, correspondre au terminal/station/location/slot et ne pas avoir été rejouée.
- En l'absence de protocole matériel contractuel, l'adaptateur natif reste `NOT_CONFIGURED` et refuse l'éjection.

## Modules

- `src/pages` : routes publiques, kiosque, client et back-office.
- `supabase/migrations` : schéma rejouable et politiques RLS.
- `supabase/functions` : paiements, webhooks, orchestration, matériel, API v1 et administration.
- `openapi/` et `docs/openapi/` : contrat API plateforme.
- `android-kiosk/` : projet Android Studio Java/Gradle.
- `.github/workflows` : validations manuelles ou ciblées, sans dépenses live automatiques.

## Modes de paiement

Le défaut produit est `QR_PRIMARY_TERMINAL_FALLBACK`. Stripe Checkout par QR reste prioritaire. Stripe Terminal est une capacité future/optionnelle et ne bloque jamais Checkout. Les cartes éligibles utilisent une autorisation/capture différée ; les méthodes à capture automatique, dont TWINT selon activation Stripe, utilisent encaissement initial puis remboursement partiel.

## Environnements

Local, test, staging et production ont des projets/clefs distincts. Il est interdit de mélanger une clé Stripe test et un secret webhook live. La production reste fermée tant que `PRODUCTION_CHECKLIST.md` n'est pas entièrement validée.
