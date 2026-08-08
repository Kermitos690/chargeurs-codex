# Kiosk premium UX

## Parcours client

1. L’écran d’accueil présente les quatre emplacements physiques de la borne.
2. Le client sélectionne une batterie, puis voit le prix horaire calculé depuis le tarif actif.
3. La garantie n’est expliquée qu’à l’étape contractuelle de confirmation et dans Checkout ; elle ne concurrence ni le prix horaire ni le QR.
4. Checkout Stripe est hébergé et ouvert uniquement depuis le téléphone par QR.
5. Après un webhook Stripe vérifié, le kiosk affiche l’état confirmé par le serveur — jamais un succès déduit d’une redirection navigateur.

## Règles d’affichage

- `charge_percent` connu : pourcentage et jauge animée.
- valeur fournisseur ambiguë : `Niveau en vérification`, sans pourcentage inventé.
- batterie recommandée : seulement si le snapshot est frais, corroboré, éligible, auto-testé, à température normale et avec le niveau de charge le plus élevé.
- batterie sélectionnée : halo, retour tactile et animation courte.
- le mode publicité fractionné reste un aperçu volontaire : `/kiosk/DTA21269?layout=split`.

## Sécurité

Le QR ne contient que l’URL Checkout Stripe temporaire. Le kiosk ne présente pas de saisie de carte, NFC ni moyen de paiement local. Stripe reste obligatoirement en mode Test en staging.
