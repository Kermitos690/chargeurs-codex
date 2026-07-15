# Rental Orchestrator Chargeurs.ch

## Objectif

Le Rental Orchestrator devient l'autorité centrale du cycle de location. Il interdit les transitions incohérentes, journalise les événements, rend les commandes idempotentes et prépare les compensations lorsqu'une opération partielle échoue.

## États

```text
created
payment_pending
authorized
release_requested
released
active
return_detected
pricing_finalized
payment_captured
refunded
completed
failed
non_return
```

## Principes

### Machine à états

Une location ne peut avancer que selon les transitions explicitement autorisées. Par exemple, une location `payment_pending` ne peut pas devenir directement `completed`.

### Idempotence

Chaque événement possède une `idempotencyKey`. Le même événement rejoué avec la même clé ne modifie pas une seconde fois la location. Une même clé utilisée pour une autre action est rejetée.

### Journal d'événements

Chaque transition conserve :

- l'identifiant de l'événement ;
- l'identifiant de location ;
- le type d'événement ;
- la date ;
- la clé d'idempotence ;
- les métadonnées utiles, sans secret.

### Compensation

Lorsqu'un paiement est autorisé mais qu'aucune batterie n'est confirmée comme délivrée, le moteur prépare :

1. l'annulation de l'autorisation ;
2. l'ouverture d'un incident ;
3. l'information du client.

Aucune capture ne doit être tentée automatiquement dans ce cas.

### Réconciliation

Le moteur de réconciliation compare :

- l'état local ;
- l'état Stripe ;
- l'état fournisseur ;
- la présence du PaymentIntent ;
- la présence de la batterie.

Il signale notamment les paiements manquants, les captures incohérentes, les sorties non confirmées, les retours non confirmés et les batteries délivrées sans location locale active.

## Prochaine intégration backend

Les fonctions pures livrées dans ce lot doivent être branchées à une couche transactionnelle Supabase :

- table `rental_events` avec contrainte unique sur `idempotency_key` ;
- version optimiste sur la location ;
- fonction serveur unique pour appliquer une transition ;
- webhooks Stripe enregistrés avant traitement ;
- callbacks fournisseur enregistrés avant traitement ;
- worker de compensation ;
- tâche périodique de réconciliation.

## Règle de sécurité

Le frontend et le kiosk ne doivent jamais pouvoir imposer directement un état final. Ils demandent une action au backend ; seul le backend valide la transition après contrôle Stripe, fournisseur et base de données.
