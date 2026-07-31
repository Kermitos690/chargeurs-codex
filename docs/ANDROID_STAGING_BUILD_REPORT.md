# APK Android staging — rapport de build

Date du build : 31 juillet 2026 (Europe/Zurich)
Commit source Android : `689a0d9` (branche `agent/finalize-chargeurs-platform`)

| Artefact | Application ID | Version | Taille | SHA-256 |
|---|---|---:|---:|---|
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging.apk` | `ch.chargeurs.kiosk.staging` | `1.0.4-staging` (`104`) | 895 KiB | `d9f6636437d33531125d8cbe9cca113bf18ff958f1ab0e91cf1de255e5728383` |
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-debug.apk` | `ch.chargeurs.kiosk.debug` | `1.0.4-diagnostic` (`104`) | 895 KiB | `5115c0c56ca0f92eb61b205b62963f42f879ead1c5cd36ea93b34a004f1abf64` |
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging-r1.apk` | `ch.chargeurs.kiosk.staging` | `1.0.4-staging` (`104`) | 934 KiB | `075d783fc97d286dc8d0e2b8b01ad35cb4d8cfd9d08dd7b8d3f53fed9006f232` |
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging-r2.apk` | `ch.chargeurs.kiosk.staging` | `1.0.4-staging` (`104`) | 934 KiB | `e0d4939638cc45a5d26a6aa9b3fed40fbe737ac205b5a709fa07f8a46a70ceac` |
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.5-staging.apk` | `ch.chargeurs.kiosk.staging` | `1.0.5-staging` (`105`) | 895 KiB | `1a1417a13c467b4ef1f99bb568da34794ed4638135c017160ef298630657771f` |
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.6-staging.apk` | `ch.chargeurs.kiosk.staging` | `1.0.6-staging` (`106`) | 918 020 octets | `1227a3e51ba4aab90ba7c96bfe8948e6cd5f6f18f1b41120df2c61309225e994` |

Les APK staging listées sont installables et signées avec la clé debug Android
(signature v2 vérifiée). Le build staging active le cycle HOME/boot dédié à la
borne ; le build debug reste réservé au diagnostic développeur.

Configuration compilée dans le staging :

- frontend : `https://chargeurs-ch-staging.vercel.app` ;
- enrôlement : endpoint `kiosk-enroll` du projet Supabase staging
  `xqepbqnaenoeyfjkjnzl` ;
- minSdk 26, targetSdk 36, compileSdk 36 ;
- Stripe test uniquement ;
- aucune permission caméra, NFC ou Bluetooth ;
- `HARDWARE_EJECTION_ENABLED=false` dans l’APK ; toute éjection réelle reste
  pilotée par le backend/API ChargeNow après autorisation serveur.

Contrôles de la version 1.0.6 : `testDebugUnitTest`, `lintStaging`,
`assembleStaging`, `apksigner verify`, inventaire des permissions et recherche
des chaînes de secrets embarqués (`sk_live`, service role, ChargeNow Basic Auth).

### Correctif r1

- protège le rendu animé contre une passe Android de taille nulle ;
- affiche un diagnostic contrôlé si la tablette ne fournit pas de WebView
  utilisable, au lieu de fermer silencieusement l’application ;
- signature debug staging, vérification v2 réussie ;
- SHA-256 : `075d783fc97d286dc8d0e2b8b01ad35cb4d8cfd9d08dd7b8d3f53fed9006f232`.

### Correctif r2

- retire les références directes aux APIs `WindowInsetsController` et
  `OnBackInvokedDispatcher` du chemin de démarrage ;
- conserve le plein écran par les flags immersifs compatibles API 26+ ;
- tests et vérification de signature v2 réussis ;
- SHA-256 : `e0d4939638cc45a5d26a6aa9b3fed40fbe737ac205b5a709fa07f8a46a70ceac`.

### Version installable 1.0.5

- `versionCode=105` pour permettre la mise à jour directe depuis la version
  104 ;
- même application ID staging et même signature debug ;
- SHA-256 : `1a1417a13c467b4ef1f99bb568da34794ed4638135c017160ef298630657771f`.

### Version installable 1.0.6

- `versionCode=106` : mise à jour directe autorisée au-dessus de la 1.0.5,
  avec le même application ID staging et la même signature debug ;
- diagnostic métadonnées-only de l’APK fournisseur : présence, état activé,
  version et absence de pont public observable ;
- aucune lecture de données privées fournisseur, aucune trame série et aucune
  commande ChargeNow n’est ajoutée ;
- le diagnostic web ne montre plus aucun préfixe de token kiosk et, dans
  l’enveloppe Android, ne permet plus le collage manuel d’un token ;
- SHA-256 : `1227a3e51ba4aab90ba7c96bfe8948e6cd5f6f18f1b41120df2c61309225e994`.

La validation sur tablette réelle (tactile, boot, persistance Keystore, QR avec
téléphone) reste à effectuer manuellement. La release compilée est unsigned
faute de clé de signature propriétaire ; elle n’est pas livrée comme APK
installable.
