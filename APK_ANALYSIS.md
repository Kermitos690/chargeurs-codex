# Analyse statique de l’APK fournisseur

**Statut : TERMINÉ — TEST MATÉRIEL REQUIS**

## Objet et périmètre

Ce document décrit une analyse statique, en lecture seule, de l’APK fournisseur remis à Chargeurs.ch. L’objectif est limité à l’interopérabilité légitime avec des bornes détenues par Chargeurs.ch : identifier les responsabilités de l’application, les dépendances Android et les points de contact avec le matériel afin de définir une nouvelle application indépendante.

Cette analyse ne constitue ni une autorisation de réutiliser du code propriétaire, ni une spécification du protocole matériel. Aucun secret, token, identifiant marchand, certificat privé, endpoint complet ou trame propriétaire n’est reproduit dans ce document.

## Identification de l’artefact

| Propriété | Valeur |
|---|---|
| Taille | 68 357 903 octets |
| Entrées ZIP | 2 606 |
| SHA-256 | `490683ea6f308b26d3667002dce7727390aac92d3119562aac566b1f417e2092` |
| Package Android | `com.szbjkj.bajietouchpower` |
| Version | `1.0.74` |
| Version code | `1074` |
| SDK minimum | Android API 26 |
| SDK cible | Android API 33 |
| SDK de compilation | Android API 35 |
| Android Gradle Plugin | 8.3.2 |
| DEX | 4 fichiers |
| ABI natives | `arm64-v8a`, `armeabi-v7a` |

L’archive ZIP est intègre.

## Signature Android

L’APK utilise APK Signature Scheme v2. Aucune signature JAR v1 ni v3 n’a été observée.

La signature RSA et le digest de contenu v2 ont été vérifiés en lecture seule :

- signature du signataire : valide ;
- digest du contenu : conforme ;
- certificat unique, RSA 2048 bits, SHA-256 ;
- sujet et émetteur identiques, ce qui est usuel pour un certificat de signature APK auto-signé ;
- nom commun public : `BaJieTouchPower` ;
- numéro de série : `01` ;
- validité : du 19 mars 2024 au 13 mars 2049 ;
- empreinte SHA-256 : `76:DF:8C:8D:7B:83:53:D7:4A:91:CA:F4:D6:BB:A2:FD:8E:C2:0C:6C:83:C9:64:7C:7F:D3:6F:06:A3:E6:80:BF`.

La clé privée du fournisseur n’a pas été recherchée et n’est pas disponible. Une nouvelle application Chargeurs.ch ne pourra donc pas remplacer cet APK comme une simple mise à jour signée. Elle doit utiliser son propre `applicationId`, sa propre clé de signature et une procédure explicite de migration ou de désinstallation de l’application fournisseur.

## Méthode

L’analyse a utilisé uniquement des opérations locales et non mutantes :

- inventaire ZIP et vérification d’intégrité ;
- lecture structurée du manifeste Android binaire ;
- lecture des tables DEX de chaînes, classes, méthodes et interfaces ;
- recherche ciblée de symboles relatifs au boot, au kiosque, à l’USB, au série, aux slots, à la location, au retour et à Stripe Terminal ;
- inspection des symboles exportés par les bibliothèques ELF ;
- lecture du filtre USB binaire ;
- lecture et vérification du bloc de signature APK v2 avec OpenSSL ;
- recherche de formes courantes de secrets sans afficher les valeurs trouvées.

Les outils Android `jadx`, `aapt`, `apkanalyzer` et `apksigner` n’étaient pas présents dans l’environnement. Des parseurs locaux en mémoire ont été utilisés à leur place. Aucun fichier décompilé n’a été conservé.

## Manifeste Android

### Application

- classe `Application` : `com.szbjkj.bajietouchpower.App` ;
- `debuggable` absent, donc désactivé par défaut ;
- `extractNativeLibs=false` ;
- `supportsRtl=true` ;
- `allowBackup=true` ;
- `usesCleartextTraffic=true` ;
- `requestLegacyExternalStorage=true`.

Les trois derniers paramètres ne doivent pas être repris tels quels dans l’application Chargeurs.ch. Les sauvegardes doivent exclure les identités et états sensibles, le trafic clair doit être désactivé, et le stockage externe partagé ne doit pas servir de magasin de configuration ou de secrets.

### Activités

Le manifeste contient 28 activités, dont 26 activités propres à l’application :

- `TransferActivity`, activité exportée avec `MAIN` et `LAUNCHER` ;
- `MainActivity` et `SettingActivity` ;
- `RentStartActivity`, `ChoosePaymentActivity`, `SwipeCardActivity` et `PosInitOrProcessingActivity` ;
- `PaymentSuccessfulActivity`, `PaymentErrorActivity` et `PaymentEndActivity` ;
- `RentalEndStartActivity` et `RentEndFinishActivity` ;
- `TroublesBatteryActivity` et `StationUnavailableActivity` ;
- `ScanQRCodeActivity` et `ReverseScanQRCodeActivity` ;
- activités d’aide, de carte, de vidéo, de publicité et de reçu.

Deux activités proviennent des dépendances :

- activité Google Play Services, non exportée ;
- activité de réception USB Stripe Terminal, non exportée.

Aucun deep link public n’a été identifié.

### Receivers, services et providers

Receivers :

- `BootCompletedReceiver`, exporté, écoute `android.intent.action.BOOT_COMPLETED` et démarre l’application ;
- `ProfileInstallReceiver`, fourni par AndroidX et protégé par `android.permission.DUMP`.

Service :

- uniquement `androidx.room.MultiInstanceInvalidationService`, non exporté.

Aucun service applicatif de supervision, foreground service matériel ou watchdog kiosque propre à l’application n’a été trouvé.

Providers non exportés :

- FloatingX ;
- TheRouter ;
- AndroidX Startup.

### Métadonnées

Les noms de métadonnées suivants sont présents ; leurs valeurs n’ont volontairement pas été inspectées ou reproduites :

- `TRANSFER` ;
- `POS_TYPE` ;
- `BRAND` ;
- `REGISTER_URL` ;
- `com.google.android.geo.API_KEY`.

## Permissions

Le manifeste déclare 47 permissions.

### Réseau, localisation et radio

- Internet et état réseau/Wi-Fi ;
- localisation fine et approximative ;
- commandes de localisation supplémentaires ;
- Bluetooth historique, scan, advertise et connect ;
- état téléphone ;
- téléphonie déclarée comme fonctionnalité facultative.

L’accès à la localisation est cohérent avec les écrans cartographiques et certaines modalités de découverte Bluetooth Stripe Terminal. Aucune permission de localisation en arrière-plan n’a été observée.

### Démarrage, alimentation et système

- réception du boot ;
- wake lock ;
- réorganisation des tâches ;
- demande d’exclusion des optimisations batterie ;
- overlay système ;
- modification des paramètres ;
- alimentation appareil ;
- modification des APN ;
- lecture privilégiée de l’état téléphone.

Plusieurs de ces permissions sont réservées aux applications système, aux firmwares constructeurs ou aux applications explicitement autorisées. Elles ne peuvent pas être considérées comme disponibles sur un appareil Android standard.

### Stockage

- lecture et écriture de stockage externe historiques ;
- accès global `MANAGE_EXTERNAL_STORAGE` ;
- lecture des médias image, audio et vidéo.

L’APK référence une arborescence de configuration partagée sous `/mnt/sdcard/Documents/bajie_config/`. Elle contient notamment des fichiers relatifs aux ports série, au nombre de cartes, au POS, au serveur d’enregistrement, à l’écran, au redémarrage et aux ressources publicitaires. Ce modèle ne doit pas être utilisé pour les tokens ou l’identité d’un terminal Chargeurs.ch.

### Permissions POS propriétaires

Un large groupe `CLOUDPOS_*` couvre notamment :

- série et afficheur ;
- carte à puce, bande magnétique et sans-contact ;
- PIN et opérations cryptographiques POS ;
- imprimante, LED, coffre, carte d’identité, empreinte et signature.

Leur simple présence ne prouve pas que toutes ces fonctions soient utilisées. Leur disponibilité dépend probablement du firmware et de la signature du constructeur.

### Fonctionnalités matérielles

- USB host ;
- OpenGL ES 2.0 ;
- téléphonie facultative.

## Démarrage et mode kiosque

Éléments confirmés :

- démarrage automatique après `BOOT_COMPLETED` ;
- démarrage d’une activité depuis le receiver ;
- interface immersive au moyen de `setSystemUiVisibility` ;
- interception du bouton retour dans l’activité principale ;
- demande d’exclusion des optimisations batterie ;
- paramètres locaux relatifs à l’écran et au redémarrage.

Éléments non trouvés :

- `startLockTask` ou `stopLockTask` ;
- `DeviceAdminReceiver` ;
- configuration Device Owner ;
- `setLockTaskPackages` ;
- activité déclarée comme véritable launcher `HOME` ;
- watchdog applicatif persistant.

Les watchdogs présents appartiennent à Stripe/BBPOS et surveillent leurs propres sous-systèmes. L’APK met donc en œuvre un plein écran et une relance au boot, mais l’analyse statique ne permet pas de le qualifier de kiosque Android verrouillé.

L’application Chargeurs.ch doit utiliser un provisionnement Device Owner ou un mécanisme MDM compatible avec le matériel cible.

## Bibliothèques natives et accès série

Quatre bibliothèques existent pour ARM 32 et 64 bits :

- `libSerialPortLib.so` : pont JNI série fournisseur ;
- `libjSerialComm.so` : jSerialComm ;
- `libtoolChecker.so` : détection root ;
- `libpl_droidsonroids_gif.so` : affichage GIF.

Les bibliothèques série exposent l’ouverture, la fermeture, la lecture, l’écriture, la configuration termios et des opérations `ioctl`.

Des chemins de périphériques série sont référencés :

- ports embarqués de familles `ttyS`, `ttyHS` et `ttyHSL` ;
- ports USB-série `ttyWCHUSB` ;
- chaînes de bibliothèque pour `ttyUSB`, `ttyACM`, `ttyMT`, `ttyST` et un UART BBPOS.

Les chemins observés sont des indices de compatibilité, pas une configuration fiable. Le port, le débit, la parité, les bits de données, les bits de stop et le contrôle de flux doivent être obtenus auprès du fournisseur ou mesurés lors d’un test matériel autorisé.

L’APK contient des appels et chaînes liés à `su`, `chmod 666`, aux commandes root et à l’exclusion batterie. Ces mécanismes ne doivent pas être reproduits. La ROM doit accorder l’accès au périphérique au moyen de règles `ueventd`/SELinux, d’un service système signé ou d’une API constructeur documentée.

## Architecture matérielle observée

Les principales familles de machines à états sont :

- BJP ;
- DTA ;
- RS485 ;
- variantes de test et couche commune de communication série.

Les responsabilités visibles comprennent :

- découverte et ouverture des ports ;
- réouverture après absence de réponse ;
- initialisation des cartes ;
- interrogation périodique des backplanes ;
- suivi du nombre de cartes et de slots ;
- registration, heartbeat et reconnexion serveur ;
- échanges JSON et Protobuf via Netty ;
- mise à niveau firmware ;
- inventaire des batteries et disponibilité des retours.

Les noms de commandes de haut niveau incluent l’initialisation, le maintien de connexion, la reconnexion série, la fermeture et le roll-call RS485. Leurs valeurs binaires n’ont pas été reproduites.

## Location, éjection et retour

Les types de messages statiquement identifiés couvrent :

- enregistrement de l’appareil ;
- heartbeat normal, spécial et obligatoire ;
- rapport de statut des sous-périphériques ;
- demande, réponse et résultat de location ;
- détection et résultat de restitution ;
- désactivation d’une batterie ;
- éjection groupée ou de maintenance ;
- redémarrage et mise à niveau firmware.

Les concepts de données visibles comprennent :

- numéro de commande ;
- identifiant de batterie ;
- numéro de slot ;
- liste des batteries ;
- nombre de batteries louables ;
- nombre de slots de retour ;
- RSSI et versions firmware.

Les catégories d’erreur couvrent notamment batterie coincée, identifiant inconnu, timeout, échec d’autorisation batterie et signal anti-vol.

Les méthodes de haut niveau observées couvrent la location serveur, la location côté appareil, le retour, la restitution, l’éjection et la réconciliation par heartbeat. Une fonction explicitement nommée comme éjection hors ligne est présente. Elle ne doit pas être reprise dans le parcours de paiement Chargeurs.ch : le terminal doit refuser toute éjection sans autorisation serveur valide et non rejouée.

## USB

Le filtre USB du manifeste est rattaché à Stripe Terminal et contient deux couples publics VID/PID :

- `0x2c69:0x5750` ;
- `0x15a2:0x0101`.

Ils ne doivent pas être interprétés comme les identifiants USB du contrôleur de casiers.

Pour le contrôleur de la borne, les indices disponibles pointent surtout vers des périphériques série créés par le kernel, notamment `ttyWCHUSB`. Aucun filtre USB propre au contrôleur de slots n’a été identifié dans le manifeste.

## Stripe Terminal

Stripe Terminal Android SDK `4.7.5` est réellement intégré.

Fonctions confirmées par les interfaces et appels :

- initialisation du SDK ;
- fournisseur de connection token ;
- découverte et connexion de lecteurs USB ou Bluetooth ;
- écoute des statuts connexion et paiement ;
- callbacks lecteur mobile, batterie, reconnexion et mise à jour ;
- création d’un PaymentIntent ;
- collecte et confirmation du moyen de paiement ;
- annulation ;
- création et confirmation d’un SetupIntent ;
- paramètres d’autorisation étendue et incrémentale ;
- stockage Room lié au mode hors ligne du SDK.

Aucune clé Stripe secrète, restreinte, publiable ou secret webhook au format courant n’a été trouvé.

Aucun marqueur applicatif `Stripe Checkout`, `checkout.session` ou webhook n’a été observé. Les écrans QR présents ne prouvent donc pas l’existence d’un Stripe Checkout QR. Le parcours principal Chargeurs.ch doit être construit côté backend avec Stripe Checkout et validation exclusivement par webhook signé. Stripe Terminal doit rester optionnel et secondaire.

## ChargeNow et réseau

Le nom ChargeNow apparaît dans les ressources, les variantes graphiques et la configuration réseau. Plusieurs rôles réseau sont identifiables, mais toutes les références restent masquées :

| Rôle inféré | Référence sanitizée |
|---|---|
| Application ou UI | `https://<host:1f0328d5b2>/<path-redacted>` |
| Enregistrement appareil | `<host:f0126bdcf0>` |
| Transport DTA | `<host:8e664bd90d>` |
| Bootstrap ou configuration historique | `http://<host:2955c9336f>:<port-redacted>/` |
| Aide, reçu, carte et conditions | `https://<host:masked>/<path-redacted>` |

Les valeurs complètes ne doivent pas être récupérées depuis l’APK ni réutilisées. L’intégration ChargeNow doit utiliser la documentation, les URLs et les identifiants officiellement remis à Chargeurs.ch.

Le transport applicatif utilise Netty, avec des canaux JSON et Protobuf, registration, heartbeat, retry et reconnexion. Des bibliothèques MQTT et WebSocket sont présentes comme dépendances, mais leur présence ne démontre pas leur utilisation par le code métier. Le chiffrement du canal matériel n’a pas pu être confirmé.

## Recherche de secrets

La recherche par formes courantes n’a détecté :

- aucune clé Stripe `sk_*`, `rk_*`, `pk_*` ou `whsec_*` ;
- aucun JWT complet ;
- aucune clé AWS au format courant ;
- aucun fichier JKS, PKCS#12, `.env` ou fichier d’archive nommé comme secret.

Une clé PEM de test interne à Netty est présente dans une classe de vérification OpenSSL. Elle n’est pas référencée comme identité applicative ChargeNow ou Stripe et ne doit pas être exportée.

La valeur de la métadonnée Google Maps n’a pas été inspectée ni reproduite.

Cette recherche ne garantit pas l’absence de secrets utilisant un format propriétaire. Aucun élément trouvé dans l’APK ne doit être importé comme credential dans Chargeurs.ch.

## Constats de sécurité à traiter dans la nouvelle application

- ne pas utiliser `su`, `chmod 666` ou une ROM permissive comme mécanisme d’accès normal ;
- désactiver le trafic clair ;
- utiliser Android Keystore pour l’identité locale ;
- désactiver ou restreindre les sauvegardes ;
- ne pas stocker les tokens sur le stockage externe ;
- utiliser une identité et un certificat propres à chaque terminal ;
- lier cryptographiquement le terminal à une station ;
- refuser l’éjection sans autorisation serveur signée, temporaire et anti-rejeu ;
- isoler la communication matérielle de la WebView ;
- obtenir les permissions POS privilégiées et l’accès série par contrat avec le fabricant ;
- séparer strictement le lecteur Stripe du contrôleur de casiers ;
- vérifier les mises à jour APK et firmware avant installation.

## Limites de l’analyse

L’analyse est statique. Elle n’a comporté :

- aucun lancement de l’APK ;
- aucun appareil Android cible ;
- aucune borne, carte de contrôle, batterie ou lecteur Stripe ;
- aucune capture USB, série ou réseau ;
- aucun paiement ;
- aucun appel ChargeNow ;
- aucune clé externe ;
- aucun test de firmware, SELinux ou permissions système.

Le code est partiellement obfusqué. La présence d’une classe ou d’une dépendance ne prouve pas qu’elle soit utilisée dans tous les parcours.

L’analyse ne permet pas de certifier :

- le protocole d’octets, le framing, le CRC ou le débit du contrôleur ;
- le mapping physique carte/slot ;
- la disponibilité actuelle des services fournisseur ;
- la validité d’un callback ChargeNow ;
- le comportement après coupure électrique ;
- la sécurité effective du canal matériel ;
- qu’une éjection, une restitution ou un paiement réel a réussi.

## Conclusion

L’APK démontre l’existence d’une couche matérielle série structurée, de machines à états BJP/DTA/RS485, d’un protocole de location/retour, d’un démarrage au boot et d’une intégration Stripe Terminal complète. Il ne fournit toutefois ni une spécification matérielle réutilisable, ni un vrai verrouillage Device Owner, ni la preuve d’un Stripe Checkout QR ou d’une éjection conditionnée par webhook.

La réimplémentation doit utiliser l’architecture définie dans `HARDWARE_INTEGRATION.md`, les accès officiels ChargeNow et la documentation matérielle fournisseur. La validation finale reste obligatoirement un test matériel supervisé.

