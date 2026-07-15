# Chargeurs.ch — wrapper Android kiosk

## Statut réel

Le dossier `android-kiosk/` contient un projet Android natif en Java destiné à envelopper la route web kiosk.

- ✅ code source Android développé ;
- ✅ règles de validation unitaires ajoutées ;
- ✅ pipeline de build Android ajouté ;
- ⚠️ APK debug uniquement après succès de la CI ;
- ❌ aucune signature de production dans le dépôt ;
- ❌ aucune installation encore validée sur une borne réelle ;
- ❌ aucun mode device-owner/DPC encore configuré sur le matériel.

Un artefact GitHub Actions ne doit pas être présenté comme un APK de production.

## Architecture

Le wrapper :

1. démarre sur une activité de provisionnement si aucune configuration n'existe ;
2. demande l'identifiant de station, le token kiosk et le domaine HTTPS ;
3. valide la station avec la même forme que le frontend ;
4. chiffre le token avec une clé AES/GCM détenue par Android Keystore ;
5. charge uniquement la route `https://<domaine>/kiosk/<station>` ;
6. injecte le verrou de station et le token dans le stockage du domaine web ;
7. masque le navigateur natif jusqu'à la fin de l'injection ;
8. bloque les navigations principales hors du domaine configuré ;
9. annule toute erreur TLS ;
10. interdit les téléchargements, la géolocalisation, les permissions WebView et l'accès aux fichiers ;
11. masque les barres système, garde l'écran allumé et bloque les captures d'écran ;
12. tente le mode lock-task uniquement si le terminal est géré et le paquet autorisé ;
13. surveille le renderer WebView par heartbeat et le reconstruit s'il ne répond plus ;
14. tente de redémarrer après reboot ou mise à jour de l'application.

Aucun `addJavascriptInterface` n'est exposé.

## Provisionnement

Le token kiosk ne doit jamais être ajouté au code, au manifeste, à une capture ou à un ticket.

Première installation :

1. installer l'APK de test sur une tablette dédiée ;
2. ouvrir l'application ;
3. saisir l'identifiant de la borne ;
4. saisir le token kiosk individuel créé par l'administration ;
5. vérifier le domaine HTTPS ;
6. activer la borne ;
7. confirmer que le kiosk ouvre automatiquement la bonne route ;
8. vérifier côté serveur que le token est lié à cette station uniquement.

Après activation, l'écran public ne permet pas de changer de station. Pour reprovisionner, l'opérateur doit utiliser la gestion du terminal ou effacer les données de l'application, puis entrer un nouveau token.

## Stockage du token

Le token est :

- chiffré dans les préférences natives avec Android Keystore ;
- déchiffré uniquement au lancement du kiosk ;
- injecté dans le `localStorage` du domaine Chargeurs.ch parce que le frontend actuel lit `kiosk_token` à cet endroit.

### Dette de sécurité ouverte

Après injection, le token existe aussi dans le stockage privé du WebView. Le sandbox Android protège ce stockage des autres applications ordinaires, mais il n'offre pas la même garantie qu'une clé non exportable du Keystore.

Une évolution ultérieure peut remplacer ce contrat par :

- un jeton de session court créé par le backend ;
- une attestation de terminal ;
- ou une API native contrôlée et limitée au seul domaine autorisé.

Cette évolution ne doit pas être simulée ou annoncée comme déjà réalisée.

## Mode kiosk réel

L'application déclare `lockTaskMode="if_whitelisted"` et appelle `startLockTask()` seulement lorsque `DevicePolicyManager` confirme que le paquet est autorisé.

Pour un verrouillage réel, la tablette doit être :

- provisionnée comme appareil dédié ;
- administrée par un DPC ou une solution OEM équivalente ;
- configurée avec le paquet `ch.chargeurs.kiosk` dans la liste lock-task ;
- éventuellement configurée avec Chargeurs Kiosk comme application HOME persistante.

Sans cela, l'application fonctionne en plein écran immersif, mais ce n'est pas un verrouillage système certifié.

## Démarrage automatique

`BootReceiver` écoute :

- `BOOT_COMPLETED` ;
- `MY_PACKAGE_REPLACED`.

Android et certains constructeurs peuvent interdire le lancement d'une activité depuis l'arrière-plan. Le démarrage automatique doit donc être testé sur chaque modèle de borne et peut nécessiter :

- le mode device-owner ;
- une autorisation OEM d'auto-démarrage ;
- ou le paramétrage de l'application comme HOME.

## Réseau et WebView

Le manifeste refuse le trafic HTTP. Le WebView :

- charge uniquement une origine HTTPS explicitement provisionnée ;
- annule les erreurs de certificat ;
- bloque l'accès `file://` et `content://` ;
- refuse le contenu mixte ;
- n'autorise ni géolocalisation ni permissions web ;
- ne met pas en cache lui-même les appels métier au-delà du comportement de la PWA ;
- laisse les appels Supabase et les autres sous-ressources HTTPS contrôlés par le frontend.

Le filtrage strict porte sur les navigations principales. Les appels réseau cross-origin nécessaires à Supabase ne sont pas remplacés ni interceptés par le wrapper.

## Build

Le projet utilise :

- Android Gradle Plugin 9.2 ;
- Gradle 9.4.1 ;
- JDK 17 ;
- compile/target SDK 36 ;
- minimum SDK 23.

Build local avec Gradle installé :

```bash
cd android-kiosk
gradle :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

La CI publie :

- les rapports de tests ;
- les rapports Android Lint ;
- `app-debug.apk` non signé pour essais internes.

## Signature et distribution

Aucun fichier `.jks`, `.keystore` ou mot de passe de signature ne doit être commité.

Avant une distribution production :

1. créer une clé de signature hors dépôt ;
2. sauvegarder cette clé dans un coffre contrôlé ;
3. configurer la signature via secrets CI ou build local sécurisé ;
4. produire un APK/AAB release ;
5. vérifier le hash SHA-256 ;
6. installer sur une borne de test ;
7. tester une mise à jour par-dessus la version précédente ;
8. documenter la procédure de rollback.

## Matrice de test matériel obligatoire

- démarrage à froid ;
- reboot Android ;
- mise à jour APK ;
- coupure et retour Wi-Fi/4G ;
- DNS indisponible ;
- certificat TLS invalide ;
- crash du renderer WebView ;
- rotation et changements de configuration ;
- tentative de retour arrière ;
- tentative de quitter vers une autre application ;
- téléchargement et lien externe ;
- station différente dans l'URL ;
- token invalide ou révoqué ;
- application sans configuration ;
- écran allumé pendant plusieurs heures ;
- location et paiement complets sur une borne réelle ;
- comportement pendant une mise à jour PWA ;
- récupération après extinction brutale.

## Critère de qualification

Le wrapper devient « APK kiosk validé » uniquement lorsque :

- la CI Android est verte ;
- un APK signé est produit ;
- il est installé sur au moins une borne réelle ;
- le token individuel est reconnu par le backend ;
- le lock-task ou le mécanisme OEM est effectivement actif ;
- reboot, réseau, watchdog, location, paiement et retour sont testés ;
- aucune navigation hors domaine ni fuite de token n'est observée ;
- les preuves de test sont conservées sans secret.
