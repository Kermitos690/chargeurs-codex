# Accès à la revue Chargeurs.ch depuis GitHub

Cette revue ne dépend pas de Lovable. Le code, le lancement et le déploiement proviennent exclusivement du dépôt GitHub `Kermitos690/chargeurs-codex` et de la branche `integration/chargeurs-beta-platform`.

## Accès recommandé : GitHub Codespaces

Ouvrir :

`https://codespaces.new/Kermitos690/chargeurs-codex?ref=integration/chargeurs-beta-platform&quickstart=1`

Le fichier `.devcontainer/devcontainer.json` :

- installe les dépendances ;
- démarre Vite sur le port 8080 ;
- ouvre automatiquement la prévisualisation ;
- active le routage hash ;
- utilise uniquement des variables fictives sans accès Supabase ;
- n’enregistre aucun service worker kiosk.

Dans la prévisualisation, ouvrir :

- `#/review` — vue générale ;
- `#/review/site` — site public ;
- `#/review/client` — compte client de démonstration ;
- `#/review/admin` — administration de démonstration ;
- `#/review/kiosk` — écran borne de démonstration.

Aucun identifiant ou mot de passe n’est nécessaire pour ces pages.

## Accès GitHub Pages

Le workflow `.github/workflows/github-review-preview.yml` construit et publie automatiquement la branche avec :

- lint ;
- typecheck ;
- build Vite ;
- valeurs Supabase fictives ;
- PWA désactivée ;
- vérification de l’absence de clés Stripe ou ChargeNow ;
- déploiement GitHub Pages.

Adresse attendue après activation réussie de GitHub Pages :

`https://kermitos690.github.io/chargeurs-codex/#/review`

Pour un dépôt privé, la disponibilité de GitHub Pages dépend du plan et des réglages du compte GitHub. Codespaces reste la solution GitHub-only de secours.

## Sécurité du mode revue

Le mode revue est strictement en lecture seule :

- aucune authentification réelle ;
- aucune requête vers la base Supabase réelle ;
- aucune autorisation ou capture Stripe ;
- aucun remboursement réel ;
- aucune commande ChargeNow ;
- aucune éjection de batterie ;
- données client et administrateur entièrement fictives.
