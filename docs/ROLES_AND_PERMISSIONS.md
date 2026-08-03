# Rôles et permissions — staging

## Principe d'autorité

Le menu React est une aide ergonomique seulement. Les Edge Functions et les
politiques RLS Supabase sont les seules autorités d'accès. Tout rôle absent
d'une règle serveur est refusé : aucun rôle nouveau ne reçoit un droit par
défaut.

## Rôles actuellement vérifiés par le code déployé

| Rôle | Portée | Accès confirmé | État |
|---|---|---|---|
| `super_admin` | plateforme | gestion utilisateurs et opérations sensibles | contrôlé par `requireSuperAdmin` |
| `admin` | plateforme | compatibilité des politiques historiques | contrôlé par RLS historique |
| `operations_admin` | plateforme | opérations administratives non financières | contrôlé par `requireAdmin` |
| `finance_admin` | plateforme | parcours finance explicitement exposé | UI et politiques existantes à vérifier par scénario |
| `support_agent` | plateforme | support et lecture ciblée | UI et politiques existantes à vérifier par scénario |
| `maintenance_technician` | plateforme | maintenance et diagnostics | UI et politiques existantes à vérifier par scénario |
| `partner_owner`, `partner_staff` | organisation | lecture des données de leur organisation lorsque la politique le permet | contrôlé par membership |
| `customer` | individu | portail client et propres données | contrôlé par propriétaire |
| `kiosk_device`, `api_client` | système | aucune attribution depuis le back-office | non attribuable |

## Catalogue prêt dans le dépôt, non activé sur staging

`platform_admin`, `support_manager`, `maintenance_manager`,
`powerbank_manager`, `mifi_manager`, `advertising_manager`,
`reports_analyst`, les rôles franchise/agence/établissement et `vip_customer`
sont définis dans `src/lib/roleCatalog.ts` et dans une migration additive.

Ils ne sont **pas** encore créés dans le type d'énumération staging :
`20260803230000_expand_platform_role_matrix.sql` est en attente de la baseline
documentée dans `SUPABASE_MIGRATION_RECONCILIATION.md`. Le back-office ne doit
pas les présenter comme actifs, ni les attribuer à un compte staging avant les
tests RLS/RBAC correspondants. L'écran `Utilisateurs & rôles` les affiche avec
cet état et ne transmet pas une demande d'attribution impossible au staging.

## Interdictions permanentes

- aucun rôle de support, maintenance ou partenaire ne reçoit une mutation
  ChargeNow par défaut ;
- aucun rôle ne contourne `CHARGENOW_MUTATIONS_ENABLED=false`,
  `HARDWARE_EJECTION_ENABLED=false` ou `STRIPE_LIVE_ENABLED=false` ;
- un rôle de plateforme ne permet jamais l'accès inter-organisation sans une
  politique RLS explicite ;
- le rôle simulé côté UI ne remplace jamais une vérification backend.

## Mise en service des nouveaux rôles

1. Réconcilier le schéma staging et l'historique de migrations.
2. Appliquer la migration additive après dry-run vérifié.
3. Ajouter une politique RLS par table et une permission Edge Function par
   opération, avec tests positifs et négatifs multi-tenant.
4. Créer les comptes de test via invitation sécurisée ; les mots de passe ne
   sont jamais stockés dans Git ni dans cette documentation.
5. Exécuter la recette par rôle, puis seulement rendre le rôle sélectionnable
   dans le back-office staging.
