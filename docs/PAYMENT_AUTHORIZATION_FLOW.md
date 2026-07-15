# Chargeurs.ch — autorisation de paiement et règlement final

## État

Ce flux est **développé mais désactivé par défaut**. Il ne doit être activé que sur Stripe test et Supabase staging avant toute utilisation réelle.

Variables de garde :

```text
ENABLE_MANUAL_AUTHORIZATION_FLOW=false
ENABLE_MANUAL_AUTHORIZATION_LIVE=false
ENABLE_RETURN_SETTLEMENT_WORKER=false
```

L’activation LIVE exige que les variables concernées soient explicitement à `true`. Aucune valeur n’est stockée dans GitHub.

## Règles métier implémentées

- autorisation initiale : 30 CHF (`3000` centimes) ;
- retour normal : capture uniquement du montant calculé ;
- annulation ou échec d’éjection avant capture : annulation de l’autorisation ;
- montant déjà capturé par erreur : remboursement Stripe effectif du trop-perçu ;
- non-retour : total cible de 99 CHF ;
- première capture limitée à l’autorisation de 30 CHF ;
- solde non-retour exposé comme `additional_payment_required`, soit 69 CHF dans le cas standard ;
- aucun complément de 69 CHF n’est débité automatiquement tant qu’un mandat de paiement hors session et sa conformité ne sont pas validés.

## Composants

### Domaine pur

```text
supabase/functions/_shared/paymentLifecycle.ts
```

Fonction principale :

```text
planSettlement(...)
```

Elle retourne :

- montant final ;
- montant à capturer depuis l’autorisation ;
- annulation éventuelle ;
- complément restant ;
- remboursement éventuel ;
- état terminal recommandé.

### Adaptateur Stripe interne

```text
supabase/functions/stripe-payment-lifecycle/index.ts
```

La fonction accepte uniquement un bearer token correspondant à `SUPABASE_SERVICE_ROLE_KEY`.

Actions :

```json
{
  "action": "authorize",
  "rentalSessionId": "<uuid>",
  "idempotencyKey": "authorize-<unique>"
}
```

```json
{
  "action": "settle",
  "rentalSessionId": "<uuid>",
  "idempotencyKey": "settle-<unique>",
  "reason": "returned",
  "calculatedRentalCents": 750
}
```

Raisons acceptées :

- `returned` ;
- `non_return` ;
- `cancelled` ;
- `release_failed`.

L’adaptateur exécute réellement, selon le plan :

- création d’une autorisation manuelle ;
- capture partielle ;
- annulation de l’autorisation ;
- remboursement Stripe idempotent ;
- journalisation des opérations réussies ou échouées.

### Pipeline retour

```text
supabase/functions/rental-settlement-worker/index.ts
docs/RETURN_SETTLEMENT_PIPELINE.md
```

Le retour ChargeNow est corrélé par `tradeNo` ou identifiant batterie, puis mis en file. Le worker recalcule le tarif avec `compute_pricing`, appelle l’adaptateur Stripe et clôture l’ordre ChargeNow. Un cas ambigu ou incohérent produit un incident sans nouveau débit automatique.

### Stockage

Migrations :

```text
supabase/migrations/20260715170000_payment_authorization_lifecycle.sql
supabase/migrations/20260715182000_return_settlement_pipeline.sql
```

Elles ajoutent les champs explicites d’autorisation, capture, remboursement, finalisation, retour et complément, ainsi que :

```text
payment_lifecycle_operations
rental_settlement_jobs
```

Chaque opération fournisseur et chaque job de règlement sont idempotents.

## Limites volontaires

Le composant ne fait pas encore :

- présentation de Payment Element au client ;
- confirmation 3DS côté frontend ;
- débit automatique hors session des 69 CHF ;
- renouvellement d’une autorisation expirée ;
- activation ou déploiement staging automatique ;
- activation LIVE.

Le code de retour et de règlement existe, mais les migrations, secrets, fonctions et cron doivent encore être appliqués et validés sur staging.

## Plan de validation staging

1. Appliquer les migrations dans l’ordre.
2. Déployer `stripe-payment-lifecycle` et `rental-settlement-worker`.
3. Configurer une clé Stripe test.
4. Configurer `RENTAL_SETTLEMENT_WORKER_TOKEN`.
5. Activer uniquement `ENABLE_MANUAL_AUTHORIZATION_FLOW=true`.
6. Laisser `ENABLE_RETURN_SETTLEMENT_WORKER=false` pendant les premiers tests isolés.
7. Créer une location de test.
8. Créer et confirmer une autorisation de 30 CHF.
9. Vérifier un retour à 7,50 CHF : capture de 7,50 CHF seulement.
10. Vérifier un trop-perçu contrôlé : remboursement Stripe du montant calculé.
11. Vérifier un échec d’éjection : annulation de l’autorisation.
12. Vérifier un non-retour : capture 30 CHF et état `additional_payment_required` à 69 CHF.
13. Vérifier les replays avec les mêmes clés d’idempotence.
14. Activer le worker de retour en test.
15. Vérifier la corrélation par batterie et le refus des retours ambigus.
16. Vérifier les événements Stripe, le journal d’audit et la clôture ChargeNow.
17. Laisser `ENABLE_MANUAL_AUTHORIZATION_LIVE=false`.

## Critères avant activation LIVE

- compatibilité confirmée des moyens de paiement retenus avec la capture manuelle ;
- parcours 3DS validé ;
- durée d’autorisation compatible avec la durée maximale de location ;
- stratégie conforme et explicite pour les 69 CHF supplémentaires ;
- conditions générales et consentement client alignés ;
- tests sur une borne, puis trois bornes ;
- réconciliation Stripe/Supabase/ChargeNow ;
- alertes sur `additional_payment_required`, échec de capture et autorisation expirée ;
- revue sécurité et financière.
