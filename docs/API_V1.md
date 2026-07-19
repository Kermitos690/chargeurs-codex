# Chargeurs.ch Platform API v1

## Statut

Cette API est en développement dans la branche `agent/platform-api-readonly-v1` et la PR #34.

Elle est actuellement **lecture seule**. Elle ne permet pas de créer une location, déclencher un paiement, éjecter une batterie, enregistrer un retour ou agir sur le matériel.

## URL de base

```text
https://<PROJECT_REF>.supabase.co/functions/v1/platform-api
```

Le déploiement staging n’est pas encore effectué. Remplacez `<PROJECT_REF>` uniquement après création du projet Supabase de staging.

## Authentification

Deux formes sont acceptées :

```http
Authorization: Bearer chg_test_xxxxxxxxxxxxxxxxxxxxxxxx
```

ou :

```http
X-API-Key: chg_test_xxxxxxxxxxxxxxxxxxxxxxxx
```

Formats prévus :

```text
chg_test_...  environnement de test
chg_live_...  environnement réel
```

La clé complète est affichée une seule fois lors de sa création. Seule son empreinte SHA-256 est stockée côté serveur.

## Scopes

- `health:read`
- `stations:read`
- `inventory:read`
- `pricing:read`
- `rentals:read`

## Routes disponibles

### Santé publique

```http
GET /v1/health
```

Ne nécessite pas de clé API.

### Santé détaillée

```http
GET /v1/health/details
```

Scope : `health:read`

Retourne uniquement des indicateurs généraux de disponibilité. Aucun secret n’est exposé.

### Client courant

```http
GET /v1/me
```

Retourne l’environnement, les scopes et les quotas du client authentifié.

### Stations

```http
GET /v1/stations
GET /v1/stations/{stationId}
GET /v1/stations/{stationId}/availability
GET /v1/stations/{stationId}/inventory
```

Scopes :

- `stations:read` pour la liste et le détail ;
- `inventory:read` pour disponibilité et inventaire.

Exemple :

```http
GET /v1/stations/DTA21269
Authorization: Bearer chg_test_xxxxxxxxxxxxxxxxxxxxxxxx
```

### Devis tarifaire

```http
POST /v1/pricing/quote
Content-Type: application/json
```

Scope : `pricing:read`

Exemple :

```json
{
  "station_id": "DTA21269"
}
```

Le montant est calculé exclusivement par la fonction serveur canonique `compute_pricing`. Un montant envoyé par le client est ignoré.

### Locations en lecture seule

```http
GET /v1/rentals/{rentalId}
GET /v1/rentals/{rentalId}/events
```

Scope : `rentals:read`

Ces routes ne doivent exposer que les locations appartenant au client API authentifié. Cette isolation doit être validée en staging avant toute mise en production.

## Réponses et identifiant de requête

Chaque réponse comprend un en-tête :

```http
X-Request-Id: <uuid>
```

Les réponses d’erreur utilisent un objet structuré :

```json
{
  "error": {
    "code": "not_found",
    "message": "Station not found"
  },
  "request_id": "..."
}
```

## Quotas

Les quotas sont consommés atomiquement côté PostgreSQL. La réponse peut inclure :

```http
X-Quota-Remaining: 42
```

Une limite dépassée retourne `429`.

## Journalisation et sécurité

- aucune clé API brute n’est journalisée ;
- les paramètres d’URL sont supprimés des chemins journalisés ;
- l’adresse IP est hachée avec un sel serveur avant stockage ;
- les secrets Stripe, Supabase et ChargeNow ne sont jamais renvoyés ;
- aucune route publique de maintenance matérielle n’est exposée ;
- aucune route publique d’écriture n’est incluse dans cette version.

## Import dans Apifox

Importez le fichier suivant :

```text
docs/openapi/chargeurs-api-v1.yaml
```

Choisissez **OpenAPI 3.1** dans Apifox, puis configurez la variable de serveur `project` avec la référence du projet Supabase staging.

## État de validation

À faire avant publication :

- appliquer les migrations uniquement sur staging ;
- créer un client et une clé `chg_test_...` ;
- tester toutes les routes avec Apifox ;
- vérifier quotas, scopes et journaux expurgés ;
- confirmer l’isolation des locations ;
- confirmer qu’aucun appel ChargeNow, Stripe ou matériel ne peut être déclenché par cette API ;
- exécuter la suite de tests et le dry-run de déploiement.
