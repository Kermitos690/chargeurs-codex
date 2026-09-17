# Première version visuelle — Caisse

## Objectif
Créer une page de démonstration autonome au format borne 1280×720, immédiatement testable, sans aucun appel paiement, matériel, location ou base de données.

## Interface
- Ajouter une route dédiée `/caisse-preview`, totalement séparée des routes `/kiosk` existantes.
- Composer un écran sombre premium Chargeurs.ch avec en-tête « Caisse », statut borne et statut WisePad 3.
- Afficher un montant CHF central, un pavé numérique tactile, les raccourcis 5/10/20/50 CHF, correction et remise à zéro.
- Ajouter un bouton principal « Encaisser » et un retour visuellement protégé vers le mode Location.
- Prévoir des écrans distincts et lisibles pour READY, CONNECTING, PROCESSING, SUCCESS, DECLINED et CANCELLED.
- Sur succès, afficher le montant et « Nouvelle vente » ; sur refus, « Réessayer » ; sur annulation, retour propre à la caisse.

## Simulation sûre
- Tous les états restent dans la mémoire de la page et sont pilotables avec un sélecteur de démonstration discret.
- « Encaisser » lance uniquement une courte séquence visuelle simulée, sans Stripe Terminal ni appel réseau.
- Le retour vers Location ouvre une confirmation avant navigation afin d'éviter une fausse manipulation.

## Détails techniques
- Créer une page et une feuille de styles dédiées pour éviter toute interaction avec les styles et flux de location.
- Réutiliser les composants de boutons et les tokens sémantiques Chargeurs.ch.
- Ajouter uniquement la nouvelle route dans le routeur existant ; ne modifier aucune logique kiosk, Stripe, ChargeNow ou Android.
- Vérifier le rendu et les interactions à 1280×720 avec le navigateur, puis exécuter les tests frontend ciblés.
