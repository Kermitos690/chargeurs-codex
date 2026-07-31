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
| Android | workflow GitHub manuel sur `f9822ce` | `testDebugUnitTest`, `lintDebug`, `assembleDebug` et `apksigner verify` réussis |
| React Router 7.18.1 | typecheck, Vitest, build Vite | 68 tests réussis ; SPA sans RSC |
| Gateway ChargeNow | `npm run test:integration` | 175 tests réussis ; O1 GET seul autorisé vers le fournisseur |

## Couverture kiosk à six chiffres

- L'artefact debug staging contrôlé fait 912 980 octets et son SHA-256 est `6bd42cfe274ce87ca1147c76a1535ae2fe6d7f17c70ea936364e5a1cf684f6e2`. La vérification APK v2 est réussie ; aucune installation ni publication n'a été effectuée.
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
- APK debug staging : construit et vérifié par GitHub Actions, puis copié localement dans `/Users/k4n/Downloads/Chargeurs_CH_Kiosk_Staging_f9822ce.apk`. Il reste non installé et non publié.
- Génération d'un code réel : différée pour ne pas le laisser expirer avant la
  saisie sur la tablette.
