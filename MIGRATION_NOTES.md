# Notes de migration

## Consolidation effectuée

La branche de livraison rassemble la base principale, l'API plateforme, le règlement Stripe/ChargeNow et le projet Android. L'ancien bootstrap SQL de l'API est conservé comme historique mais neutralisé au profit des migrations canoniques.

## Règles

- Ne jamais modifier ou retirer une migration déjà appliquée sur staging/production.
- Les correctifs sont additifs et datés.
- Tester une installation neuve et une mise à niveau depuis le bootstrap historique.
- Les nouvelles valeurs de l'enum `app_role` sont comparées par texte dans leur migration afin d'éviter l'utilisation d'une valeur non encore validée dans la transaction PostgreSQL.

## Migrations de consolidation récentes

- `20260719133000` : API plateforme v1.
- `20260719143000` : réconciliation du bootstrap API historique.
- `20260719170000` : snapshot tarifaire complet, versions immuables et contrainte unique.
- `20260719200000` : codes d'appairage kiosque à usage unique.
- `20260719210000` : rôles métier, organisations, factures, maintenance, notifications et réglages.
- `20260719213000` : présentation publique exacte des conditions tarifaires au kiosque.
- `20260719214000` : demandes support/partenaires sans IP en clair.
- `20260719215000` : consentement, export et suppression de compte sous garde-fous.

## Données historiques

Les versions tarifaires existantes sont réparées avant l'ajout de l'unicité `(price_profile_id, version)`. Les locations historiques incomplètes ne sont pas facturées en devinant une règle : elles passent en revue manuelle. Les événements `BATTERY_IN` historiques non corrélés ne ferment plus arbitrairement la dernière location d'une batterie.

## Vérifications post-déploiement

Contrôler les fonctions de claim, les index uniques Stripe/ChargeNow, les politiques RLS, les rôles, les codes d'appairage expirés et la fermeture par défaut des feature flags. Une migration appliquée ne constitue pas une preuve de fonctionnement Stripe ou matériel.
