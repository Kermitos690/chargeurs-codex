# Configuration ChargeNow

## Configuration de référence

```dotenv
CHARGENOW_MODE=test
CHARGENOW_API_BASE_URL=https://developer.chargenow.top/cdb-open-api/v1
CHARGENOW_BASIC_AUTH=
CHARGENOW_BASIC_USERNAME=
CHARGENOW_BASIC_PASSWORD=
CHARGENOW_MUTATIONS_ENABLED=false
CHARGENOW_RENT_SLOT_ZERO_MODE=
CHARGENOW_TIMEOUT_MS=10000
CHARGENOW_CALLBACK_SECRET=
```

`CHARGENOW_BASIC_AUTH` contient uniquement la valeur après `Basic` et a priorité sur le couple utilisateur/mot de passe. Le secret reste exclusivement dans les secrets Edge Functions. Les anciens noms `CHARGENOW_BASE_URL`, `CHARGENOW_APP_ID`, `CHARGENOW_SECRET` et `CHARGENOW_MERCHANT_ID` ne sont pas consommés.

Ne jamais inventer un endpoint. Les valeurs du fournisseur restent exclusivement dans les secrets Edge Functions.

## Séquence de location

1. Session et snapshot tarifaire créés.
2. Checkout Stripe créé.
3. Webhook Stripe vérifié ; montant, devise, session et snapshot concordent.
4. Transition `payment_succeeded` enregistrée.
5. Commande ChargeNow créée de manière idempotente.
6. Éjection demandée puis confirmée.
7. Location activée uniquement après preuve matérielle.

Une réponse HTTP 2xx avec un code métier différent de `0` est un échec. Toutes les requêtes expirent après `CHARGENOW_TIMEOUT_MS`. Le slot 0 est refusé par défaut ; `CHARGENOW_RENT_SLOT_ZERO_MODE=provider_auto_select` n'est permis qu'après confirmation écrite que le fournisseur sélectionne réellement un slot.

## Callbacks et retours

Vérifier la signature/secret avant tout effet, enregistrer l'événement dans une inbox idempotente, puis corréler trade number, batterie, station et slot. Un `BATTERY_IN` sans corrélation exacte ne ferme jamais « la dernière location » supposée.

## Échec après paiement

Ne pas afficher de succès. Ouvrir un incident, demander le remboursement idempotent, informer le kiosque et permettre une reprise manuelle auditée. La réconciliation périodique compare l'état local, Stripe et ChargeNow.

## Activation

Tester d'abord `GET /rent/cabinet/query` en lecture seule. Le client refuse centralement toute route mutante tant que `CHARGENOW_MUTATIONS_ENABLED` n'est pas exactement `true`. Les paiements live restent désactivés. Voir `HARDWARE_INTEGRATION.md` pour les limites du protocole série.
