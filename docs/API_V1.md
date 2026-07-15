# Chargeurs.ch Platform API v1

## Objectif

La Platform API est l’interface stable détenue par Chargeurs.ch. Les kiosques, applications partenaires, futurs portails mobiles et outils de supervision ne doivent pas dépendre directement du schéma Supabase, des routes Stripe ou de l’API Bajie/ChargeNow.

La version actuelle comporte :

- une façade de lecture ;
- une façade de gestion des locations et du Checkout ;
- une façade de synchronisation non destructive des stations ;
- des clés séparées `test` et `live` ;
- des scopes, quotas, journaux et protections d’idempotence ;
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

Par défaut, une clé API ne lit et ne modifie que les locations créées par son propre `api_client_id`. Les locations kiosk historiques ne deviennent pas visibles automatiquement pour un partenaire.

Les réponses sont nettoyées : aucun PaymentIntent, secret, URL interne fournisseur, payload brut ou token kiosk n’est exposé.

## Rate limiting

Chaque clé possède sa limite par minute. Les réponses incluent :

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

Le compteur est mis à jour atomiquement par `consume_platform_api_quota`.

## Journalisation et confidentialité

Chaque appel authentifié crée une ligne expurgée dans `api_request_logs` :

- identifiant de requête ;
- client et clé API ;
- méthode et route ;
- statut ;
- durée ;
- code d’erreur ;
- hash IP salé facultatif ;
- user agent ;
- métadonnées non sensibles.

Les en-têtes Authorization, clés brutes, secrets Stripe, identifiants ChargeNow, tokens kiosk et payloads bancaires ne doivent jamais être stockés.

Configurer `API_LOG_HASH_SALT` pour activer le hash IP irréversible. Sans cette variable, aucune donnée dérivée de l’adresse IP n’est enregistrée.

## Administration des clients API

La fonction interne `api-key-admin` est réservée au rôle `super_admin`.

Actions :

- `list` ;
- `create_client` ;
- `set_client_active` ;
- `create_key` ;
- `revoke_key`.

Exemple de création d’une clé partenaire test :

```json
{
  "action": "create_key",
  "clientId": "<uuid>",
  "name": "Application partenaire staging",
  "scopes": [
    "health:read",
    "stations:read",
    "inventory:read",
    "pricing:read",
    "rentals:read",
    "rentals:write",
    "payments:write"
  ],
  "rateLimitPerMinute": 120
}
```

La réponse contient `secret` une seule fois.

## Migrations

Appliquer dans cet ordre :

```text
supabase/migrations/20260715033000_rental_orchestrator_storage.sql
supabase/migrations/20260715110000_platform_api_v1.sql
supabase/migrations/20260715123000_platform_api_mutations.sql
```

La dernière migration ajoute notamment :

- l’identité API sur `rental_sessions` ;
- `api_idempotency_records` ;
- la création transactionnelle d’une session API ;
- l’initialisation du Rental Orchestrator ;
- le nettoyage des données d’idempotence expirées.

Les tables API ont RLS activé et aucun accès direct `anon` ou `authenticated`.

## Variables d’environnement

Variables existantes :

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_APP_URL
ALLOWED_APP_ORIGINS
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
CHARGENOW_BASIC_AUTH
# ou CHARGENOW_BASIC_USERNAME + CHARGENOW_BASIC_PASSWORD
CHARGENOW_EVENT_SECRET
API_LOG_HASH_SALT
```

Interrupteurs de mutation, tous désactivés par défaut :

```text
PLATFORM_API_MUTATIONS_ENABLED
PLATFORM_API_LIVE_MUTATIONS_ENABLED
PLATFORM_API_HARDWARE_MUTATIONS_ENABLED
```

Configuration staging recommandée :

```text
PLATFORM_API_MUTATIONS_ENABLED=true
PLATFORM_API_LIVE_MUTATIONS_ENABLED=false
PLATFORM_API_HARDWARE_MUTATIONS_ENABLED=false
```

La Platform API n’expose actuellement aucune route matérielle, même si l’interrupteur matériel existe pour les développements ultérieurs.

## Ordre de déploiement staging

1. Appliquer la migration Rental Orchestrator.
2. Appliquer les deux migrations Platform API.
3. Déployer `platform-api`, `platform-api-rentals`, `platform-api-stations`, `api-key-admin`.
4. Déployer les versions durcies de `create-stripe-checkout` et `sync-cabinet-status`.
5. Configurer `PUBLIC_APP_URL` et les origines autorisées.
6. Activer uniquement `PLATFORM_API_MUTATIONS_ENABLED`.
7. Créer un client `test` et une clé de moindre privilège.
8. Tester lecture, création, replay, conflit, Checkout et annulation.
9. Vérifier les journaux et la propriété des locations.
10. Tester la synchronisation sur une borne réservée.
11. Ne pas activer les mutations LIVE avant validation financière et matérielle.

## Éléments toujours bloqués avant production

- modèle Stripe d’autorisation de 30 CHF et capture finale ;
- complément de non-retour jusqu’à 99 CHF ;
- corrélation exacte batterie-location au retour ;
- worker de compensation ;
- réconciliation périodique ;
- test physique sur une borne puis trois bornes ;
- rotation des anciens credentials ;
- validation de l’APK wrapper.

## Contrats OpenAPI

- lecture : `docs/openapi/chargeurs-api-v1.yaml` ;
- actions : `docs/openapi/chargeurs-api-actions-v1.yaml`.
