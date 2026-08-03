# Rapport de tests — exécution master

Date : 31 juillet 2026 · environnement local et staging non destructif.

| Domaine | Preuve | Résultat |
|---|---|---|
| Frontend | `npm run test` | 68 tests réussis, 16 fichiers |
| TypeScript | `npm run typecheck` | réussi |
| Frontend production | `npm run build` | réussi ; avertissement de bundle > 500 kB à traiter |
| Lint | `npm run lint` | 0 erreur ; 12 avertissements préexistants |
| Edge Functions | `npm run test:integration` | 179 tests réussis |
| Enrollment ciblé | `deno test ...kiosk_enrollment.test.ts` | 6 tests réussis |
| Staging kiosk | POST malformé vers `kiosk-enroll` | HTTP 400 contrôlé |
| Android | workflow GitHub manuel sur `f9822ce` | `testDebugUnitTest`, `lintDebug`, `assembleDebug` et `apksigner verify` réussis |
| Android 1.0.6 | Java 17 local | `testDebugUnitTest`, `lintStaging`, `assembleStaging` et signature v2 réussis |
| Android 1.0.7 | Java 17 local | build propre : 14 tests, `lintDebug`, `lintStaging`, `assembleDebug`, `assembleStaging`, signature v2 et scan de marqueurs de secrets réussis |
| React Router 7.18.1 | typecheck, Vitest, build Vite | 68 tests réussis ; SPA sans RSC |
| Gateway ChargeNow | `npm run test:integration` | 179 tests réussis ; O1 GET seul autorisé vers le fournisseur |
| Stripe runtime | tests ciblés + suite Edge | 4 nouveaux tests fail-closed ; clé live, mode non-test et secret webhook absent refusés |
| Stripe webhook staging | événement Test `checkout.session.expired` | livraison signée `200 OK`, 31 juillet 2026 à 16:42 CEST |
| Récupération inter-navigateur | typecheck, 68 tests, build Vite et inspection du bundle staging | client recovery implicite/non persistant servi ; aucun e-mail de test envoyé |
| Orientation administrateur | typecheck, 68 tests, build Vite et Vercel staging `dpl_FYKwaeo9daMJUzjSpbtxBETcg8QC` | un rôle de back-office est dirigé vers `/admin`; chargement/erreur dashboard visibles |
| Portail client & borne publique | Vitest, typecheck, build Vite | 76 tests réussis ; routes compte et borne publique sans fallback de démonstration |
| Checkout lié au kiosk | `deno check` + contrats ciblés | 47 tests réussis : kiosk, station et location doivent correspondre avant création ou divulgation de Checkout |
| Centre de test expurgé | Vitest, typecheck, build Vite | 78 tests réussis dans 20 fichiers ; logs filtrés par corrélation et expurgés avant export |

## Couverture kiosk à six chiffres

- L'artefact debug staging contrôlé fait 912 980 octets et son SHA-256 est `6bd42cfe274ce87ca1147c76a1535ae2fe6d7f17c70ea936364e5a1cf684f6e2`. La vérification APK v2 est réussie ; aucune installation ni publication n'a été effectuée.
- Code numérique exactement six chiffres, y compris `004821` : testé.
- Longueur incorrecte, lettres, espaces et décimales : refusés par tests.
- Hash SHA-256 uniquement en persistance : vérifié par inspection et test.
- Code à usage unique, lié à l'organisation et à la station : logique backend
  existante préservée ; test d'intégration distant avec code réel encore requis.
- Limites appareil, station et origine réseau : migration staging appliquée ;
  test SQL réel à exécuter après création contrôlée d'un code.

## Persistance locale APK 1.0.7

- Le scénario réel « code accepté côté serveur, token non enregistré côté
  tablette » a été constaté avec l’APK 1.0.5 : le code est alors consommé et
  l’appareil créé sans heartbeat local.
- Avant tout POST d’enrôlement, 1.0.7 effectue désormais un aller-retour
  AES-GCM AndroidKeyStore et un test d’écriture/suppression de préférence non
  sensible. Le bouton **Activer** est désactivé tant que ce contrôle échoue.
- Si l’alias appartenant uniquement à Chargeurs est invalide, le build tente
  une seule rotation locale et contrôle de nouveau l’écriture. Aucun fallback
  en clair n’existe.
- Après une réponse serveur, le token est relu et comparé avant l’ouverture du
  kiosk. Un échec post-réponse efface le code visuel et demande un nouveau code,
  au lieu d’inciter l’opérateur à réessayer un code déjà consommé.

## Non exécuté volontairement

- Paiement Stripe live ou test avec carte. Le webhook Stripe Test signé a été
  validé séparément, sans paiement ni autorisation bancaire.
- Mutation ChargeNow, éjection, redémarrage ou firmware.
- APK staging 1.0.7 : construit et vérifié localement, puis copié dans
  `/Users/k4n/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.7-staging.apk`.
  Aucun appareil ADB n’était connecté, donc installation et test tactile restent
  physiques et documentés.
- Génération d'un code réel : différée pour ne pas le laisser expirer avant la
  saisie sur la tablette.

## Diagnostic fournisseur intégré à l’APK 1.0.6

- `VendorAppCompatibilityTest` : 3 tests unitaires réussis ; l’APK fournisseur
  absente, désactivée ou présente sans pont public sont distinguées sans
  présumer de son état de connexion.
- Les tests ChargeNow de contrat (13) et de callbacks (11) réussissent en mock
  sécurisé : code métier non nul refusé, callbacks sans secret refusés, retour
  incomplet sans transition de location.
- Aucune requête fournisseur réelle, mutation matérielle ou opération
  financière n’a été exécutée pour ces contrôles.
