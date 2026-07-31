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
