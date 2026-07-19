# Runbook d'exploitation

## Début de journée

Contrôler le tableau de bord : bornes hors ligne, stock, locations actives anormalement longues, paiements en attente, remboursements et incidents critiques. Vérifier la fraîcheur du dernier webhook Stripe et des callbacks ChargeNow.

## Borne hors ligne

Ne pas lancer de location. Vérifier Internet/alimentation, dernière synchronisation et version APK. Redémarrer l'application depuis le diagnostic, puis la tablette si la politique appareil le permet. Si le matériel reste absent, créer une tâche de maintenance.

## Paiement sans batterie

Rechercher par code public/Checkout/PaymentIntent. Confirmer le webhook et l'absence d'éjection. Laisser le mécanisme automatique rembourser ; si nécessaire, utiliser l'action admin idempotente. Ne jamais éjecter simplement parce que le client montre une page succès.

## Retour non détecté

Noter station, slot, batterie et heure. Vérifier l'inbox ChargeNow et la corrélation exacte. Ne pas attribuer le retour à la dernière location supposée. Réconcilier seulement avec des preuves concordantes.

## Nouvelle tablette

Suivre `KIOSK_PROVISIONING.md`. Un code expiré ou consommé doit être remplacé, jamais réactivé. Révoquer l'ancien terminal lors d'un remplacement.

## Changements tarifaires

Dupliquer ou versionner le profil, simuler plusieurs durées/retour/non-retour, publier puis affecter. Les locations en cours gardent leur snapshot.

## Fin de journée

Rapprocher les paiements/règlements/remboursements, fermer les incidents résolus, exporter les métriques nécessaires et laisser les mutations live désactivées en cas d'anomalie non expliquée.
