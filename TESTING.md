# Tests

## Local

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
deno check supabase/functions/*/index.ts
deno test --allow-read --allow-env supabase/functions/tests/
cd android-kiosk
./gradlew testDebugUnitTest lintDebug assembleDebug lintRelease assembleRelease bundleRelease
```

Les contrats PostgreSQL exigent une base jetable : utiliser les scripts `supabase/tests/*.sql`. Ne pas les exécuter contre la production.

## Validation ciblée préproduction v3

La PR de hardening contient un workflow sûr et sans secrets : `.github/workflows/pre-production-v3-financial-ci.yml`.

Il s'exécute sur la PR vers `main` et peut aussi être lancé manuellement depuis GitHub Actions. Il ne fait aucun write Supabase, aucun appel Stripe, aucun appel ChargeNow et aucune commande matérielle.

Équivalent local exact :

```bash
npm ci
npm run typecheck
npx vitest run \
  src/test/pilotPricingV3.test.ts \
  src/test/memberPrepaidRail.test.ts \
  src/test/legalContract.test.ts \
  src/test/preProductionHardening.test.ts

deno test --allow-read --no-check \
  supabase/functions/tests/pricing_settlement_v2.test.ts \
  supabase/functions/tests/pricing_settlement_v3.test.ts \
  supabase/functions/tests/pre_production_hardening_contract.test.ts

npm run build
```

Le `npm run build` exécute aussi les garde-fous kiosk du `prebuild` avant le build Vite.

Le workflow ciblé vérifie donc : TypeScript, contrats Vitest v3/prépayé/juridique/hardening, calcul pricing Deno v1/v2/v3 concerné et build avec garde-fous kiosk. Les tests nécessitant une base PostgreSQL, des secrets, Stripe TEST ou du matériel restent des gates séparés et explicites.

## Stripe test

Checkout carte réussi/refusé/expiré, événement invalide/dupliqué/asynchrone, montant/devise/snapshot incohérents, capture partielle, remboursement partiel/total et complément nécessitant authentification. Apple Pay/Google Pay exigent appareil/navigateur/domaine compatibles ; TWINT dépend de l'activation du compte.

## ChargeNow/matériel

Test uniquement sur environnement fournisseur et borne isolée : auth, statut, stock, commande, double commande, timeout, éjection, callback, retour, batterie/slot incorrects et réconciliation. Aucun test automatique n'éjecte une batterie réelle.

## Android

Boot, lock-task, plein écran, arrière bloqué, origine externe/TLS invalide, réseau perdu, watchdog, token révoqué, nouvel appairage, USB absent, protocole non configuré, JWS invalide/expiré/rejoué et build release signé.

## Preuve

Une CI verte prouve le code testé, pas un paiement live, une migration staging ou une action matérielle. Consigner les tests manuels avec date, opérateur, environnement, IDs non secrets et résultat.
