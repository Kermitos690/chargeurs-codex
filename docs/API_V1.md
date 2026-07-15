# Chargeurs.ch Platform API v1

## Objectif

La Platform API est l’interface stable détenue par Chargeurs.ch. Les kiosques, applications partenaires, futurs portails mobiles et outils de supervision ne doivent pas dépendre directement du schéma Supabase, des routes Stripe ou de l’API Bajie/ChargeNow.

La version actuelle comprend trois façades :

```text
platform-api
platform-api-rentals
platform-api-stations
```

Elle fournit des clés test/live hachées, des scopes, quotas, journaux, protections d’idempotence, webhooks partenaires, règles financières et un pipeline de règlement asynchrone. Aucune route publique d’éjection, de redémarrage ou de maintenance matérielle n’est exposée.

## Authentification

```http
Authorization: Bearer chg_test_...
```

ou :

```http
X-API-Key: chg_test_...
```

Les clés brutes sont affichées une seule fois. Seul leur hash est stocké.

## Scopes

```text
health:read
stations:read
stations:write
inventory:read
pricing:read
rentals:read
rentals:write
payments:write
```

Les scopes `rentals:read:any`, `rentals:write:any` et `*` sont réservés aux intégrations d’administration.

## Routes principales

### Lecture

```text
GET  /v1/health
GET  /v1/health/details
GET  /v1/me
GET  /v1/stations
GET  /v1/stations/:stationId
GET  /v1/stations/:stationId/availability
GET  /v1/stations/:stationId/inventory
POST /v1/pricing/quote
GET  /v1/rentals/:rentalIdOrCode
GET  /v1/rentals/:rentalId/events
```

### Locations

```text
GET  /v1/rentals
POST /v1/rentals
GET  /v1/rentals/:rentalIdOrCode
GET  /v1/rentals/:rentalIdOrCode/events
POST /v1/rentals/:rentalIdOrCode/checkout
POST /v1/rentals/:rentalIdOrCode/cancel
```

### Stations

```text
POST /v1/stations/:stationId/sync
```

La synchronisation met à jour l’inventaire sans éjecter ni redémarrer une borne.

## Idempotence et isolation

Toute mutation exige `X-Idempotency-Key`. Une même clé et une même requête rejouent la réponse initiale. Un contenu différent provoque un conflit. Chaque location partenaire conserve son client API et reste invisible aux autres partenaires.

Le montant d’une location est toujours calculé avec `compute_pricing`. Aucun montant fourni par le client n’est accepté comme autorité.

## Documentation spécialisée

```text
docs/API_WEBHOOKS_V1.md
docs/PAYMENT_AUTHORIZATION_FLOW.md
docs/RETURN_SETTLEMENT_PIPELINE.md
docs/STAGING_DEPLOYMENT.md
docs/openapi/chargeurs-api-v1.yaml
docs/openapi/chargeurs-api-actions-v1.yaml
```

## Déploiement staging

Le workflow :

```text
.github/workflows/deploy-supabase-staging.yml
```

est manuel, utilise l’environnement GitHub `staging`, exécute un dry-run des migrations et maintient toutes les mutations critiques désactivées au premier déploiement.

## État réel

Le code, les migrations, la CI et le workflow staging sont présents dans la PR #7. Ils ne sont pas déclarés opérationnels tant qu’un projet Supabase staging distinct n’est pas configuré, que les migrations et fonctions ne sont pas déployées, et que les parcours Stripe test et matériel ne sont pas validés.
