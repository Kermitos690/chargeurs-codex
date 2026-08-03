# Chargeurs.ch — master execution status

## Initial state

- Branch: `agent/finalize-chargeurs-platform`
- Initial HEAD: `16b56e0cef930d92790877bc4064f22f3339510f`
- Working tree: clean
- Audit source: `Chargeurs_CH_Audit_ChargeNow_2026-07-31_V2.zip` (local, sanitized)
- Environment safety defaults: ChargeNow mutations disabled; Stripe test only; hardware ejection disabled.

## Active phase

P17 — APK kiosque staging 1.0.7 : persistance sécurisée de l’activation,
compatibilité tablette et diagnostic non intrusif du pont matériel fournisseur.

## Completed before this master execution

- Existing staging hardening, kiosk pairing renewal, DTA reconciliation and Android lint fixes are present in the branch history.
- ChargeNow audit V2 has been reviewed as an independent functional reference, not vendor backend evidence.
- Frontend targeted role/state tests: 14 passed.
- Deno kiosk enrollment and security tests: 9 passed.
- Full Deno Edge Function contract suite: 174 passed.
- Typecheck and production frontend build: passed.
- The Deno test scripts now declare `--allow-read`; source-inspection kiosk tests had been blocked only by the missing local test permission.
- Station detail now exposes station-first kiosk attribution using the existing, hashed, one-time, organization-bound pairing-code backend. It shows existing kiosks and supports administrative revocation; it does not create a provider or hardware mutation.
- The primary activation format is now exactly six numeric digits, including a leading zero. The Android provisioning screen now uses a dedicated touch keypad instead of an alphanumeric field; QR remains optional in the admin UI.
- A new additive migration adds a server-side attempt ledger, 10-minute device/station/source limits, progressive delay, and no-plaintext-code storage.
- Java 17 was found locally at Homebrew's `openjdk@17`; Gradle now starts successfully with it.
- The diagnostic Android GitHub workflow is manual-only; an Android source push no longer starts a paid hosted build automatically.
- The additive numeric-enrollment migration was applied directly to the dedicated staging project after source review because `db push` remains blocked by unrelated historical drift. It created only a private attempt ledger, indexes, additive columns and overloaded server-only redemption functions.
- Staging `kiosk-admin` and `kiosk-enroll` are deployed at function version 13. An intentionally malformed enrollment request returns controlled HTTP 400 / `INVALID_ENROLLMENT_REQUEST`; it neither generated nor consumed a code.
- The ChargeNow gateway is restricted to the explicitly approved `GET /rent/cabinet/query` call on the documented host. Alternate hosts and every supplier mutation are fail-closed; the coverage screen keeps their internal representations without claiming a live connection.
- Vercel staging was deployed successfully. `/`, `/admin`, `/kiosk/DTA21269` and the PWA manifest respond through `https://chargeurs-ch-staging.vercel.app`; see `docs/DEPLOYMENT_REPORT.md`.
- Stripe Test est configuré côté compte et Supabase : cartes, Apple Pay, Google
  Pay et TWINT activés, destination webhook limitée à sept événements, secrets
  dans le coffre Edge Functions. Les sept fonctions financières durcies sont en
  version 13 et un événement signé a reçu HTTP 200.

## Current work

- Android kiosk staging 1.0.4 was rebuilt locally on 2026-07-31 with Java
  17.0.19 and Android SDK 36. It has a native liquid-gradient splash,
  six-cell numeric activation keypad, large touch controls and an explicit
  no-ejection build flag. `testDebugUnitTest`, `lintDebug`, `lintStaging`,
  `assembleDebug` and `assembleStaging` passed. The copied staging APK is
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging.apk`.
- Exact hashes, application IDs, permissions and release-signing limitation are
  recorded in `docs/ANDROID_STAGING_BUILD_REPORT.md`. A debug APK copy is also
  available beside the staging artifact in `~/Downloads/Chargeurs_CH_APK/`.
- The artifact is debug-signed for staging only. `apksigner verify` confirms
  APK Signature Scheme v2. Its `applicationId` is
  `ch.chargeurs.kiosk.staging`, minSdk is 26 and targetSdk is 36.
- No Android device was attached (`adb` unavailable), so touch behaviour,
  boot receiver, Lock Task policy, Keystore persistence and a real QR scan are
  explicitly awaiting controlled physical validation.
- A follow-up staging rebuild (`r1`) adds a zero-size rendering guard for the
  animated background and a visible startup diagnostic when the tablet has no
  usable Android System WebView. `testDebugUnitTest`, `lintStaging` and
  `assembleStaging` passed. The replacement artifact is
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging-r1.apk`.
- A compatibility rebuild (`r2`) removes direct Android 30/33 window/back API
  references from the startup path and uses legacy immersive flags across the
  supported API range. `testDebugUnitTest`, `lintStaging` and
  `assembleStaging` passed. Artifact:
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging-r2.apk`.
- The installable hotfix is now versionCode 105 / versionName 1.0.5 so Android
  accepts it as an in-place update. Artifact:
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.5-staging.apk`.
- La version 1.0.6 (`versionCode=106`) est construite et vérifiée. Elle ajoute
  un diagnostic limité aux métadonnées de l’APK Bajie/ChargeNow et explique
  explicitement qu’une autre application Android ne peut pas réutiliser sa
  session série ou réseau. Artefact :
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.6-staging.apk` ; SHA-256
  `1227a3e51ba4aab90ba7c96bfe8948e6cd5f6f18f1b41120df2c61309225e994`.
- La vue de diagnostic frontend masque désormais entièrement le token kiosk et
  ne permet pas de le saisir manuellement lorsque l’application tourne dans
  l’enveloppe Android native.
- Après un essai réel, le backend a confirmé que le code six chiffres était
  accepté et liait bien une tablette à `DTA21269`, mais l’APK 1.0.5 ne pouvait
  pas enregistrer localement le token. La version 1.0.7 (`versionCode=107`)
  ajoute un pré-contrôle bloquant du Keystore et des préférences avant de
  consommer un code, une réparation unique limitée à la clé Chargeurs invalide,
  une vérification de lecture après écriture et un diagnostic sans token. Les
  tests unitaires (14), lint debug/staging, builds debug/staging et signature
  v2 passent localement. Artefact attendu :
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.7-staging.apk`.
- L’artefact 1.0.7 a été copié et contrôlé dans Downloads : 922 668 octets,
  SHA-256 `93dc4c4da9ea084bfae63b08adac502e65aa7318df380cee9e1c636c2de9328c`.
  Aucun appareil ADB n’était connecté au Mac lors du contrôle ; l’installation
  USB et la validation physique restent la prochaine étape.
- Le comportement local d’activation a été corrigé en 1.0.8 : après six
  chiffres, le bouton reste appuyable même si le pré-contrôle AndroidKeyStore
  n’est pas encore fini. Il affiche alors la raison et relance ce contrôle,
  sans jamais transmettre le code au serveur avant que le stockage chiffré soit
  prêt. `testDebugUnitTest`, `lintStaging` et `assembleStaging` sont réussis;
  l’APK debug-signée est
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.8-staging.apk`.
- Reconcile local and remote Supabase migration histories into a reproducible baseline before using `db push` again; the observed plan is in `docs/SUPABASE_MIGRATION_RECONCILIATION.md`.
- Installer l’APK staging `1.0.6` sur la tablette. Si elle s’arrête encore,
  relever le diagnostic visible (ou la version Android et l’état d’Android
  System WebView/Chrome), sans revenir à un APK plus ancien.
- React Router 7.18.1 has passed typecheck, the 68 frontend tests and the Vite build. Its remaining npm advisories concern React Server Components, a mode not used by this SPA; the exception is recorded in `docs/SECURITY_REPORT.md`.
- La suite Edge compte désormais 179 tests réussis. Un validateur central bloque
  toute clé Stripe live ou toute configuration qui ne fixe pas explicitement
  `STRIPE_MODE=test` et `STRIPE_LIVE_ENABLED=false`.

## Blockers

- Staging Supabase CLI access is confirmed for `xqepbqnaenoeyfjkjnzl`, but local and remote migration histories diverge: remote-only migrations `20260725042947`–`20260725050549` and `20260731055742`–`20260731055745`, plus local-only migrations `20260720003000`, `20260724060000`, `20260724061000` and the new numeric-enrollment migration. No migration-history repair or remote write was attempted.
- Provider mutations, Stripe live and physical hardware operations are explicitly disabled.
- The large multi-tenant extensions requested for MIFI, advertising, finance,
  franchises and the expanded role catalogue are not yet implemented. They are
  intentionally held behind the migration baseline: adding unreviewed tables or
  enum values while local and remote histories diverge would make staging less
  reproducible, not more complete.

## Tests and deployments

- Staging Supabase: additive kiosk migration applied directly; `kiosk-admin` and `kiosk-enroll` deployed. No production deployment, provider mutation, Stripe live action, hardware command or code redemption occurred.
- Vercel staging deployment is READY on `e47fdaf`. Local evidence is recorded in `docs/DEPLOYMENT_REPORT.md`, `docs/TEST_REPORT.md` and `docs/SECURITY_REPORT.md`.
- Existing lint command passes with 12 pre-existing warnings; strict zero-warning lint remains a technical-debt item outside this focused change.
- Java 17, Android SDK Platform 36 and Build Tools 36 are available locally. The current APK source builds with `testDebugUnitTest`, `lintDebug` and `assembleDebug`; an APK runtime test still requires a physical tablet.
- The former React Router 6 moderate advisories are removed by the 7.18.1 upgrade. npm still flags two React Server Components advisories; there is no RSC server, route module or import in the deployed SPA, but this must be reassessed before any future RSC adoption.

## Next operation

Installer `Chargeurs_CH_Kiosk_1.0.7-staging.apk` sur la tablette au-dessus de
la 1.0.5, attendre le statut « Stockage sécurisé prêt » depuis l’écran
d’activation, puis générer un **nouveau** code. Cette étape observe uniquement
les métadonnées de l’agent fournisseur et les candidats de ports ; elle ne doit
ni lancer ni arrêter l’agent Bajie/ChargeNow. Un pont physique complet reste
conditionné par un SDK, un service système ou un protocole DTA/RS485
officiellement documenté.

## APK staging 1.0.15 et recette WebView — 3 août 2026

- Le défaut d’écran bleu sur la borne a été corrigé dans le **code source
  Android** : la WebView est maintenant insérée durablement au-dessus du fond
  animé (`WEB_VIEW_LAYER_INDEX = 1`), et non par une réécriture temporaire en
  CI. Le wrapper recrée aussi la WebView lorsqu’une erreur de chargement de la
  page principale est suivie d’un rétablissement réseau.
- La candidate pilote est construite depuis la PR #42, commit
  `dc977c6ced53a2a0df2859d9d38241da1e13cc2e` : version `1.0.15-staging`,
  `versionCode=115`, applicationId `ch.chargeurs.kiosk.staging`.
- Preuve CI : workflow GitHub Actions `30846463013` vert —
  `testDebugUnitTest`, `lintStaging`, `assembleStaging` et
  `apksigner verify` réussis. APK :
  `Chargeurs_CH_Kiosk_1.0.15-staging.apk`, 928 360 octets, SHA-256
  `d0bf7c7129496820eb3153c2a8fa22528e5a8e9cbb5a756b6b52e51935229a88`.
- Cette APK reste debug-signée et réservée au staging. Le rendu, le tactile,
  le redémarrage matériel et la lecture du QR sur la DTA restent à valider
  physiquement ; aucune éjection ni mutation fournisseur n’est activée.

## Authentification staging et déploiement — 3 août 2026

- Les nouveaux liens de réinitialisation utilisent le client de récupération
  implicite isolé. Les liens PKCE historiques ouverts dans un autre navigateur
  ne divulguent plus une erreur Supabase : l’interface demande un nouveau lien.
- Tests locaux : 76 tests Vitest dans 19 suites et `npm run typecheck` réussis ;
  `npm run build` réussi (avertissement non bloquant : un bundle reste supérieur
  à 500 Ko minifié).
- Le commit `ab57f378d424f3bcb4f1e96b1c0d2cb52dc035db` est déployé explicitement
  sur le projet Vercel de staging :
  `dpl_9jhgwqJxp16XnY9MnaDKp8GFQRcq`, état `READY`, alias
  `https://chargeurs-ch-staging.vercel.app`. Le bundle public
  `index-BW752rl5.js` contient bien le message de récupération corrigé.
- `kiosk-enroll` répond depuis le projet staging avec HTTP 405/
  `METHOD_NOT_ALLOWED` à une requête GET sans code : la fonction est donc
  déployée et aucune donnée d’appairage n’a été créée ni consommée par ce test.
- La tentative de création/régularisation du compte propriétaire staging a été
  volontairement arrêtée par le contrôle d’autorisation de l’environnement :
  créer ou promouvoir durablement une adresse en `super_admin` exige une
  confirmation explicite distincte. Aucun compte, rôle ou invitation n’a été
  modifié pendant cette tentative.

## Kiosk Checkout et sécurité de sortie — 3 août 2026

- Le commit `189dbb9` lie désormais la création et la divulgation d’un Stripe
  Checkout à l’exact kiosk actif de la station de la location. Un kiosk révoqué,
  d’une autre station ou d’une autre organisation ne reçoit donc pas d’URL de
  paiement.
- Si un paiement staging est confirmé alors que l’éjection est désactivée, le
  cycle passe explicitement à `needs_support`, avec incident et audit
  idempotents. Il n’y a ni boucle d’attente, ni commande matérielle, ni
  remboursement automatique implicite.
- Validation locale : `deno check` des quatre modules concernés et 47 tests de
  contrats passés. Les fonctions `create-stripe-checkout`,
  `eject-after-payment` et `chargenow-admin` sont déployées vers
  `xqepbqnaenoeyfjkjnzl`. Les contrôles HTTP non mutables répondent
  respectivement `405`, `405` et `401`, confirmant leur publication.

## Coûts GitHub Actions — 3 août 2026

- Le workflow DTA qui échouait à chaque push a été rendu manuel dans le commit
  `0b0f65a` puis désactivé côté GitHub, avec douze anciens workflows de
  diagnostic/hotfix absents du dépôt courant. Les workflows conservés sont
  uniquement manuels ; aucun build ou déploiement ne démarre désormais sur un
  simple push de cette branche.

## Console Super Admin — opérations ChargeNow documentées (31 juillet 2026)

- Le rôle `super_admin` dispose désormais, via la console **Intégrations et
  couverture API**, d'un accès aux 35 opérations identifiées dans la
  documentation Open API ChargeNow. Les routes internes n'inventent pas
  d'endpoint fournisseur : `O7` reste explicitement
  `PROVIDER_ENDPOINT_MISSING`.
- La console lance aussi une suite de **16 lectures** séquentielles, avec des
  identifiants tirés uniquement des réponses appartenant à l'organisation. Une
  lecture de détail est marquée `sample_required` si aucune commande, stratégie
  ou boutique source n'est disponible ; elle n'est jamais devinée.
- Les mutations restent réservées à un super-admin authentifié. Une exécution
  réelle exige une confirmation saisie exactement, et le mode maintenance est
  requis pour les opérations dangereuses. L'activation globale
  `CHARGENOW_MUTATIONS_ENABLED` reste `false` : l'exception est limitée à la
  console serveur après contrôle du rôle et de cette confirmation, afin de
  préserver les parcours kiosque et paiement fail-closed.
- Vérification locale : `deno check`, 44 tests Deno (contrats fournisseur et
  matrice), typecheck TypeScript, 68 tests Vitest et build PWA réussis. Aucun
  appel fournisseur ni commande matérielle n'a été envoyé pendant cette
  vérification locale.

## Correctif d’orientation du compte administrateur — 31 juillet 2026

- Cause confirmée : le formulaire public « Mon compte » envoyait tout compte
  authentifié vers `/compte`, y compris un `super_admin`. Cette vue est
  volontairement centrée sur les locations client et ne présente pas la
  navigation du back-office.
- Le formulaire consulte désormais uniquement les rôles du compte connecté et
  envoie un rôle autorisé vers `/admin`; les comptes clients restent sur
  `/compte`. La protection RLS/backend de `/admin` reste l’autorité finale.
- La vue client affiche aussi un bouton explicite « Back-office » dès qu’un
  rôle administratif est confirmé. Le menu mobile admin affiche maintenant le
  libellé « Menu », pas seulement une icône.
- Le tableau de bord admin affiche un chargement et une alerte de lecture
  plutôt que des compteurs silencieusement vides lorsqu’une requête est refusée
  ou indisponible.
- Vérification locale : typecheck, 68 tests Vitest et build Vite réussis.

## Correctif d’accès staging — 31 juillet 2026

- La récupération de mot de passe PKCE échouait lorsqu’un lien demandé dans un
  navigateur était ouvert dans Gmail/Safari ou sur un autre appareil : le
  verifier PKCE n’existait pas dans ce stockage local.
- Commit `4450c1c` déploie un client de récupération isolé, implicite et non
  persistant pour les seuls e-mails de réinitialisation. Le déploiement Vercel
  staging `dpl_6qT4wpAM24wHauy6wXTt7FbqbAhd` est `Ready`.
- Les nouveaux liens doivent être demandés après ce déploiement ; les anciens
  liens PKCE restent volontairement invalides et ne sont pas réutilisables.

## Correctif de compatibilité du stockage sécurisé — 31 juillet 2026

- L’essai physique de l’APK 1.0.8 a atteint l’écran d’activation mais a
  signalé que le stockage sécurisé n’était pas prêt. Le code n’a donc pas été
  transmis à `kiosk-enroll` et n’a pas été consommé.
- L’APK staging 1.0.9 (`versionCode=109`) conserve l’exigence de stockage
  chiffré. Elle essaie d’abord AES/GCM dans AndroidKeyStore, puis, seulement si
  cette capacité est défaillante, chiffre le token avec une clé AES aléatoire
  enveloppée par une clé RSA privée maintenue dans AndroidKeyStore. Il n’existe
  aucun repli logiciel ou en clair.
- Les Diagnostics indiquent maintenant le mode de compatibilité employé et une
  catégorie d’erreur non sensible si les deux primitives Keystore échouent.
- Vérification locale réussie : `testDebugUnitTest`, `lintStaging` et
  `assembleStaging`; signature APK v2 vérifiée. Artefact debug-signé staging :
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.9-staging.apk` (903 Ko,
  SHA-256 `060ac4be44603b4ce361e2c0f51e26a289a80818e954ecc8e503e031e6195d6d`).
- Validation physique restante : installer 1.0.9 comme mise à jour, attendre
  le statut « Stockage sécurisé prêt », puis seulement générer et saisir un
  nouveau code à six chiffres. Si le statut reste indisponible, relever le
  bloc `secureStorage` des Diagnostics ; il ne contient ni token ni code.

## Correctif Keystore fondé sur le diagnostic tablette — 31 juillet 2026

- Le diagnostic physique de 1.0.9 confirme une `ProviderException` lors de la
  création AES AndroidKeyStore. L’APK fournisseur est présent, mais il ne
  fournit aucun pont public réutilisable à une autre application.
- L’APK staging 1.0.10 (`versionCode=110`) essaie désormais dans cet ordre :
  AES/GCM AndroidKeyStore strict, AES/GCM AndroidKeyStore compatible sans
  l’option Keymaster défaillante, puis AES aléatoire enveloppée par RSA dans
  AndroidKeyStore. Tous les chemins restent chiffrés ; aucun token en clair ou
  repli logiciel n’est ajouté.
- Les Diagnostics exposent aussi `attempts`, une synthèse sans données sensibles
  de chaque primitive testée, afin d’identifier exactement le prochain blocage
  si l’image Android ne fournit vraiment aucune primitive Keystore utilisable.
- Vérification locale réussie : `testDebugUnitTest`, `lintStaging`,
  `assembleStaging` et signature APK v2. Artefact :
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.10-staging.apk`,
  SHA-256 `df38c7dd6e43ba918872955e2feb4d48313e6e01b660caf4b3c0a3426cf34b20`.

## Mode de compatibilité autorisé pour la tablette staging — 31 juillet 2026

- Le propriétaire a explicitement autorisé une solution de compatibilité pour
  cette tablette, après confirmation que les variantes AES et RSA
  AndroidKeyStore échouent toutes par `ProviderException`.
- L’APK 1.0.11 utilise, uniquement en staging, un token AES/GCM dans le
  stockage privé de l’application. Sa clé est dérivée localement de l’Android
  ID propre à cette application, du certificat de signature, du package et
  d’un sel aléatoire par installation. L’Android ID n’est ni transmis, ni
  journalisé. Le token reste révocable côté serveur et l’intégrité est assurée
  par GCM. Cette option est explicitement désactivée dans le build release.
- Elle est moins résistante à une extraction depuis un appareil rooté que
  AndroidKeyStore ; ce risque est accepté pour le staging de cette tablette,
  mais ne doit pas être transposé à la production sans contrôle fournisseur.
- Vérification locale réussie : `testDebugUnitTest`, `lintStaging`,
  `assembleStaging` et signature APK v2. Artefact :
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.11-staging.apk`,
  SHA-256 `7d6a7059fa9cb95e0989295e827fa9459536f80c059cbe79a15ad5bb87b55401`.

## Correctif WebView après appairage — 31 juillet 2026

- L’appairage de DTA21269 a bien réussi et le kiosk a émis un heartbeat. Le
  plein écran bleu postérieur est donc un défaut de rendu WebView, non un
  échec du code à six chiffres.
- Le bundle Vite cible maintenant Chromium 61 (Android 8 / `minSdk 26`) ; le
  wrapper Android ne registre plus de service worker, ce qui évite qu’un cache
  PWA obsolète conserve un ancien app shell.
- Le WebView confirme désormais `kioskUiReady` après un état React utilisable.
  Sans ce signal sous 20 secondes, ou si le renderer s’arrête, l’APK affiche un
  diagnostic contrôlé au lieu d’un écran bleu vide. Les diagnostics indiquent
  le package et la version du WebView sans code, token ou secret.
- Vercel staging `dpl_7HwR6hLPG4tQBAVRWnWCbn65Q6bT` est `Ready` et l’alias
  `https://chargeurs-ch-staging.vercel.app` lui a été affecté.
- Vérifications réussies : typecheck, 68 tests Vitest, build Vite,
  `testDebugUnitTest`, `lintStaging`, `assembleStaging`, signature v2.
- APK : `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.12-staging.apk`
  (`versionCode=112`, `versionName=1.0.12-staging`, 927 364 octets, SHA-256
  `38bcbfcbc4c393af71fa4188f0ba0f9e50cd8e36d8618913c662c22ae875dc1d`).
  Elle conserve l’appairage 1.0.11 : aucun nouveau code n’est nécessaire.

## Correction de configuration Vercel et purge WebView — 31 juillet 2026

- Le déploiement staging initial `dpl_7HwR6hLPG4tQBAVRWnWCbn65Q6bT` était
  incomplet : il avait été construit dans un environnement Vercel personnalisé
  sans variables `VITE_SUPABASE_*`. Il a produit une page blanche
  `supabaseUrl is required` et ne doit plus être utilisé.
- Les seules variables publiques nécessaires au navigateur ont été configurées
  dans Vercel Preview. Le déploiement `dpl_6WbRftsof1cWc8VmCrxtUE2s7iUn` est
  `Ready`; l’alias staging pointe vers lui. La vérification HTTP confirme que
  le bundle public contient l’URL Supabase staging attendue, sans secret.
- Une installation 1.0.13 supprime une fois les données WebView/PWA obsolètes
  au changement de version puis force le premier chargement réseau. Le token
  d’appairage n’est pas dans WebView : `SecureConfigStore` et la liaison
  DTA21269 sont préservés.
- Artefact à tester :
  `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.13-staging.apk`
  (`versionCode=113`, 927 776 octets, SHA-256
  `cad022c28d3a74dc22e677c791bbb949c6ca3a02f7a383bf2aea5fcd959e0425`).
  `testDebugUnitTest`, `lintStaging`, `assembleStaging` et signature v2 ont
  réussi. Validation tablette toujours requise.

## Maîtrise des coûts GitHub Actions — 3 août 2026

- La répétition des courriels « run failed » provenait du workflow
  `DTA21269 battery qualification CI`, déclenché à chaque push de la branche
  pilote. Il est maintenant désactivé côté GitHub. Sa définition locale a été
  conservée mais ne peut plus être lancée que manuellement.
- Les anciens workflows de diagnostic, hotfix, synchronisation et validation
  ponctuelle qui n'ont plus de source active ont également été désactivés.
- Les workflows restant actifs dans ce dépôt sont tous `workflow_dispatch` :
  aucun push, aucune pull request et aucune planification ne doit lancer une
  exécution ou générer un nouveau courriel automatiquement.

## Catalogue de rôles source — 3 août 2026

- Le code source contient désormais le catalogue complet des rôles demandés
  (plateforme, opérations, finance, support, maintenance, MIFI, publicité,
  franchises, agences, partenaires, établissements et clients) et l'interface
  d'administration utilise ces libellés.
- La migration additive correspondante reste **non appliquée** au staging :
  l'historique des migrations distant est divergent. Aucun rôle supplémentaire
  ni privilège n'a été créé à distance par cette étape. Les contrôles RLS et
  Edge Functions continuent donc à échouer de façon fermée pour les rôles qui
  n'ont pas encore une politique explicitement vérifiée.
- La procédure et la liste des versions divergentes sont maintenues dans
  `docs/SUPABASE_MIGRATION_RECONCILIATION.md`.
- L'écran `Utilisateurs & rôles` n'envoie désormais que les rôles que l'énumération
  staging actuelle accepte. Les rôles du catalogue complet en attente de la
  migration apparaissent explicitement comme non attribuables. Test ciblé,
  typecheck et build Vite ont réussi.
