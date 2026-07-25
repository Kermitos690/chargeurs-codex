# DTA21269 DEX call-graph analyzer

Version pilote : `1.4.0-local`

## Objectif

Passer de l’inventaire DEX ciblé à un graphe d’appels statique permettant de rechercher des chemins entre :

- `PaymentEndActivity` et `initBatteryRental` ;
- les appels série `getCommPort`, `openPort`, `setComPortParameters`, `writeBytes` et `readBytes`.

## Méthode

L’analyseur lit passivement les fichiers `classes*.dex` de l’APK installée `com.szbjkj.bajietouchpower` et décode, avec des limites strictes :

- les tables de chaînes, types, prototypes, méthodes et classes ;
- `class_data_item` et les méthodes possédant un `code_item` ;
- les instructions Dalvik `invoke-*` ;
- les références `const-string` utiles au contexte série ;
- les chemins dirigés racine → sortie série, limités en profondeur.

Le rapport JSON `schemaVersion: 3` contient les racines, sorties, chemins, arêtes proches et éléments de preuve par méthode.

## Limites honnêtes

Un chemin statique montre qu’une méthode peut en appeler une autre. Il ne prouve pas que le chemin est exécuté pendant une location réelle, ne reconstitue pas automatiquement les valeurs calculées à l’exécution et ne démontre pas le contenu d’une trame série.

Les champs suivants restent donc explicitement fermés :

- `protocolSolved: false` ;
- `payloadRecovered: false` ;
- `serialPortOpened: false` ;
- `serialBytesWritten: 0` ;
- `physicalEjectionEnabled: false`.

## Sécurité

L’analyseur :

- ne lance aucun code fournisseur ;
- ne copie pas l’APK fournisseur ;
- ne lit aucun secret ;
- n’ouvre pas `/dev/ttyS1` ;
- n’envoie aucun octet au PCB ;
- s’installe à côté de BajieTouchPower et de Chargeurs FreeTest.
