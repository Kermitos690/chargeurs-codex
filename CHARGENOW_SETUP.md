# Configuration ChargeNow

## Accès requis

Demander au fournisseur la base URL test/live, app ID, secret, merchant ID, méthode d'authentification, signature callback, catalogue exact des endpoints, sémantique des statuts, timeouts, quotas et documentation du protocole matériel/slots.

Ne jamais inventer un endpoint. Les valeurs du fournisseur restent exclusivement dans les secrets Edge Functions.

## Séquence de location

1. Session et snapshot tarifaire créés.
2. Checkout Stripe créé.
3. Webhook Stripe vérifié ; montant, devise, session et snapshot concordent.
4. Transition `payment_succeeded` enregistrée.
5. Commande ChargeNow créée de manière idempotente.
6. Éjection demandée puis confirmée.
7. Location activée uniquement après preuve matérielle.

Une réponse HTTP 2xx portant `ok=false` est un échec. Le slot 0 est refusé par défaut ; `CHARGENOW_RENT_SLOT_ZERO_MODE=provider_auto_select` n'est permis qu'après confirmation écrite que le fournisseur sélectionne réellement un slot.

## Callbacks et retours

Vérifier la signature/secret avant tout effet, enregistrer l'événement dans une inbox idempotente, puis corréler trade number, batterie, station et slot. Un `BATTERY_IN` sans corrélation exacte ne ferme jamais « la dernière location » supposée.

## Échec après paiement

Ne pas afficher de succès. Ouvrir un incident, demander le remboursement idempotent, informer le kiosque et permettre une reprise manuelle auditée. La réconciliation périodique compare l'état local, Stripe et ChargeNow.

## Activation

Tester d'abord lecture seule et authentification, puis une borne de staging. Les mutations et paiements live restent désactivés par défaut. Voir `HARDWARE_INTEGRATION.md` pour les limites du protocole série.
