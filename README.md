# Chargeurs.ch

Plateforme technique Chargeurs.ch pour la location de batteries externes à Lausanne et en Suisse romande : borne tactile, QR code Stripe, API ChargeNow, moteur tarifaire serveur, administration, monitoring et fondations SEO locales.

## Objectif produit

Parcours cible :

1. le client utilise une borne Chargeurs.ch dans un établissement ou un événement ;
2. le kiosk est verrouillé sur l'identifiant de sa station ;
3. le client scanne le QR code Stripe ;
4. Stripe confirme une caution autorisée ou prépayée selon le moyen de paiement ;
5. le serveur crée l'ordre ChargeNow et demande l'éjection ;
6. ChargeNow confirme la location et le retour ;
7. le serveur recalcule le tarif final ;
8. Stripe capture, rembourse ou demande le complément nécessaire ;
9. les incidents et incohérences sont visibles dans l'administration.

## Règles tarifaires MVP

- caution initiale : 30 CHF ;
- prix horaire : 1,50 CHF ;
- incréments : 30 minutes ;
- plafond journalier : 18 CHF ;
- non-retour : 99 CHF au total ;
- supplément après la caution en cas de non-retour : 69 CHF.

La source de vérité tarifaire est la fonction PostgreSQL `compute_pricing`. Aucun prix transmis par le frontend n'est accepté comme autoritaire.

## Architecture réelle

### Frontend

Le frontend est une application **Vite + React + TypeScript + React Router**.

Routes principales :

- `/` : accueil public ;
- `/powerbank/:citySlug` : pages SEO locales ;
- `/partenaires` et `/support` : acquisition et assistance ;
- `/kiosk/:stationId` et `/kiosk/station/:stationId` : borne tactile ;
- `/pay/:rentalSessionId` : parcours de paiement ;
- `/compte` : espace utilisateur encore limité ;
- `/admin/*` : stations, paiements, locations, ordres, tarifs, partenaires, boutiques, utilisateurs, kiosks, maintenance et API.

### Backend

Le backend utilise Supabase/PostgreSQL et des Edge Functions Deno :

- `create-rental-session` : authentification kiosk, disponibilité et snapshot tarifaire ;
- `create-stripe-checkout` : QR Stripe et caution ;
- `stripe-webhook` : confirmation serveur, inbox idempotente et déclenchement de l'éjection ;
- `eject-after-payment` : création de l'ordre ChargeNow et éjection ;
- `chargenow-rent-callback` : activation et retour de batterie ;
- `settle-rental-payment` : capture, remboursement et supplément final ;
- `rental-admin-action` : retries et réconciliation opérateur ;
- fonctions d'administration et de synchronisation des bornes.

### Paiement

Le règlement dépend du moyen de paiement :

- cartes, Apple Pay et Google Pay éligibles : autorisation puis capture finale ;
- TWINT : prépaiement de la caution puis remboursement du solde ;
- montant supérieur à la caution : tentative de paiement complémentaire hors session ;
- échec du complément : incident et revue manuelle, jamais faux succès.

Voir `docs/PAYMENT_SETTLEMENT.md`.

### Rental Orchestrator

Le dépôt contient :

- une machine à états métier pure ;
- un moteur de réconciliation ;
- des snapshots versionnés ;
- un journal d'événements ;
- une inbox d'événements externes ;
- une fonction PostgreSQL de transition atomique ;
- les premières fondations de règlement transactionnel.

Le branchement complet de tous les anciens flux sur cet orchestrateur reste progressif. Les champs historiques de `rental_sessions.state` sont encore utilisés par plusieurs Edge Functions.

## ChargeNow

Le client serveur `_shared/chargenow.ts` couvre les opérations documentées de l'API fournisseur. Les identifiants et mots de passe restent exclusivement dans l'environnement backend.

Les tests contractuels actuels utilisent un transport HTTP simulé. Une opération n'est pas considérée validée sur le matériel réel sans preuve d'un appel contrôlé sur une borne de test.

## Stations connues dans le périmètre de démonstration

- `DTA21269` ;
- `DTA21277` ;
- `DTA22032`.

Leur présence dans les données de démonstration ne prouve pas à elle seule leur état en ligne actuel.

## Sécurité

- tokens kiosk hashés et liés à une station ;
- montants et tarifs résolus côté serveur ;
- webhooks Stripe signés ;
- callbacks ChargeNow protégés par un secret partagé ;
- RLS sur les tables sensibles ;
- accès transactionnel réservé au `service_role` ;
- rate limiting et idempotence à la création de session ;
- snapshots tarifaires hashés ;
- audit des actions sensibles ;
- aucun secret ne doit être commité.

## Variables principales

Les valeurs ne doivent jamais apparaître dans le dépôt :

- `VITE_SUPABASE_URL` ;
- `VITE_SUPABASE_PUBLISHABLE_KEY` ;
- `SUPABASE_URL` ;
- `SUPABASE_SERVICE_ROLE_KEY` ;
- `STRIPE_SECRET_KEY` ;
- `STRIPE_WEBHOOK_SECRET` ;
- `PUBLIC_APP_URL` ;
- `CHARGENOW_API_BASE_URL` ;
- `CHARGENOW_ALT_BASE_URL` ;
- `CHARGENOW_BASIC_USERNAME` ;
- `CHARGENOW_BASIC_PASSWORD` ;
- `CHARGENOW_BASIC_AUTH` ;
- `CHARGENOW_EVENT_SECRET`.

## Installation

```bash
npm install
npm run dev
```

## Validation locale

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

Les tests de base de données nécessitent un PostgreSQL/Supabase compatible :

```bash
npm run test:db
```

## Déploiement cible

- Vercel ou hébergement web équivalent pour le frontend Vite ;
- Supabase pour PostgreSQL, RLS et Edge Functions ;
- Stripe pour Checkout et les webhooks ;
- ChargeNow pour les stations physiques ;
- wrapper APK Android kiosk pour ouvrir la route de la station en plein écran.

## Prudence de release

La présence d'une migration ou d'une fonction dans GitHub ne signifie pas qu'elle est appliquée sur Supabase. Une version est considérée connectée uniquement après :

1. migration staging appliquée ;
2. secrets configurés hors dépôt ;
3. tests RLS et intégration réussis ;
4. Checkout et webhook Stripe en mode test validés ;
5. retour et éjection contrôlés sur une borne de test ;
6. réconciliation financière et matérielle vérifiée.
