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
| Android | workflow GitHub manuel sur `b59b6b8` | `testDebugUnitTest`, `lintDebug` et `assembleDebug` réussis |

## Couverture kiosk à six chiffres

- L'artefact debug staging contrôlé fait 912 980 octets et son SHA-256 est `b8b7f51f689cfa49a2a1d6f7a55e37b8c04475fb4e7a1c61e41b388001d76468`.
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
- APK debug staging : construit par GitHub Actions, archive contrôlée et non installée. Une vérification `apksigner` est ajoutée au workflow manuel et doit être prouvée par la prochaine exécution.
- Génération d'un code réel : différée pour ne pas le laisser expirer avant la
  saisie sur la tablette.
