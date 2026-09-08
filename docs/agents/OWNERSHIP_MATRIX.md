# Matrice de responsabilités

Une capacité a un seul propriétaire principal. Les contributeurs peuvent lire ou
aider via un handoff, mais ne deviennent pas propriétaires par proximité ou
simple modification de fichier.

| Domaine | Propriétaire principal | Contributeurs autorisés | Relecteur / validateur | Gate de release | Handoff vers |
| --- | --- | --- | --- | --- | --- |
| Gouvernance, WIP et contrôle des collisions | A0 | A1, A8 | A0 | A0 | propriétaire concerné |
| Architecture produit et contrats inter-domaines | A1 | A0, A2, A4, A7, A8 | A1 | A8 si impact release | propriétaire du domaine |
| Pricing, Checkout, PaymentIntent et contrats de settlement | A2 | A3, A8 | A2 + A1 pour Protected Core | A8 | A4 pour projections |
| Cycle de location et intention de commande hardware | A2 après handoff RCA A3 | A3, A7, A8 | A2 + A1 | A8 | A4 pour présentation |
| Analyse de cause racine et correction minimale | A3 | propriétaire concerné | A3 | A8 si livré | propriétaire réel |
| Présentation, navigation et états Kiosk | A4 | A5, A6, A2/A3 comme sources de vérité | A4 | matrice physique A8 | A8 |
| Campagnes, playlists, médias et lecture Advertising | A5 | A4, A8 | A5 | A8 si déployé | A4 |
| Primitives 3D/motion et dégradation sûre | A6 | A4, A8 | A4 pour sémantique Kiosk ; A6 pour qualité de primitive | A8 si lié à une release | A4 |
| Inventory, preuve fournisseur et vérité des assets sérialisés | A7 | A2, A3, A8 | A7 | A8 pour readiness terrain | A9 pour capacité |
| Intégration, identité de release, rollback et QA physique | A8 | chaque propriétaire apporte les preuves | A8 | A8 | A0 / décision humaine de release |
| Growth, lieux, événements et partenariats | A9 | A7, A1/A2, A8 | A9 + propriétaire de vérité requis | A8 pour readiness | décision métier humaine |

## Frontières de sécurité

- Le Kiosk affiche les prix mais ne possède ni ne calcule la vérité de facturation.
- Advertising peut lire un contrat explicite de surface Kiosk mais ne peut pas affecter une transaction de location. `AD_FAILURE = NO_AD`, jamais une panne de location.
- Inventory peut observer les événements physiques mais ne peut pas réécrire l’état de location ni émettre des commandes hardware.
- Growth ne peut pas promettre capacité, readiness de release, prix, conditions, remboursements ou fonctionnalité sans source de vérité pertinente et approbation métier humaine.
- Un propriétaire de release valide les preuves ; seul un humain autorise la production lorsqu’une décision métier ou un risque externe est concerné.
