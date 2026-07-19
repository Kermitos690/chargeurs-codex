# Limites connues

## Bloquants externes

- Le protocole série BJP/DTA/RS485 et l'API locale autorisée ne sont pas fournis. L'application Android détecte le matériel en lecture seule mais refuse toute éjection locale (`NOT_CONFIGURED`).
- Les endpoints/identifiants ChargeNow réels et leur environnement test ne sont pas disponibles dans le dépôt.
- Aucun compte Stripe test/live, projet Supabase staging/production, domaine, DNS ou hébergeur de production n'a été fourni dans cette session.
- Aucun test physique ni paiement live n'a été exécuté automatiquement.
- La release Android de production exige la clé de signature du propriétaire.

## Fonctionnel

- Stripe Terminal reste optionnel et non intégré dans la nouvelle APK ; Checkout QR est complet côté code.
- Les promotions, coupons et carte Wallet fidélité sont des extensions futures et ne font pas partie du calcul tarifaire v1.
- Les pages partenaires ont un formulaire et une isolation d'organisation, mais un portail partenaire métier dédié plus riche que le back-office interne reste à étendre.
- Les traductions allemand/italien/anglais utilisent l'architecture i18n existante mais toutes les nouvelles pages juridiques/opérationnelles ne sont pas traduites.
- Les informations juridiques de l'exploitant doivent être complétées et validées.

## Validation

Les tests locaux ne prouvent ni l'application des migrations sur un Supabase distant, ni l'éligibilité Apple Pay/Google Pay/TWINT, ni une commande ChargeNow, ni la compatibilité de la carte de contrôle. Ces éléments portent les statuts `TERMINÉ — CLÉ EXTERNE REQUISE`, `TERMINÉ — TEST MATÉRIEL REQUIS` ou `BLOQUÉ PAR FOURNISSEUR` dans le rapport final.
