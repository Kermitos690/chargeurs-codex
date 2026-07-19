# Chargeurs.ch Platform API v1

## Statut

Cette API est en développement dans la branche `agent/platform-api-readonly-v1` et la PR #34.

Elle est actuellement **lecture seule**. Elle ne permet pas de créer une location, déclencher un paiement, éjecter une batterie, enregistrer un retour ou agir sur le matériel.

## URL de base

```text
https://<PROJECT_REF>.supabase.co/functions/v1/platform-api
```

Le déploiement staging n’est pas encore effectué. Remplacez `<PROJECT_REF>` uniquement après création du projet Supabase de staging.

## Créer un client et une clé API

Après application de la migration staging et déploiement de `api-key-admin`, un super-administrateur ouvre :

```text
/admin/api-clients
```

Procédure :

1. saisir le nom du client ;
2. choisir `test` ou `live` ;
3. sélectionner uniquement les scopes nécessaires ;
4. créer le client ;
5. cliquer sur **Créer une clé** ;
6. copier immédiatement la valeur complète affichée.

Pour les premiers essais Apifox, utiliser :

```text
Nom : Chargeurs.ch Apifox
Environnement : test
Scopes : health:read, stations:read, inventory:read, pricing:read, rentals:read
Quota : 60/minute, 10000/jour
```

La clé est générée exclusivement dans la fonction serveur `api-key-admin`. Le navigateur ne fabrique plus la clé. Le serveur stocke uniquement son empreinte SHA-256 et retourne le secret brut une seule fois.

Exemple de format :

```text
chg_test_0123456789abcdef0123456789abcdef0123456789abcdef
```

Une clé perdue n’est pas récupérable. Il faut la révoquer puis en créer une nouvelle.

## Authentification des appels API

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

## Scopes

- `health:read`
- `stations:read`
- `inventory:read`
- `pricing:read`
- `rentals:read`

Aucun scope d’écriture n’est accepté dans cette version.

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

La propriété du client API est vérifiée dans `rental_sessions.api_client_id`. L’état et le journal exposés sont lus depuis les tables canoniques :

```text
rental_orchestrator_snapshots
rental_orchestrator_events
```

La table historique `rental_events` n’est plus utilisée par cette façade.

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
- aucune route publique d’écriture n’est incluse dans cette version ;
- `platform-api` utilise l’authentification personnalisée par clé et possède `verify_jwt=false` ;
- `api-key-admin` exige une session Supabase valide et le rôle `super_admin`, avec `verify_jwt=true`.

## Import dans Apifox

Importez le fichier suivant :

```text
docs/openapi/chargeurs-api-v1.yaml
```

Choisissez **OpenAPI 3.1** dans Apifox, puis configurez la variable de serveur `project` avec la référence du projet Supabase staging.

## Déploiement staging

La procédure contrôlée est documentée dans :

```text
docs/PLATFORM_API_STAGING.md
```

## État de validation

À faire avant publication :

- exécuter manuellement la CI de la PR #34 ;
- appliquer les migrations uniquement sur staging ;
- déployer `platform-api` et `api-key-admin` uniquement sur staging ;
- créer un client et une clé `chg_test_...` ;
- tester toutes les routes avec Apifox ;
- vérifier quotas, scopes et journaux expurgés ;
- confirmer l’isolation des locations ;
- confirmer qu’aucun appel ChargeNow, Stripe ou matériel ne peut être déclenché par cette API ;
- conserver la PR en brouillon jusqu’aux preuves de staging.
