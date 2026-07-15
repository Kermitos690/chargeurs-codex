# Chargeurs.ch — Déploiement Supabase staging

## Principe

Le workflow suivant est le seul chemin automatisé prévu pour ce lot :

```text
.github/workflows/deploy-supabase-staging.yml
```

Il est déclenché manuellement, utilise l’environnement GitHub `staging` et ne peut pas activer les mutations financières ou matérielles lors du premier déploiement.

Le workflow officiel `supabase/setup-cli@v3` installe une version fixe de la CLI. Les migrations sont toujours affichées avec `supabase db push --dry-run` avant une éventuelle application.

## Garde-fous

Le lancement exige la phrase exacte :

```text
DEPLOY-CHARGEURS-STAGING
```

Le workflow refuse :

- une référence projet vide ou invalide ;
- la référence historique contenue dans `supabase/config.toml` ;
- une référence identique à `SUPABASE_PRODUCTION_PROJECT_REF` ;
- une clé Stripe qui ne commence pas par `sk_test_` ;
- l’absence d’un secret requis ;
- l’activation automatique des mutations LIVE ou matérielles.

Le dépôt ne doit contenir aucune valeur de secret.

## Environnement GitHub

Créer un environnement nommé :

```text
staging
```

Une approbation manuelle d’environnement est recommandée avant l’exécution du job.

### Secrets GitHub requis

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_STAGING_PROJECT_REF
SUPABASE_STAGING_DB_PASSWORD
SUPABASE_STAGING_ANON_KEY
STAGING_STRIPE_SECRET_KEY
STAGING_STRIPE_WEBHOOK_SECRET
STAGING_CHARGENOW_BASIC_AUTH
STAGING_CHARGENOW_EVENT_SECRET
STAGING_API_LOG_HASH_SALT
STAGING_PLATFORM_API_WEBHOOK_MASTER_SECRET
STAGING_PLATFORM_API_WEBHOOK_WORKER_TOKEN
STAGING_RENTAL_SETTLEMENT_WORKER_TOKEN
```

### Variables GitHub requises

```text
STAGING_PUBLIC_APP_URL
SUPABASE_PRODUCTION_PROJECT_REF
```

`SUPABASE_PRODUCTION_PROJECT_REF` sert uniquement à empêcher qu’un workflow staging cible la production.

## Feature flags imposés au premier déploiement

Le fichier temporaire de secrets configure obligatoirement :

```text
PLATFORM_API_MUTATIONS_ENABLED=false
PLATFORM_API_LIVE_MUTATIONS_ENABLED=false
PLATFORM_API_HARDWARE_MUTATIONS_ENABLED=false
ENABLE_MANUAL_AUTHORIZATION_FLOW=false
ENABLE_MANUAL_AUTHORIZATION_LIVE=false
ENABLE_RETURN_SETTLEMENT_WORKER=false
ALLOW_UNSIGNED_CHARGENOW_EVENTS=false
ENVIRONMENT=staging
```

Le fichier temporaire est créé avec des permissions restrictives, utilisé par `supabase secrets set --env-file`, puis supprimé dans une étape `always()`.

## Options du workflow

### `apply_migrations`

- `false` : exécute seulement le dry-run ;
- `true` : applique les migrations, liste l’historique final et exécute le lint distant.

### `sync_function_secrets`

- `false` : ne modifie aucun secret Supabase ;
- `true` : synchronise les secrets staging et les feature flags désactivés.

### `deploy_functions`

Déploie les fonctions en deux groupes :

1. fonctions avec authentification personnalisée et `--no-verify-jwt` ;
2. fonctions protégées par JWT Supabase.

### `run_smoke_tests`

Effectue uniquement des tests non destructifs :

- santé publique de la Platform API ;
- refus d’un appel sans clé API ;
- confirmation que le worker de règlement est désactivé.

Aucune location, autorisation Stripe, éjection ou synchronisation ChargeNow n’est déclenchée.

## Ordre du premier passage

### Passage 1 — inspection

```text
apply_migrations=false
sync_function_secrets=false
deploy_functions=false
run_smoke_tests=false
```

Résultat attendu : liaison au projet et artefact contenant le dry-run des migrations.

### Passage 2 — base de données

```text
apply_migrations=true
sync_function_secrets=false
deploy_functions=false
run_smoke_tests=false
```

Résultat attendu : migrations appliquées, historique et lint distant disponibles dans l’artefact.

### Passage 3 — secrets et fonctions désactivées

```text
apply_migrations=false
sync_function_secrets=true
deploy_functions=true
run_smoke_tests=true
```

Résultat attendu : fonctions déployées, santé publique valide et toutes les mutations critiques encore désactivées.

## Artefacts de preuve

Chaque exécution conserve pendant 30 jours, selon les options choisies :

```text
migrations-before.txt
db-push-dry-run.txt
migrations-after.txt
db-lint.txt
functions-after.txt
platform-api-health.json
rentals-unauthorized.json
settlement-worker-disabled.json
```

Les artefacts ne doivent jamais contenir de clés, tokens, mots de passe ou corps de paiement.

## Activation fonctionnelle ultérieure

L’activation des mutations test et des workers doit faire l’objet d’un workflow distinct, après :

- validation des migrations ;
- vérification des secrets ;
- création d’une clé API `chg_test_...` à privilèges minimaux ;
- test de signature des callbacks ;
- test Stripe test mode ;
- test sur une borne isolée.

Aucune activation LIVE ne doit être intégrée au workflow staging.
