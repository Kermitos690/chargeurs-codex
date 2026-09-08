# Chargeurs.ch Product Command Center

## Mission

Le Product Command Center est l'interface de décision produit et opérationnelle de Chargeurs.ch.

L'accueil doit répondre à quatre questions, dans cet ordre :

1. Est-ce que Chargeurs.ch fonctionne ?
2. Est-ce que les bornes fonctionnent ?
3. Qu'est-ce qui doit être décidé maintenant ?
4. Quel est le prochain développement autorisé ?

Tout le reste est volontairement relégué au second niveau.

## Architecture d'affichage

Le Command Center ne repose pas sur un simple dashboard responsive.

- **Mobile portrait** : `CommandCenterMobileShell`, navigation basse et lecture séquentielle.
- **Large** : `CommandCenterLargeShell`, affichage simultané des quatre zones principales.
- **Téléphone paysage** : bascule vers le mode large à partir de 640 px de largeur utile.
- **Tablette** : mode large à partir de 768 px, y compris en portrait.
- **Desktop** : mode large.

La sélection est centralisée dans `useCommandCenterMode.ts` et couverte par des tests unitaires.

## Données

Le Command Center réutilise `admin-overview-read`.

Aucun KPI, revenu, incident, station ou preuve terrain ne doit être inventé pour remplir l'interface.

En l'absence de données, l'interface affiche explicitement une indisponibilité au lieu de produire une valeur de démonstration.

L'ancienne vue dense du Control Center est conservée sous `/admin/network-overview` comme écran d'analyse de niveau 2.

## Gouvernance produit

Décisions de développement :

- `FIX`
- `VALIDATE`
- `BUILD`
- `FREEZE`
- `PAUSE`
- `ARCHIVE`

Roadmap :

- `NOW`
- `NEXT`
- `LATER`
- `PARKED`

Maturité :

- `IDEA`
- `STARTED`
- `ADVANCED`
- `STAGING`
- `FIELD_PARTIAL`
- `PROVEN`

Gates :

- `PROTECTED_CORE_CHANGE_REQUIRED`
- `BUSINESS_DECISION_REQUIRED`
- `RELEASE_BLOCKED`

## Règle P0

Le Product Command Center ne doit jamais recommander une extension P3/P4 lorsqu'un incident critique du coeur de location demande une correction immédiate.

Le Protected Core couvre au minimum : paiement, autorisation, création de location, réservation de slot, éjection, inventaire physique, retour, settlement et sécurité.

## Lot 1

Le Lot 1 livre :

- shell mobile dédié ;
- shell large dédié ;
- bascule orientation/largeur testable ;
- accueil réduit à santé, bornes, décisions, développement ;
- conservation de la vue réseau détaillée ;
- réutilisation de la source opérationnelle existante ;
- types de gouvernance pour les lots suivants ;
- tests du mode d'affichage et de la priorité des décisions.

Aucune migration, logique Stripe, logique d'éjection, settlement, pricing, Ads player ou APK Android n'est modifiée dans ce lot.
