# APK Android staging — rapport de build

Date du build : 31 juillet 2026 (Europe/Zurich)

| Artefact | Application ID | Version | Taille | SHA-256 |
|---|---|---:|---:|---|
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-staging.apk` | `ch.chargeurs.kiosk.staging` | `1.0.4-staging` (`104`) | 895 KiB | `d9f6636437d33531125d8cbe9cca113bf18ff958f1ab0e91cf1de255e5728383` |
| `~/Downloads/Chargeurs_CH_APK/Chargeurs_CH_Kiosk_1.0.4-debug.apk` | `ch.chargeurs.kiosk.debug` | `1.0.4-diagnostic` (`104`) | 895 KiB | `5115c0c56ca0f92eb61b205b62963f42f879ead1c5cd36ea93b34a004f1abf64` |

Les deux APK sont installables et signées avec la clé debug Android (signature
v2 vérifiée). Le build staging active le cycle HOME/boot dédié à la borne ; le
build debug reste réservé au diagnostic développeur.

Configuration compilée dans le staging :

- frontend : `https://chargeurs-ch-staging.vercel.app` ;
- enrôlement : endpoint `kiosk-enroll` du projet Supabase staging
  `xqepbqnaenoeyfjkjnzl` ;
- minSdk 26, targetSdk 36, compileSdk 36 ;
- Stripe test uniquement ;
- aucune permission caméra, NFC ou Bluetooth ;
- `HARDWARE_EJECTION_ENABLED=false` dans l’APK ; toute éjection réelle reste
  pilotée par le backend/API ChargeNow après autorisation serveur.

Contrôles exécutés : `testDebugUnitTest`, `lintDebug`, `lintStaging`,
`assembleDebug`, `assembleStaging`, `lintRelease`, `assembleRelease`,
`apksigner verify`, inventaire des permissions et recherche de secrets embarqués.

La validation sur tablette réelle (tactile, boot, persistance Keystore, QR avec
téléphone) reste à effectuer manuellement. La release compilée est unsigned
faute de clé de signature propriétaire ; elle n’est pas livrée comme APK
installable.
