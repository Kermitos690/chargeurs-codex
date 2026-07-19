# Chargeurs.ch Platform API v1 — runbook staging

Ce document décrit une validation **staging uniquement**. Il ne faut jamais utiliser la référence Supabase de production, une clé Stripe live, ni déclencher une commande ChargeNow ou matérielle pendant cette procédure.

## 1. Préconditions

- projet Supabase staging distinct ;
- accès super-administrateur à l’application staging ;
- Supabase CLI authentifiée localement ;
- branche `agent/platform-api-readonly-v1` récupérée ;
- CI manuelle de la PR #34 réussie ;
- aucun secret commité dans GitHub.

## 2. Variables locales

Configurer uniquement dans l’environnement de travail :

```bash
export SUPABASE_ACCESS_TOKEN="..."
export STAGING_PROJECT_REF="..."
export API_LOG_HASH_SALT="une-valeur-longue-aleatoire"
```

Ne jamais copier ces valeurs dans un fichier suivi par Git.

## 3. Vérification obligatoire de la cible

Avant tout lien ou migration :

```bash
supabase projects list
printf '%s\n' "$STAGING_PROJECT_REF"
```

La référence doit être formellement identifiée comme staging et différente de `zoybkzkvvsbnqqarlaii`.

## 4. Validation locale sans écriture distante

```bash
npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund
npm run typecheck
npm run build

deno test --allow-env --allow-net --no-check \
  supabase/functions/tests/platform_api.test.ts \
  supabase/functions/tests/api_client_admin.test.ts
```

Valider également le YAML OpenAPI :

```bash
node --input-type=module -e "import fs from 'node:fs'; import yaml from 'js-yaml'; const doc=yaml.load(fs.readFileSync('docs/openapi/chargeurs-api-v1.yaml','utf8')); if(doc?.openapi !== '3.1.0') throw new Error('OpenAPI 3.1.0 required'); console.log(doc.info.title, doc.info.version);"
```

## 5. Lier le projet staging

```bash
supabase link --project-ref "$STAGING_PROJECT_REF"
```

Vérifier immédiatement la cible affichée par la CLI.

## 6. Dry-run des migrations

```bash
supabase db push --dry-run
```

La migration Platform API attendue est :

```text
supabase/migrations/20260719130000_platform_api_readonly_v1.sql
```

Elle crée ou complète :

- `api_clients` ;
- `api_keys` ;
- `api_quota_counters` ;
- `api_request_logs` ;
- `api_quota_hit` ;
- `rental_sessions.api_client_id`.

Aucune table Stripe ou ChargeNow n’est modifiée par cette migration.

## 7. Application contrôlée sur staging

Après revue humaine du dry-run :

```bash
supabase db push
```

Contrôler ensuite que les politiques RLS limitent `api_clients`, `api_keys` et les journaux aux super-administrateurs, tandis que la Platform API utilise exclusivement le `service_role` côté serveur.

## 8. Secret de journalisation

```bash
supabase secrets set \
  API_LOG_HASH_SALT="$API_LOG_HASH_SALT" \
  --project-ref "$STAGING_PROJECT_REF"
```

Aucun secret Stripe ou ChargeNow n’est nécessaire pour créer les clés API ou lire les données déjà présentes. Les indicateurs de santé peuvent simplement signaler ces intégrations comme non configurées.

## 9. Déploiement des deux fonctions

```bash
supabase functions deploy platform-api \
  --project-ref "$STAGING_PROJECT_REF" \
  --no-verify-jwt

supabase functions deploy api-key-admin \
  --project-ref "$STAGING_PROJECT_REF"
```

Contrat d’authentification :

- `platform-api` : `verify_jwt=false`, puis authentification interne par `chg_test_...` ou `chg_live_...` ;
- `api-key-admin` : `verify_jwt=true`, puis vérification serveur du rôle `super_admin`.

## 10. Créer la première clé test

Dans l’application staging :

```text
/admin/api-clients
```

Créer :

```text
Nom : Chargeurs.ch Apifox
Environnement : test
Scopes :
- health:read
- stations:read
- inventory:read
- pricing:read
- rentals:read
Quota : 60/minute, 10000/jour
```

Cliquer sur **Créer une clé**, puis copier immédiatement la valeur complète `chg_test_...` dans le coffre de secrets utilisé pour les tests. Ne pas la coller dans GitHub, Slack, un ticket ou une capture d’écran.

## 11. Tests Apifox / curl

Santé publique :

```bash
curl -i "https://${STAGING_PROJECT_REF}.supabase.co/functions/v1/platform-api/v1/health"
```

Client authentifié :

```bash
curl -i \
  -H "X-API-Key: $CHARGEURS_TEST_API_KEY" \
  "https://${STAGING_PROJECT_REF}.supabase.co/functions/v1/platform-api/v1/me"
```

Station DTA21269 :

```bash
curl -i \
  -H "Authorization: Bearer $CHARGEURS_TEST_API_KEY" \
  "https://${STAGING_PROJECT_REF}.supabase.co/functions/v1/platform-api/v1/stations/DTA21269"
```

## 12. Tests négatifs obligatoires

Vérifier :

- aucune clé → HTTP 401 ;
- clé altérée → HTTP 401 ;
- clé révoquée → HTTP 401 ;
- scope absent → HTTP 403 ;
- quota dépassé → HTTP 429 ;
- location appartenant à un autre client → HTTP 404 ;
- route inconnue → HTTP 404 ;
- query string contenant une fausse clé → la valeur ne doit jamais apparaître dans `api_request_logs` ;
- aucune réponse ne doit contenir de secret Supabase, Stripe ou ChargeNow.

## 13. Validation des événements canoniques

Les routes de location doivent :

1. vérifier la propriété dans `rental_sessions.api_client_id` ;
2. lire l’état depuis `rental_orchestrator_snapshots` ;
3. lire les événements depuis `rental_orchestrator_events` ;
4. ne jamais lire `rental_events` pour l’API publique.

## 14. Interdictions

Pendant ce lot, ne pas :

- déployer sur le projet `zoybkzkvvsbnqqarlaii` ;
- fusionner la PR avant validation ;
- activer une clé `chg_live_...` ;
- appeler une route Stripe ou ChargeNow ;
- modifier `beta_rentals_enabled` ;
- éjecter une batterie ;
- créer une route publique d’écriture.

## 15. Preuves à conserver

- sortie de la CI manuelle ;
- sortie du dry-run ;
- liste des migrations appliquées sur staging ;
- statut de déploiement des deux fonctions ;
- résultats des tests positifs et négatifs sans secret ;
- capture des journaux expurgés ;
- confirmation de l’isolation entre deux clients API.
