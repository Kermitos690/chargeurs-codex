# Chargeurs.ch Platform API v1

## Objectif

La Platform API est l’interface stable détenue par Chargeurs.ch. Les kiosques, applications partenaires, futurs portails mobiles et outils de supervision ne doivent pas dépendre directement du schéma Supabase, des routes Stripe ou de l’API Bajie/ChargeNow.

La version actuelle comporte :

- une façade de lecture ;
- une façade de gestion des locations et du Checkout ;
- une façade de synchronisation non destructive des stations ;
- des clés séparées `test` et `live` ;
- des scopes, quotas, journaux et protections d’idempotence ;
- des webhooks sortants signés avec file de livraison et reprises ;
- des interrupteurs de déploiement qui maintiennent toute mutation désactivée par défaut.

Aucune route publique d’éjection, redémarrage ou maintenance matérielle n’est exposée.

## Points d’entrée

### Lecture et tarification

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/platform-api
```

### Locations et paiement

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/platform-api-rentals
```

### Synchronisation des stations

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/platform-api-stations
```

Toutes les routes sont préfixées par `/v1`. Un futur domaine `api.chargeurs.ch` pourra réunir ces fonctions derrière un gateway sans modifier le contrat métier.

## Authentification

Utiliser l’un des en-têtes suivants :

```http
Authorization: Bearer chg_test_...
```

ou :

```http
X-API-Key: chg_test_...
```

Les clés brutes sont affichées une seule fois lors de leur création. Seul leur hash SHA-256 est conservé. Une clé ne doit jamais être ajoutée dans une URL, un QR code, le bundle frontend, une capture ou un commit.

### Environnements

- `chg_test_...` : intégration test/staging ;
- `chg_live_...` : intégration production.

Une clé test ne peut pas utiliser une clé Stripe LIVE. Une clé LIVE ne peut pas utiliser une clé Stripe test. Les mutations LIVE nécessitent un interrupteur supplémentaire explicite.

## Scopes

| Scope | Accès |
|---|---|
| `health:read` | État de configuration des dépendances |
| `stations:read` | Liste, détail et disponibilité publique |
| `stations:write` | Synchronisation contrôlée de l’état fournisseur |
| `inventory:read` | Slots, batteries et niveaux de charge |
| `pricing:read` | Snapshots tarifaires calculés côté serveur |
| `rentals:read` | Locations appartenant au client API |
| `rentals:write` | Création et annulation de ses locations |
| `payments:write` | Création du Checkout de ses locations |
| `*` | Tous les scopes ; intégrations super-administrateur uniquement |

Le code prend aussi en charge `rentals:read:any` et `rentals:write:any` pour une future supervision multi-clients. Ces scopes ne doivent pas être attribués à un partenaire ordinaire.

## Routes de lecture

Base `platform-api` :

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

## Routes de location et paiement

Base `platform-api-rentals` :

```text
GET  /v1/rentals
POST /v1/rentals
GET  /v1/rentals/:rentalIdOrCode
GET  /v1/rentals/:rentalIdOrCode/events
POST /v1/rentals/:rentalIdOrCode/checkout
POST /v1/rentals/:rentalIdOrCode/cancel
```

### Créer une location

Scope : `rentals:write`.

En-tête obligatoire :

```http
X-Idempotency-Key: partner-order-2026-0001
```

Exemple :

```json
{
  "stationId": "DTA21269",
  "language": "fr",
  "customerEmail": "client@example.ch",
  "externalReference": "partner-order-2026-0001"
}
```

Le serveur :

1. vérifie la station et le stock ;
2. calcule le tarif avec `compute_pricing` ;
3. fige et hash le snapshot ;
4. crée la session avec l’identité du client API ;
5. initialise le snapshot du Rental Orchestrator ;
6. enregistre l’événement externe API.

Le montant fourni par le client n’est jamais accepté.

### Créer le Checkout

Scope : `payments:write`.

```http
POST /v1/rentals/:id/checkout
X-Idempotency-Key: partner-checkout-2026-0001
```

La route réutilise le Checkout actif lorsqu’il existe. La création Stripe utilise aussi une clé d’idempotence liée à la location. Après création, le Rental Orchestrator reçoit `payment_started` et passe à `payment_pending`.

Le flux actuel reste un Stripe Checkout en mode paiement. Le futur modèle d’autorisation manuelle de 30 CHF et capture finale n’est pas déclaré comme opérationnel tant qu’il n’est pas validé en staging.

### Annuler une location

Scope : `rentals:write`.

```http
POST /v1/rentals/:id/cancel
X-Idempotency-Key: partner-cancel-2026-0001
Content-Type: application/json

{"reason":"Client parti avant paiement"}
```

Seules les locations non payées peuvent être annulées. Un Checkout Stripe encore ouvert est expiré avant la transition locale. Une location payée, active, retournée ou terminée est refusée.

## Route de synchronisation

Base `platform-api-stations` :

```text
POST /v1/stations/:stationId/sync
```

Scope : `stations:write`.

Cette route effectue seulement :

- `GET /rent/cabinet/query` chez ChargeNow ;
- mise à jour de la station ;
- reconstruction des slots ;
- mise à jour des batteries présentes ;
- marquage des batteries disparues comme `out_of_station`.

Elle n’éjecte aucune batterie et n’exécute aucune commande matérielle.

## Idempotence

Toute mutation nécessite `X-Idempotency-Key` :

- 8 à 128 caractères ;
- lettres, chiffres, `.`, `_`, `:`, `-` ;
- unique par clé API pendant la durée de rétention.

Le serveur conserve :

- le hash canonique de la requête ;
- le statut de traitement ;
- la réponse sérialisée ;
- la ressource créée ;
- la date d’expiration.

Comportements :

- même clé et même requête terminée : réponse rejouée, avec `Idempotency-Replayed: true` ;
- même clé et contenu différent : `409 IDEMPOTENCY_CONFLICT` ;
- requête identique encore en cours : `409 IDEMPOTENCY_IN_PROGRESS`.

## Propriété et isolation des locations

Les locations créées par la Platform API enregistrent `api_client_id`, `api_key_id`, `external_reference` et `created_via`.

Une clé partenaire ne peut lire ou modifier que les locations de son propre `api_client_id`, sauf scope de supervision explicite. Les anciennes locations kiosk ne sont pas automatiquement attribuées à un partenaire.

## Webhooks sortants

Le sous-système webhook est documenté dans `docs/API_WEBHOOKS_V1.md`.

Fonctions :

- `api-webhook-admin` pour créer, désactiver ou faire tourner un secret ;
- `platform-api-webhook-worker` pour livrer les événements ;
- file transactionnelle, retries et journal d’essais ;
- signature HMAC dérivée d’un master secret backend ;
- aucune conservation du secret brut.

Variables supplémentaires :

```text
PLATFORM_API_WEBHOOK_MASTER_SECRET
PLATFORM_API_WEBHOOK_WORKER_TOKEN
```

Le webhook reste best effort : un problème de livraison ne peut pas annuler une transition de paiement ou de location.

## Administration des clients API

`api-key-admin` est une fonction interne réservée à `super_admin`.

Actions :

- `list` ;
- `create_client` ;
- `set_client_active` ;
- `create_key` ;
- `revoke_key`.

La clé brute est retournée une seule fois. Elle doit être immédiatement placée dans le gestionnaire de secrets du service consommateur.

## Quotas et journaux

Chaque clé possède sa limite par minute. L’API retourne :

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

Chaque appel authentifié écrit un journal expurgé avec l’identifiant de requête, le client, la route, le statut et la durée. Aucun en-tête d’autorisation, token brut, secret Stripe, secret ChargeNow ou token kiosk ne doit être enregistré.

Configurer `API_LOG_HASH_SALT` pour activer le hash irréversible de l’adresse IP. Sans cette variable, aucune donnée dérivée de l’IP n’est stockée.

## Migrations

Ordre prévu :

```text
supabase/migrations/20260715033000_rental_orchestrator_storage.sql
supabase/migrations/20260715110000_platform_api_v1.sql
supabase/migrations/20260715123000_platform_api_mutations.sql
supabase/migrations/20260715133000_platform_api_webhooks.sql
supabase/migrations/20260715133500_platform_api_webhook_resilience.sql
```

Toutes les nouvelles tables activent RLS et révoquent l’accès direct `anon` et `authenticated`.

## Variables backend

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
PUBLIC_APP_URL
CHARGENOW_BASIC_AUTH
CHARGENOW_BASIC_USERNAME
CHARGENOW_BASIC_PASSWORD
CHARGENOW_EVENT_SECRET
API_LOG_HASH_SALT
PLATFORM_API_MUTATIONS_ENABLED
PLATFORM_API_LIVE_MUTATIONS_ENABLED
PLATFORM_API_WEBHOOK_MASTER_SECRET
PLATFORM_API_WEBHOOK_WORKER_TOKEN
```

Aucune valeur ne doit apparaître dans GitHub.

## Validation CI

Les workflows suivants ont été relancés avec succès sur la branche :

- lint ;
- typecheck ;
- tests unitaires ;
- build production ;
- tests Deno des helpers API ;
- `deno check` des fonctions API et webhook ;
- validation des contrats OpenAPI.

La CI valide le dépôt, mais ne prouve pas que les migrations sont appliquées ni que les fonctions sont déployées sur Supabase.

## Déploiement staging

1. confirmer une séparation staging ;
2. appliquer les migrations dans l’ordre ;
3. configurer les variables sans les exposer ;
4. déployer les fonctions API et webhook ;
5. créer un client API test avec le minimum de scopes ;
6. tester lecture, tarification, création, Checkout et annulation ;
7. tester clé révoquée, quota et replay idempotent ;
8. tester une livraison webhook signée ;
9. synchroniser une seule borne sans commande matérielle ;
10. contrôler les journaux et incidents.

## Gates avant les commandes matérielles

Les routes d’éjection, redémarrage ou maintenance restent interdites jusqu’à validation de :

- la migration et l’intégration complète du Rental Orchestrator ;
- l’inbox des événements Stripe et ChargeNow ;
- le worker de compensation ;
- la réconciliation périodique ;
- l’autorisation Stripe de 30 CHF et la capture finale ;
- la corrélation exacte batterie-location ;
- un test physique sur une borne puis sur trois bornes ;
- la rotation des anciens identifiants et tokens.
