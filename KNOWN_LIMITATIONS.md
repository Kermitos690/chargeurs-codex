# Limites connues

## Bloquants externes

- Le protocole série BJP/DTA/RS485 et l'API locale autorisée ne sont pas fournis. L'application Android détecte le matériel en lecture seule mais refuse toute éjection locale (`NOT_CONFIGURED`).
- Le secret ChargeNow officiel n'est volontairement pas présent dans le dépôt. Il est configuré dans le coffre Supabase staging pour les synchronisations Edge en lecture seule ; il ne doit jamais être recopié ailleurs.
- Les clés Stripe test ne sont pas disponibles dans cette session. Le staging Supabase et l'hébergement Vercel existent ; aucun environnement Supabase de production n'a été créé.
- Aucun test physique ni paiement live n'a été exécuté automatiquement.
- La release Android de production exige la clé de signature du propriétaire.

## Fonctionnel

- Stripe Terminal reste optionnel et non intégré dans la nouvelle APK ; Checkout QR est complet côté code.
- Les promotions, coupons et carte Wallet fidélité sont des extensions futures et ne font pas partie du calcul tarifaire v1.
- Les pages partenaires ont un formulaire et une isolation d'organisation, mais un portail partenaire métier dédié plus riche que le back-office interne reste à étendre.
- Les traductions allemand/italien/anglais utilisent l'architecture i18n existante mais toutes les nouvelles pages juridiques/opérationnelles ne sont pas traduites.
- Les informations juridiques de l'exploitant doivent être complétées et validées.

## Validation

Les migrations et tests SQL ont été exécutés sur le staging Supabase. Ils ne prouvent ni l'éligibilité Apple Pay/Google Pay/TWINT, ni une commande ChargeNow, ni la compatibilité de la carte de contrôle. Ces éléments portent les statuts `TERMINÉ — CLÉ EXTERNE REQUISE`, `TERMINÉ — TEST MATÉRIEL REQUIS` ou `BLOQUÉ PAR FOURNISSEUR` dans le rapport final.
