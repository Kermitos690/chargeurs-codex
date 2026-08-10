# Réconciliation des migrations Supabase staging

**État constaté le 3 août 2026 — aucune migration appliquée par ce document.**

Le projet staging `xqepbqnaenoeyfjkjnzl` est lié à ce dépôt, mais son historique
de migrations n'est pas encore reproductible depuis Git :

- migrations locales absentes du distant : `20260720003000`,
  `20260724060000`, `20260724061000`, `20260731132542` et la migration de
  catalogue de rôles `20260803230000` ;
- migrations distantes absentes du dépôt : la série `20260725042947` à
  `20260725050549`, plus `20260731055742`, `20260731055744` et
  `20260731055745` ;
- seules les migrations dont la version est présente des deux côtés constituent
  aujourd'hui une preuve de parité.

Cette dérive interdit un `supabase db push` automatique : il pourrait refuser
le déploiement ou marquer un schéma comme appliqué sans que son contenu soit
vérifié. Aucune commande `db reset`, réparation d'historique, suppression de
table ou migration distante n'est autorisée dans cette phase.

Exception historique déjà consignée :
`20260731132542_kiosk_numeric_enrollment_rate_limits.sql` a été exécutée une
fois directement sur staging après revue. Elle ajoute un journal privé de
tentatives, deux colonnes non destructives, des index et des surcharges de
fonction de redemption. Cette exécution n'a pas réparé le tableau d'historique
Supabase ; elle reste donc une exception contrôlée à inclure dans la baseline.

## Stratégie sûre

1. Exporter hors Git le schéma `public`, les politiques RLS, fonctions,
   triggers, extensions et liste des migrations du staging, avec toutes les
   valeurs sensibles expurgées.
2. Comparer cet export au schéma reconstruit à partir des migrations locales
   sur une base vide locale.
3. Rapatrier dans le dépôt les éléments distants réellement manquants sous une
   baseline révisée. Ne jamais déduire le contenu depuis le seul numéro de
   migration.
4. Écrire des migrations additives de convergence, avec tests RLS et
   contraintes, plutôt que renuméroter ou réécrire l'historique.
5. Exécuter un `supabase db push --dry-run` et faire relire le plan SQL avant
   toute application staging.
6. Appliquer uniquement après sauvegarde logique et vérification des données ;
   conserver le rollback pour chaque changement.

## Critères de sortie

La réconciliation ne sera déclarée reproductible que lorsqu'une base vierge
reconstruit un schéma équivalent au staging, que chaque version distante a un
fichier versionné ou une décision de baseline prouvée, que le dry-run ne
propose aucun changement inattendu et que les tests SQL, RLS et de provisioning
réussissent sur ce schéma reconstruit.

## Conséquence immédiate

Le catalogue complet des rôles est prêt dans le code source, mais sa migration
reste volontairement **non appliquée**. Aucun utilisateur, rôle, privilège ou
politique RLS staging n'a été modifié par cette étape. Les politiques actuelles
continuent à échouer de façon fermée pour les rôles non explicitement pris en
charge.

## Edge Functions

La liste distante montre que les fonctions attendues sont présentes, dont
`kiosk-enroll`, `kiosk-admin`, `create-stripe-checkout`, `stripe-webhook`,
`chargenow-admin`, `sync-cabinet-status` et les passerelles de diagnostic.
Les fonctions distantes `chargenow-readonly-audit`, `device-shadow-ingest` et
`local-gateway-api` ont maintenant un répertoire source local correspondant.
Leur version distante ne doit néanmoins pas être considérée identique au code
Git sans déploiement contrôlé et test ciblé.
