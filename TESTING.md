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

Dernière validation locale de livraison : 68 tests Vitest et 160 tests Deno réussis, builds web et Android réussis, audit npm production à 0 vulnérabilité. Les tests SQL n'ont pas été exécutés pendant cette session faute de serveur jetable ; ils restent un gate obligatoire de staging.

## Stripe test

Checkout carte réussi/refusé/expiré, événement invalide/dupliqué/asynchrone, montant/devise/snapshot incohérents, capture partielle, remboursement partiel/total et complément nécessitant authentification. Apple Pay/Google Pay exigent appareil/navigateur/domaine compatibles ; TWINT dépend de l'activation du compte.

## ChargeNow/matériel

Test uniquement sur environnement fournisseur et borne isolée : auth, statut, stock, commande, double commande, timeout, éjection, callback, retour, batterie/slot incorrects et réconciliation. Aucun test automatique n'éjecte une batterie réelle.

## Android

Boot, lock-task, plein écran, arrière bloqué, origine externe/TLS invalide, réseau perdu, watchdog, token révoqué, nouvel appairage, USB absent, protocole non configuré, JWS invalide/expiré/rejoué et build release signé.

## Preuve

Une CI verte prouve le code testé, pas un paiement live ou une action matérielle. Consigner les tests manuels avec date, opérateur, environnement, IDs non secrets et résultat.
