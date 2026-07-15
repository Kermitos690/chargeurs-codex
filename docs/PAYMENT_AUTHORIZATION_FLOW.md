# Chargeurs.ch — autorisation de paiement et règlement final

## État

Ce flux est **développé mais désactivé par défaut**. Il ne doit être activé que sur Stripe test et Supabase staging avant toute utilisation réelle.

Variables de garde :

```text
ENABLE_MANUAL_AUTHORIZATION_FLOW=false
ENABLE_MANUAL_AUTHORIZATION_LIVE=false
```

L’activation LIVE exige que les deux variables soient explicitement à `true`. Aucune valeur n’est stockée dans GitHub.

## Règles métier implémentées

- autorisation initiale : 30 CHF (`3000` centimes) ;
- retour normal : capture uniquement du montant calculé ;
- annulation ou échec d’éjection avant capture : annulation de l’autorisation ;
- montant déjà capturé par erreur : remboursement du trop-perçu ;
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

### Stockage

Migration :

```text
supabase/migrations/20260715170000_payment_authorization_lifecycle.sql
```

Elle ajoute les champs explicites d’autorisation, capture, remboursement, finalisation et complément, ainsi que :

```text
payment_lifecycle_operations
```

Chaque opération fournisseur est idempotente par location, type d’opération et clé.

## Limites volontaires

Le composant ne fait pas encore :

- présentation de Payment Element au client ;
- confirmation 3DS côté frontend ;
- débit automatique hors session des 69 CHF ;
- calcul de durée dans l’adaptateur Stripe ;
- déclenchement automatique après retour ChargeNow ;
- renouvellement d’une autorisation expirée ;
- activation LIVE.

Ces étapes doivent être branchées au Rental Orchestrator après validation Stripe test.

## Plan de validation staging

1. Appliquer les migrations dans l’ordre.
2. Déployer `stripe-payment-lifecycle`.
3. Configurer une clé Stripe test.
4. Activer uniquement `ENABLE_MANUAL_AUTHORIZATION_FLOW=true`.
5. Créer une location de test.
6. Créer et confirmer une autorisation de 30 CHF.
7. Vérifier un retour à 7,50 CHF : capture de 7,50 CHF seulement.
8. Vérifier un échec d’éjection : annulation de l’autorisation.
9. Vérifier un non-retour : capture 30 CHF et état `additional_payment_required` à 69 CHF.
10. Vérifier les replays avec les mêmes clés d’idempotence.
11. Vérifier les événements Stripe et le journal d’audit.
12. Laisser `ENABLE_MANUAL_AUTHORIZATION_LIVE=false`.

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
