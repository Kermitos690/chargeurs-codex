# Configuration Supabase

## Projets

Créer deux projets sans partage de secrets : staging et production. Activer les sauvegardes adaptées au plan choisi et restreindre l'accès au tableau de bord.

Le staging officiel est actuellement :

- nom : `chargeurs-ch-staging` ;
- référence : `xqepbqnaenoeyfjkjnzl` ;
- région : Zurich (`eu-central-2`) ;
- URL : `https://xqepbqnaenoeyfjkjnzl.supabase.co` ;
- dashboard : `https://supabase.com/dashboard/project/xqepbqnaenoeyfjkjnzl`.

La référence historique `zoybkzkvvsbnqqarlaii` est abandonnée et ne doit plus être utilisée comme cible active.

## Variables

- Frontend : URL et clé publique/anon uniquement.
- Edge Functions : URL, clé `service_role`, secrets Stripe/ChargeNow, secrets internes, sels d'empreinte et origines autorisées.
- Ne jamais placer `service_role` dans Vite, Android ou une URL.

## Migrations

Appliquer dans l'ordre lexical. Elles ajoutent notamment le Rental Orchestrator, le règlement, l'inbox webhook, l'API v1, le snapshot tarifaire, l'enrôlement kiosque, les organisations/RBAC, les formulaires publics et les contrôles de confidentialité client.

Après application, exécuter les contrats SQL de `supabase/tests/` avec `psql` contre une base jetable. Vérifier explicitement que `anon` ne lit pas paiements, tokens, journaux bruts ou données partenaires.

## Auth

Configurer les URL de redirection exactes pour `/compte`, `/compte/reset-password`, `/admin` et `/admin/reset-password`. Exiger l'email vérifié avant rattachement/export/suppression de données client. Les rôles sont stockés dans `user_roles`, jamais dans un champ modifiable du profil.

## Fonctions publiques sans JWT

`stripe-webhook`, callbacks ChargeNow, API v1, enrôlement et formulaires publics désactivent la vérification JWT Supabase parce qu'ils appliquent leur propre signature/token/origine. Cela ne signifie pas qu'ils sont non authentifiés.

## Realtime

Ne pas publier l'intégralité de `rental_sessions`. Le kiosque utilise des RPC de statut étroits afin de ne pas exposer les identifiants Stripe et les données financières.
