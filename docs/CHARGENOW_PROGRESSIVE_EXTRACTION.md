# Extraction progressive de ChargeNow

## Objectif

Remplacer progressivement ChargeNow par une passerelle locale et un backend Chargeurs.ch, sans interrompre l’exploitation des bornes et sans copier le code, les secrets, les certificats ou les ressources propriétaires du fournisseur.

L’APK fournisseur reste active pendant la phase `shadow`. L’APK Chargeurs.ch observe uniquement les composants Android, USB, série, réseau et processus accessibles avec ses propres permissions, puis envoie ces observations au backend Chargeurs.ch. Aucune trame série ou commande matérielle n’est inventée.

## Activation simplifiée de la phase de test

L’APK diagnostic ne demande plus de fichier, de clé USB ni de code d’appairage créé dans le back-office.

Sur l’écran d’activation :

1. saisir l’identifiant exact de la borne pilote, par exemple `DTA21269` ;
2. laisser l’APK générer automatiquement un token `kt_test_…` ;
3. appuyer sur **Activer cette borne** ;
4. le token est enregistré simultanément dans le stockage sécurisé Android et sous forme de hash côté serveur ;
5. le kiosk s’ouvre directement sur la borne sélectionnée.

Le bouton **Copier le token** reste présent pour le diagnostic ou le dépannage, mais aucun copier-coller n’est requis pour l’activation normale de test.

Cette voie est strictement limitée à :

- l’APK dont la version se termine par `-staging-diagnostic` ;
- le projet Supabase de staging épinglé ;
- une station dont `environment = 'staging'` et `is_pilot = true` ;
- un token au format diagnostic généré localement ;
- une durée de validité de sept jours.

Les builds release et production conservent l’appairage sécurisé par code à usage unique généré par un administrateur.

## Architecture de transition

```text
Contrôleur DTA / slots / batteries
             │
             ├── ChargeNow APK ── serveur ChargeNow ── API ChargeNow
             │          parcours encore actif
             │
             └── Chargeurs.ch APK ── local_gateway_observations
                         observation locale en lecture seule
                                      │
                                      └── Local Gateway API Chargeurs.ch
```

Après validation du protocole local et des droits système :

```text
Contrôleur DTA / slots / batteries
             │
             └── Chargeurs.ch APK ── Local Gateway API ── Supabase / Stripe
                                      │
                                      └── adaptateur ChargeNow facultatif
```

## Modes d’exploitation

### 1. `shadow`

- ChargeNow contrôle encore la borne.
- Chargeurs.ch collecte les observations locales.
- Les états locaux sont comparés aux snapshots ChargeNow.
- Toute écriture série et toute commande locale restent interdites.

### 2. `native_read_only`

- Chargeurs.ch ouvre le transport uniquement après identification certaine du port et de ses paramètres.
- Seules les trames de lecture documentées et validées sont autorisées.
- ChargeNow reste la source de contrôle.
- Les inventaires slots/batteries doivent concorder sur une période définie.

### 3. `native_control`

- Activable uniquement par station, derrière un feature flag serveur.
- Chaque commande doit être signée, temporaire, liée à une station, un appareil, une location, un slot et un identifiant anti-rejeu.
- Une seule fonction est basculée à la fois.
- Retour immédiat vers ChargeNow en cas de divergence ou d’état ambigu.

## API personnelle déjà introduite

### Ingestion d’observation

`POST /functions/v1/device-shadow-ingest`

Authentification : `X-Kiosk-Token`, lié à une station et à un appareil actif.

Le serveur :

- limite la taille du rapport ;
- retire les champs dont le nom ressemble à un secret, token, mot de passe ou autorisation ;
- calcule un SHA-256 ;
- capture le snapshot fournisseur disponible au même moment ;
- stocke les deux sources dans `local_gateway_observations`.

### Lecture de la passerelle Chargeurs.ch

`GET /functions/v1/local-gateway-api/v1/capabilities`

Retourne les fonctions réellement disponibles. Le contrôle reste actuellement désactivé.

`GET /functions/v1/local-gateway-api/v1/stations/{stationId}/status`

Retourne :

- l’état courant de la station ;
- le dernier relevé local ;
- le snapshot ChargeNow associé ;
- le mode actif ;
- la raison explicite pour laquelle le contrôle local est désactivé.

## Matrice de remplacement

| Fonction | Source actuelle | Première substitution Chargeurs.ch | Condition de bascule |
|---|---|---|---|
| Présence APK fournisseur | Android PackageManager | diagnostic local | immédiate |
| Inventaire USB et TTY | diagnostic local | Local Gateway API | immédiate |
| État réseau de la tablette | Android natif | Local Gateway API | immédiate |
| État en ligne de la borne | ChargeNow | comparaison locale/fournisseur | observations stables |
| Heartbeat | ChargeNow APK | heartbeat Chargeurs.ch en parallèle | protocole et identité documentés |
| Inventaire slots | API ChargeNow | lecture locale normalisée | concordance prolongée |
| Inventaire batteries | API ChargeNow | lecture locale normalisée | concordance prolongée |
| Détection de retour | ChargeNow | événement local signé | tests physiques répétés |
| Éjection | ChargeNow | commande locale signée | protocole validé + arrêt d’urgence |
| Redémarrage matériel | ChargeNow | maintenance locale administrateur | validation fabricant |
| Mise à jour firmware | ChargeNow | aucune substitution initiale | documentation officielle obligatoire |

## Séquence de tests sur DTA21269

1. Installer l’APK diagnostic Chargeurs.ch à côté de ChargeNow.
2. Sur la page d’activation, saisir `DTA21269` et appuyer sur **Activer cette borne**.
3. Garder ChargeNow ouvert et attendre que le logo de connexion soit allumé.
4. Ouvrir le diagnostic depuis l’écran de maintenance Chargeurs.ch.
5. Exécuter et envoyer une observation `shadow`.
6. Répéter dans les états suivants :
   - ChargeNow connecté et au repos ;
   - une batterie retirée par un parcours fournisseur autorisé ;
   - une batterie rendue ;
   - réseau coupé ;
   - réseau rétabli ;
   - ChargeNow fermé ;
   - ChargeNow relancé ;
   - tablette redémarrée.
7. Comparer les ports, processus, sockets, timestamps, changements USB/TTY et snapshot fournisseur.
8. Identifier les éléments qui disparaissent exactement lorsque ChargeNow s’arrête.
9. Ne développer le premier lecteur local qu’après cette identification.

## Critères avant lecture série

- port exact confirmé sur plusieurs relevés ;
- permission de lecture confirmée sans `su` ni `chmod` ;
- paramètres série obtenus officiellement ou mesurés de manière autorisée ;
- framing, CRC, timeouts et réponses documentés ;
- aucune collision avec le processus ChargeNow ;
- mécanisme de retour en mode shadow disponible.

## Critères avant commande matérielle

- lecture locale fiable et concordante ;
- mapping carte/slot établi ;
- tests sur batterie de maintenance ;
- autorisation serveur signée et anti-rejeu ;
- journal local et serveur ;
- timeout sans nouvelle tentative automatique ambiguë ;
- arrêt d’urgence et désactivation distante ;
- aucune transaction Stripe live pendant les premiers tests.

## Limite importante

Le diagnostic logiciel peut inventorier ce qu’Android expose. Il ne peut pas identifier avec certitude les cartes électroniques, leurs références, le câblage, les tensions ou le protocole complet sans relevés physiques, photographies nettes des cartes et connecteurs, documentation fabricant, logs autorisés et tests supervisés sur la borne.
