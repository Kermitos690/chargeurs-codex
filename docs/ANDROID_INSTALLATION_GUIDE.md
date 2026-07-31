# Installation — Chargeurs.ch Kiosk staging 1.0.4

## Périmètre et sécurité

Cet APK est un artefact **staging**, signé avec la clé debug Android. Il pointe
uniquement vers le frontend staging et l'endpoint Supabase staging d'appairage.
Stripe y reste en mode test. L'éjection matérielle est désactivée directement
dans le build : le bridge renvoie `HARDWARE_EJECTION_DISABLED`.

Ne pas installer cette version en production, ne pas activer une mutation
ChargeNow et ne pas saisir un code d'appairage dans un environnement autre que
le staging.

## Installation manuelle sur la tablette

1. Copier `Chargeurs_CH_Kiosk_1.0.4-staging.apk` sur la tablette par USB.
2. Dans Android, autoriser temporairement l'installation depuis le gestionnaire
   de fichiers utilisé. Ne pas autoriser des sources inconnues de manière
   permanente si le mode de gestion de la tablette le permet.
3. Ouvrir l'APK et confirmer l'installation. Une mise à jour conserve la
   liaison existante si elle porte le même `applicationId` et la même clé de
   signature ; l'APK staging utilise son identifiant de test distinct.
4. Ouvrir **Chargeurs.ch Kiosk**. L'écran natif « Activation de la borne » doit
   apparaître tant qu'aucune liaison valide n'existe.
5. Dans le back-office staging : Station `DTA21269` → **Attribuer un kiosk** →
   générer un code à six chiffres. Vérifier son expiration avant de le saisir.
6. Saisir les six chiffres exclusivement avec le pavé tactile, y compris un
   éventuel zéro initial, puis toucher **Activer**.
7. Vérifier l'écran d'accueil de la borne, le tarif et l'indicateur réseau.
   Un paiement de test peut afficher le QR Stripe ; aucune batterie ne sera
   éjectée par cette version.
8. Redémarrer la tablette. La borne doit rouvrir l'application et conserver sa
   liaison. Si un gestionnaire MDM est utilisé, l'ajouter à la liste autorisée
   pour le mode Lock Task et le démarrage après boot.

## Installation ADB (technicien)

Avec le débogage USB autorisé et une tablette physiquement connectée :

```sh
adb devices
adb install -r Chargeurs_CH_Kiosk_1.0.4-staging.apk
adb shell monkey -p ch.chargeurs.kiosk.staging 1
```

Ne jamais exécuter `adb uninstall` pour une mise à jour normale : cela efface
la liaison locale. Vérifier d'abord le modèle et la version Android avec
`adb shell getprop ro.product.model` et `adb shell getprop ro.build.version.release`.

## Révocation ou remplacement

Dans le back-office, révoquer le kiosk de la station puis, sur la tablette,
utiliser la procédure administrateur de réinitialisation. Générer ensuite un
nouveau code : l'ancien code est à usage unique, expirant et haché côté serveur.

## Contrôles de recette à effectuer sur matériel

- tactile, portrait/paysage et lisibilité du QR ;
- perte/reprise réseau ;
- activation puis redémarrage ;
- blocage des liens externes et du téléchargement ;
- lancement après boot dans le MDM ;
- QR Stripe test avec téléphone réel ;
- vérification explicite que l'éjection reste refusée.
