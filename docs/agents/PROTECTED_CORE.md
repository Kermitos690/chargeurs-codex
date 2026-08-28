# Protected Core

Le Protected Core est l’ensemble des contrats où une facilité locale, un fallback
UI ou une réponse fournisseur non vérifiée peut provoquer un comportement erroné
de paiement, location, hardware, sécurité ou settlement.

## Registre protégé

| Capacité protégée | Propriétaire principal | Règle non négociable |
| --- | --- | --- |
| Résolution pricing serveur et snapshot immuable | A2 | le frontend ne peut pas calculer la vérité de facturation |
| Stripe Checkout, PaymentIntent, capture, remboursement et settlement | A2 | les preuves signées/côté serveur contrôlent l’état financier |
| Cycle de location et idempotence transactionnelle | A2 | transitions état/version côté serveur et idempotentes |
| Intention de commande hardware et mutation fournisseur d’éjection | A2 après RCA A3 | persister une intention autorisée avant une seule mutation fournisseur |
| Authentification et credentials de l’appareil Kiosk | A2 / propriétaire natif via RCA A3 | aucune fuite de credential ni fallback non sûr |
| Preuve de libération de batterie | A2 | l’accusé fournisseur n’est pas une preuve de libération physique |
| Corrélation de retour physique | A2 | batterie contractuelle exacte et preuve `BATTERY_IN` acceptée avant settlement |
| Gestion de non-retour | A2 | aucun timer ou supposition UI ne crée une décision de facturation |
| DB privilégiée, RLS, migrations et secrets | A2 | aucun bypass large pour déboguer ; secrets jamais dans logs ou UI |

## Gates de changement

Chaque changement de ce registre doit inclure `PROTECTED_CORE_CHANGE` dans sa PR
ou son handoff et fournir :

1. Preuve RCA A3 lorsque le travail provient d’un incident.
2. Implémentation du propriétaire A2 et tests ciblés.
3. Revue A1 pour impact sur contrat ou invariant inter-domaines.
4. Preuve d’intégration A8 et, si pertinent, validation physique exacte.
5. Approbation humaine explicite pour décision de politique métier ou risque externe.

Les éléments suivants sont interdits :

- fallback client qui affaiblit une règle serveur fail-closed ;
- succès de paiement, éjection, retour ou settlement piloté par timer ;
- seconde éjection automatique après résultat fournisseur ambigu ;
- settlement sans preuve de retour physique acceptée ;
- bypass sécurité/RLS utilisé comme correctif de production ;
- interprétation d’animation, état DOM, merge Git ou HTTP 200 comme preuve physique.
