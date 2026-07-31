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

## Dépendances frontend

- `react-router-dom` a été mis à niveau de 6.30.4 à 7.18.1 après typecheck,
  68 tests frontend et build Vite réussis. Cette mise à niveau corrige les
  avis modérés affectant la branche 6 (redirection et désérialisation).
- L'audit npm signale encore deux avis élevés limités au mode React Server
  Components de React Router 7. Chargeurs.ch est une SPA Vite avec
  `BrowserRouter` et ne référence aucun package ou serveur RSC ; ces avis ne
  sont donc pas applicables au chemin déployé. Ils restent à revoir avant toute
  adoption de RSC ou d'un rendu serveur React Router.

## Risques résiduels

- La base staging a une dérive d'historique de migrations. Elle bloque un
  `db push` reproductible ; aucune réparation d'historique n'a été faite à
  l'aveugle.
- Les avis modérés React Router 6 sont supprimés par la mise à niveau 7.18.1.
  npm signale encore deux avis React Server Components ; aucun serveur, module
  ou import RSC n'est utilisé par cette SPA, mais cela doit être réévalué avant
  toute adoption de RSC.
- L'APK ne peut pas encore être construit localement faute de licence SDK
  Android acceptée. Aucune assertion sur son comportement runtime n'est faite.
- Aucun test matériel ni fournisseur mutatif n'a été exécuté ; les flags restent
  fermés (`CHARGENOW_MUTATIONS_ENABLED=false`, Stripe live désactivé, éjection
  matérielle désactivée).
- Le staging utilise actuellement la clé secrète standard du compte Stripe Test.
  Une clé restreinte dédiée reste préférable avant le pilote ; elle devra
  autoriser Checkout Sessions, Payment Intents, Payment Methods et refunds.
