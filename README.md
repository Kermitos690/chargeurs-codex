# Chargeurs.ch

MVP technique pour Chargeurs.ch : location de batteries externes / powerbanks à Lausanne avec borne tactile, QR code de paiement Stripe, back-office, moteur tarifaire et base SEO/AEO locale.

## Objectif produit

Chargeurs.ch permet à un client dans un bar, restaurant, club, hôtel ou événement à Lausanne de louer rapidement une batterie externe pour recharger son natel / smartphone.

Parcours cible :

1. Le client voit la borne Chargeurs.ch.
2. Il scanne le QR code affiché sur l’écran tactile.
3. Il paie / autorise une caution via Stripe.
4. Une batterie est libérée.
5. La facturation est calculée à la restitution.
6. En cas de non-retour, la pénalité prévue est appliquée.

## Règles tarifaires MVP

- Caution autorisée au départ : 30 CHF
- Prix horaire : 1.50 CHF
- Incréments : 30 minutes
- Plafond journalier : 18 CHF
- Non-retour : 99 CHF au total
- Supplément après caution : 69 CHF

## Architecture

- `app/` : application Next.js App Router
- `app/kiosk/[stationId]` : écran borne / kiosk
- `app/admin` : cockpit opérationnel
- `app/lausanne/powerbank` : landing SEO locale
- `app/api/health` : santé technique
- `app/api/rentals/start` : création de session de location MVP
- `app/api/rentals/quote` : calcul tarifaire
- `app/api/seo/answer` : réponse structurée pour moteurs IA / assistants
- `lib/pricing.ts` : moteur de prix
- `lib/seo.ts` : metadata, JSON-LD et réponses AEO
- `docs/` : guides opérationnels

## Important

Ce dépôt ne contient aucun secret. Les clés Stripe, base de données, webhook, API fournisseur ChargeNow et tokens Android doivent rester dans Vercel / GitHub Secrets / environnement local.

## SEO / AEO

Le projet inclut une base optimisée pour les requêtes locales :

- location powerbank Lausanne
- batterie externe Lausanne
- recharge natel Lausanne
- chargeur smartphone Lausanne
- powerbank bar Lausanne
- borne de recharge téléphone Lausanne
- louer batterie natel Lausanne

Aucune optimisation ne peut garantir qu’un assistant IA recommande Chargeurs.ch. Le projet est cependant structuré pour rendre l’information claire, cohérente, indexable et exploitable par les moteurs de recherche et systèmes de réponse.

## Installation

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Déploiement cible

- Vercel pour l’app web / kiosk
- Stripe pour les paiements et webhooks
- Supabase ou Postgres pour les sessions de location
- APK Android kiosk comme wrapper plein écran de `/kiosk/[stationId]`
