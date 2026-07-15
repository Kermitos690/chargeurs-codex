# Chargeurs.ch — Pipeline retour et règlement

## Objectif

Le pipeline transforme un retour matériel vérifié en clôture financière et opérationnelle sans effectuer d’effet externe dans le callback public ChargeNow.

```text
ChargeNow callback / cabinet event
        ↓
Corrélation exacte de la location
        ↓
Marquage battery_returned
        ↓
rental_settlement_jobs
        ↓
rental-settlement-worker
        ↓
compute_pricing
        ↓
stripe-payment-lifecycle
        ↓
orderClose ChargeNow
        ↓
completed ou incident explicite
```

## Corrélation du retour

Ordre de confiance :

1. `tradeNo` exact ;
2. identifiant batterie exact ;
3. candidat unique sur une station, uniquement lorsqu’il n’existe aucune ambiguïté.

Le comportement historique « prendre la location active la plus récente de la borne » est supprimé. Plusieurs candidats provoquent `AMBIGUOUS_MATCH`, un incident et aucun règlement automatique.

Les champs reconnus de façon tolérante incluent notamment :

```text
batteryId, batterySN, batterySn, batteryCode, sn, bid
tradeNo, trade_no, orderNo
slotNum, slot, slotId, position
deviceId, cabinetId, stationId
```

## Persistance à l’éjection

`eject-after-payment` conserve désormais, lorsqu’ils sont fournis par ChargeNow :

- `battery_id` ;
- `selected_slot_num` ;
- le `tradeNo` déjà existant.

Cette identité permet de rendre la batterie dans une autre borne tout en conservant une corrélation fiable.

## Mise en file

Migration :

```text
supabase/migrations/20260715182000_return_settlement_pipeline.sql
```

Elle ajoute les champs de retour et de règlement sur `rental_sessions`, ainsi que :

```text
rental_settlement_jobs
claim_rental_settlement_jobs
finish_rental_settlement_job
```

La file utilise `FOR UPDATE SKIP LOCKED`, récupère les jobs bloqués après cinq minutes, applique des reprises progressives et passe en `dead` après huit tentatives.

## Worker

Fonction :

```text
rental-settlement-worker
```

Authentification acceptée :

- `RENTAL_SETTLEMENT_WORKER_TOKEN` ;
- ou `SUPABASE_SERVICE_ROLE_KEY` pour un appel interne contrôlé.

Activation obligatoire :

```text
ENABLE_RETURN_SETTLEMENT_WORKER=true
```

Sans cette variable, aucun job n’est réclamé.

Le worker :

1. charge la location ;
2. vérifie `started_at` et `returned_at` ;
3. appelle `compute_pricing` avec les dates réelles ;
4. conserve `final_pricing_snapshot` et `final_amount_cents` ;
5. alimente le Rental Orchestrator ;
6. refuse tout débit automatique d’un ancien flux Checkout ;
7. appelle le cycle Stripe manuel pour les locations `manual_authorization` ;
8. clôture l’ordre ChargeNow ;
9. marque la location `completed` ou crée un incident explicite.

## Anciens paiements Checkout

Une location sans `payment_flow = manual_authorization` passe en `manual_review`. Le pipeline ne crée jamais un nouveau débit sur une ancienne location capturée immédiatement.

## Complément de paiement

Lorsque le montant final dépasse l’autorisation disponible, le statut devient :

```text
additional_payment_required
```

L’ordre ChargeNow peut être clôturé puisque la batterie est revenue, mais la location reste en support jusqu’à traitement conforme du complément.

## Incidents possibles

```text
return_correlation_failed
return_settlement_enqueue_failed
legacy_payment_settlement_required
rental_settlement_failed
chargenow_close_after_settlement_failed
additional_payment_required
```

Aucun de ces cas ne doit être converti silencieusement en location terminée.

## Variables nécessaires

```text
ENABLE_RETURN_SETTLEMENT_WORKER
RENTAL_SETTLEMENT_WORKER_TOKEN
ENABLE_MANUAL_AUTHORIZATION_FLOW
ENABLE_MANUAL_AUTHORIZATION_LIVE
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
CHARGENOW_BASIC_AUTH
CHARGENOW_EVENT_SECRET
```

Aucune valeur ne doit être enregistrée dans GitHub.

## Ordre de déploiement staging

1. appliquer les migrations orchestrateur ;
2. appliquer les migrations Platform API ;
3. appliquer `20260715170000_payment_authorization_lifecycle.sql` ;
4. appliquer `20260715182000_return_settlement_pipeline.sql` ;
5. déployer les fonctions modifiées ;
6. laisser les workers désactivés ;
7. tester les callbacks avec événements signés et données fictives ;
8. activer le cycle d’autorisation en mode Stripe test ;
9. activer le worker de règlement ;
10. tester une borne, puis les trois bornes.

## Critères de validation

- aucun retour ambigu n’est automatiquement attribué ;
- un événement dupliqué ne crée pas deux jobs ;
- un job ne capture jamais deux fois ;
- le montant provient uniquement de `compute_pricing` ;
- une location legacy ne produit aucun nouveau débit ;
- l’échec de clôture ChargeNow crée un incident ;
- l’historique Stripe, Supabase et ChargeNow partage le même identifiant de location ;
- la CI, le test Stripe et le test physique sont verts avant activation LIVE.
