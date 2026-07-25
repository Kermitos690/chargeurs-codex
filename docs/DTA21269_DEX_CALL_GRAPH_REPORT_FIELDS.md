# Champs du rapport DEX call graph

Le rapport `schemaVersion: 3` est strictement statique et en lecture seule.

## Résultats principaux

- `roots` : méthodes correspondant à `PaymentEndActivity` ou `initBatteryRental` ;
- `sinks` : références vers les méthodes série ciblées ;
- `paths` : chemins d’appels dirigés, limités à neuf arêtes ;
- `relevantEdges` : voisinage des racines et des sorties série ;
- `methodEvidence` : appels et chaînes DEX référencés dans les méthodes pertinentes ;
- `pathStatus` : distingue chemin trouvé, éléments non connectés, racines seules, sorties seules ou aucune correspondance.

## Interprétation

`PATHS_FOUND` signifie uniquement qu’un chemin statique existe dans le bytecode analysé. Cela ne prouve ni son exécution lors d’une location, ni la valeur des arguments transmis, ni le contenu final des octets série.

Les garanties de sécurité restent inscrites dans chaque export : aucune exécution fournisseur, aucun port série ouvert, aucune écriture et aucune éjection physique.
