# Rapport de tests — exécution master

Date : 31 juillet 2026 · environnement local et staging non destructif.

| Domaine | Preuve | Résultat |
|---|---|---|
| Frontend | `npm run test` | 68 tests réussis, 16 fichiers |
| TypeScript | `npm run typecheck` | réussi |
| Frontend production | `npm run build` | réussi ; avertissement de bundle > 500 kB à traiter |
| Lint | `npm run lint` | 0 erreur ; 13 avertissements préexistants |
| Edge Functions | `npm run test:integration` | 175 tests réussis |
| Enrollment ciblé | `deno test ...kiosk_enrollment.test.ts` | 6 tests réussis |
| Staging kiosk | POST malformé vers `kiosk-enroll` | HTTP 400 contrôlé |
| Android | Gradle avec JDK 17 | JDK validé ; SDK 36 non installé car licence non acceptée |

## Couverture kiosk à six chiffres

- Code numérique exactement six chiffres, y compris `004821` : testé.
- Longueur incorrecte, lettres, espaces et décimales : refusés par tests.
- Hash SHA-256 uniquement en persistance : vérifié par inspection et test.
- Code à usage unique, lié à l'organisation et à la station : logique backend
  existante préservée ; test d'intégration distant avec code réel encore requis.
- Limites appareil, station et origine réseau : migration staging appliquée ;
  test SQL réel à exécuter après création contrôlée d'un code.

## Non exécuté volontairement

- Paiement Stripe live ou test avec carte.
- Mutation ChargeNow, éjection, redémarrage ou firmware.
- Android APK, lint Android et tests Android : attente de la licence SDK.
- Génération d'un code réel : différée pour ne pas le laisser expirer avant la
  saisie sur la tablette.
