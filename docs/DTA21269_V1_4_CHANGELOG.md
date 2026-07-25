# DTA21269 analyzer v1.4.0

- ajoute le décodage borné des `class_data_item` et `code_item` DEX ;
- décode les instructions `invoke-*` et les références `const-string` ;
- construit un graphe d’appels statique et des chemins racine → sortie série ;
- affiche les chemins et éléments de preuve dans une activité Android dédiée ;
- exporte un rapport JSON `schemaVersion: 3` ;
- ajoute des tests unitaires des largeurs d’instructions et payloads Dalvik ;
- conserve toutes les protections : aucune exécution fournisseur, aucun secret, aucun accès série, aucun octet écrit et aucune éjection.
