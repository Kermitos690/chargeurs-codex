# Application Android kiosque

## Livrable

`android-kiosk/` est un projet Android Studio natif, application id `ch.chargeurs.kiosk`, Java 17, minSdk 23, target/compile SDK 36. Il contient le Gradle Wrapper, les tests unitaires, le build debug et la configuration conditionnelle de signature release.

## Comportement

- activité de provisionnement si aucun terminal n'est enrôlé ;
- code d'appairage temporaire échangé contre station, URL et token kiosque ;
- token chiffré AES-GCM avec une clé Android Keystore ;
- WebView limitée à l'origine HTTPS provisionnée, sans accès fichier, contenu mixte, géolocalisation, téléchargement ou navigation externe ;
- démarrage après boot, plein écran, blocage retour, watchdog et reprise réseau ;
- lock-task réel uniquement lorsque l'application est autorisée par un Device Policy Controller ;
- diagnostic natif en lecture seule des ports série et périphériques USB.

## Pont natif

`ChargeursNative` expose uniquement le statut, la liaison station/terminal, la version, le diagnostic, le redémarrage et une demande d'éjection signée. L'éjection vérifie RS256, station, terminal, location, slot, état `payment_succeeded`, durée maximale 120 secondes et anti-rejeu.

Le protocole cabinet reste volontairement `NOT_CONFIGURED`. Aucun octet supposé, `su` ou `chmod 666` n'est envoyé. Un adaptateur fournisseur documenté et un test matériel sont nécessaires.

## Construction

```bash
cd android-kiosk
./gradlew testDebugUnitTest lintDebug assembleDebug
./gradlew lintRelease assembleRelease bundleRelease
```

Sans clé de signature, la release est un artefact non installable en production. La clé fournisseur ne signe pas cette nouvelle application ; l'ancien APK doit être désinstallé si les packages/signatures sont incompatibles.

## Provisionnement appareil propriétaire

Pour un verrouillage robuste, provisionner la tablette comme appareil dédié/Device Owner via Android Enterprise ou le DPC du fabricant, autoriser le package en lock-task, désactiver les comptes/notifications inutiles et documenter une procédure d'administration de secours.

Voir `APK_ANALYSIS.md`, `HARDWARE_INTEGRATION.md` et `KIOSK_PROVISIONING.md`.
