# Sécurité — exécution master

## Corrections appliquées

| Risque | Correction | Preuve | État |
|---|---|---|---|
| Appairage alphanumérique impraticable sur borne | Code strict à six chiffres avec zéro initial préservé | tests Deno et Android source | corrigé localement et staging |
| Réutilisation d'un code | Hash, expiration, liaison station/organisation, consumption atomique et renouvellement invalidant | migration + fonctions Edge | déployé staging |
| Brute force de code court | Limites sur appareil, station et origine hachée ; pause progressive ; aucun code brut journalisé | migration + test de contrat | déployé staging |
| Coût CI Android automatique | workflow diagnostic devenu manuel | workflow GitHub | corrigé |
| Route fournisseur non confirmée | retrait des appels vers hôte alternatif ; allowlist O1 GET uniquement | 179 tests Deno + déploiement Edge staging | déployé staging |
| Clé Stripe live utilisable malgré le flag | validation centralisée exigeant mode test, live=false et préfixe de clé test | 4 tests dédiés + 179 tests Edge | déployé staging |
| Webhook Stripe falsifié | secret `whsec_`, signature sur le corps brut et inbox idempotente | événement Stripe Test signé 200 ; requête sans signature 400 | déployé staging |
| Code kiosk consommé avant persistance tablette | pré-contrôle AndroidKeyStore/préférences, rotation locale unique de la seule clé Chargeurs invalide, puis lecture de confirmation | APK staging 1.0.15 : tests Android, lint staging, build et signature v2 | corrigé ; validation tablette requise |
| Écran bleu masquant une WebView valide | la WebView est ajoutée au-dessus du fond natif dans le code source, avec reprise contrôlée après erreur réseau de la page principale | CI GitHub `30846463013` : tests, lint staging, build et `apksigner verify` | corrigé ; validation tablette requise |

## Dépendances frontend

- `react-router-dom` a été mis à niveau de 6.30.4 à 7.18.1 après typecheck,
  68 tests frontend et build Vite réussis. Cette mise à niveau corrige les
  avis modérés affectant la branche 6 (redirection et désérialisation).
- L'audit npm du 3 août 2026 signale deux avis élevés pour la branche
  `react-router >=7.12.0 <8.3.0`, dont une alerte RSC. Le registre npm ne
  propose que 8.2.0 comme version plus récente, encore dans cette plage ; son
  « fix » 7.11.0 réintroduit quatorze avis antérieurs. Chargeurs.ch reste donc
  sur 7.18.1 : SPA Vite avec `BrowserRouter`, sans serveur, package ni import
  React Server Components. Le risque RSC n'est pas atteignable par le chemin
  déployé, mais l’alerte reste ouverte jusqu’à une version corrigée publiée.

## Risques résiduels

- La base staging a une dérive d'historique de migrations. Elle bloque un
  `db push` reproductible ; aucune réparation d'historique n'a été faite à
  l'aveugle.
- Les avis historiques React Router 6 sont supprimés par la mise à niveau
  7.18.1. Deux avis élevés de la chaîne RSC restent déclarés par npm alors
  qu’aucun chemin RSC ne fait partie de cette SPA. Surveiller le registre avant
  toute adoption de rendu serveur ou de RSC.
- L'APK staging 1.0.15 est construite, contrôlée et signée v2 en CI ; son
  comportement runtime (Keystore fournisseur, tactile, boot et WebView) reste
  à confirmer sur la tablette réelle. Le pré-contrôle évite désormais de
  consommer un nouveau code si ce stockage est indisponible.
- L’APK fournisseur peut être détectée uniquement par ses métadonnées Android.
  Son processus, son port série, ses fichiers et sa connexion persistante ne
  sont pas accessibles à Chargeurs.ch sans contrat fournisseur public ; toute
  tentative de contournement reste hors périmètre et bloquée.
- Aucun test matériel ni fournisseur mutatif n'a été exécuté ; les flags restent
  fermés (`CHARGENOW_MUTATIONS_ENABLED=false`, Stripe live désactivé, éjection
  matérielle désactivée).
- Le staging utilise actuellement la clé secrète standard du compte Stripe Test.
  Une clé restreinte dédiée reste préférable avant le pilote ; elle devra
  autoriser Checkout Sessions, Payment Intents, Payment Methods et refunds.
