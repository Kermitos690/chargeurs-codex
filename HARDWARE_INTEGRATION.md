# Intégration matérielle des bornes Chargeurs.ch

**Statut : TERMINÉ — TEST MATÉRIEL REQUIS**

## Objectif

Ce document définit le contrat d’architecture entre l’application Android Chargeurs.ch, le contrôleur de casiers et le backend. Il transforme les constats de l’analyse statique en interfaces maîtrisées sans copier ni inventer le protocole fournisseur.

La mise en œuvre doit permettre :

- l’inventaire des cartes, slots et batteries ;
- l’éjection après paiement confirmé côté serveur ;
- la détection de prise de batterie ;
- la détection et le rapprochement d’un retour ;
- le diagnostic et la réconciliation ;
- la révocation d’un terminal ;
- le remplacement futur d’un transport ou d’une famille de contrôleurs.

## Règles non négociables

1. **Aucun protocole d’octets ne doit être inventé.** Les trames, commandes, CRC, timeouts, débits et règles de retry doivent provenir d’une documentation fournisseur autorisée ou de tests matériels supervisés et documentés.
2. Les valeurs et commandes trouvées dans l’APK fournisseur ne doivent pas être copiées comme spécification.
3. `su`, `chmod 666`, un contournement SELinux ou une ROM globalement permissive ne doivent pas être reproduits.
4. Une page web, une redirection Stripe ou un écran de succès ne peut jamais commander directement une éjection.
5. Le contrôleur local refuse par défaut toute commande non signée, expirée, rejouée ou destinée à une autre station.
6. Une seule file mono-écrivain possède le transport physique.
7. Une réponse ambiguë ne doit jamais provoquer une seconde éjection automatique.
8. Le lecteur Stripe Terminal et le contrôleur de casiers sont deux sous-systèmes distincts.
9. Aucun test automatisé ne doit réaliser de paiement live ou d’éjection réelle sans activation manuelle explicite.
10. Tout paramètre matériel non confirmé reste `NOT_CONFIGURED` et provoque un échec fermé explicite.

## Architecture cible

```text
Backend Chargeurs.ch
  |  autorisation signée + commande idempotente
  v
Android Hardware Gateway
  |-- vérification station/appareil/nonce/expiration
  |-- journal local et file mono-écrivain
  v
CabinetController
  v
CabinetProtocolAdapter (BJP, DTA, RS485 ou autre version documentée)
  v
HardwareTransport (série, USB-série ou service système constructeur)
  v
Cartes de contrôle -> slots -> batteries

Événements matériels
  ^
  +-- journal local -> synchronisation idempotente -> backend
```

Le backend reste la source de vérité des locations, paiements, remboursements et incidents. Le gateway Android est la source de vérité temporaire de l’état d’une commande physique en cours et doit synchroniser ses événements avec le backend.

## Modèle de configuration

Un état de configuration doit être explicite :

```kotlin
sealed interface ConfiguredValue<out T> {
    data class Configured<T>(val value: T) : ConfiguredValue<T>
    data class NotConfigured(val reason: String) : ConfiguredValue<Nothing>
}
```

Le code de production ne doit jamais convertir silencieusement `NotConfigured` en valeur par défaut.

## Interface `HardwareTransport`

`HardwareTransport` ne connaît ni la location, ni Stripe, ni la notion métier d’éjection. Il transporte uniquement des octets vers un périphérique explicitement configuré.

```kotlin
interface HardwareTransport {
    suspend fun discover(): List<TransportCandidate>
    suspend fun open(config: TransportConfig): TransportSession
}

interface TransportSession {
    val identity: TransportIdentity
    val incoming: Flow<ByteChunk>

    suspend fun write(frame: ByteArray): TransportWriteResult
    suspend fun health(): TransportHealth
    suspend fun close()
}
```

### Responsabilités

- détecter les périphériques sans en sélectionner un implicitement ;
- ouvrir un seul périphérique correspondant à la configuration provisionnée ;
- appliquer les paramètres série validés ;
- sérialiser les écritures ;
- fournir les fragments reçus sans interprétation métier ;
- signaler permission refusée, déconnexion, timeout, erreur I/O et fermeture ;
- libérer proprement le descripteur de fichier ;
- ne jamais lancer une commande shell pour modifier les droits.

### `TransportConfig`

Les champs suivants doivent être explicitement configurés :

```text
HARDWARE_TRANSPORT_KIND=NOT_CONFIGURED
HARDWARE_DEVICE_PATH=NOT_CONFIGURED
HARDWARE_USB_VENDOR_ID=NOT_CONFIGURED
HARDWARE_USB_PRODUCT_ID=NOT_CONFIGURED
HARDWARE_BAUD_RATE=NOT_CONFIGURED
HARDWARE_DATA_BITS=NOT_CONFIGURED
HARDWARE_STOP_BITS=NOT_CONFIGURED
HARDWARE_PARITY=NOT_CONFIGURED
HARDWARE_FLOW_CONTROL=NOT_CONFIGURED
HARDWARE_READ_TIMEOUT_MS=NOT_CONFIGURED
HARDWARE_WRITE_TIMEOUT_MS=NOT_CONFIGURED
HARDWARE_MAX_FRAME_BYTES=NOT_CONFIGURED
```

Les VID/PID Stripe Terminal identifiés dans l’APK ne doivent pas être utilisés comme identifiants du contrôleur de casiers.

### Accès au périphérique

L’accès doit être obtenu par l’un des moyens suivants :

- règles `ueventd` et SELinux du firmware fournisseur ;
- service système signé exposant une API Binder restreinte ;
- API Android USB host et permission utilisateur/Device Owner appropriée ;
- API constructeur documentée.

Si aucun mécanisme propre n’est disponible, l’intégration reste `NOT_CONFIGURED` et la borne ne peut pas être activée.

## Interface `CabinetProtocolAdapter`

`CabinetProtocolAdapter` transforme des commandes de domaine en trames documentées et des octets reçus en messages validés. Chaque famille et version de protocole possède une implémentation séparée.

```kotlin
interface CabinetProtocolAdapter {
    val protocolIdentity: ProtocolIdentity
    val capabilities: CabinetCapabilities

    fun encode(command: CabinetCommand): EncodeResult
    fun accept(chunk: ByteChunk): List<DecodeResult>
    fun reset(reason: ResetReason)
}
```

### Exigences

- version de protocole explicite ;
- aucune sélection par heuristique en production ;
- limite stricte de longueur des frames ;
- gestion des fragments et de plusieurs frames dans un même buffer ;
- validation du framing, de la longueur et du checksum/CRC documenté ;
- rejet des types inconnus ;
- protection contre les buffers non bornés ;
- aucune donnée secrète dans les logs ;
- tests de conformité fondés sur des exemples officiellement fournis ;
- compatibilité déclarée par capacité, jamais supposée.

### Familles candidates

L’analyse statique indique des familles BJP, DTA et RS485. Elles restent des candidats, pas des implémentations validées.

```text
HARDWARE_PROTOCOL_FAMILY=NOT_CONFIGURED
HARDWARE_PROTOCOL_VERSION=NOT_CONFIGURED
HARDWARE_PROTOCOL_SPEC_REFERENCE=NOT_CONFIGURED
HARDWARE_PROTOCOL_SPEC_SHA256=NOT_CONFIGURED
HARDWARE_SLOT_NUMBER_BASE=NOT_CONFIGURED
HARDWARE_BOARD_COUNT=NOT_CONFIGURED
HARDWARE_SLOTS_PER_BOARD=NOT_CONFIGURED
HARDWARE_ACK_TIMEOUT_MS=NOT_CONFIGURED
HARDWARE_COMMAND_TIMEOUT_MS=NOT_CONFIGURED
HARDWARE_RETRY_POLICY=NOT_CONFIGURED
```

Une implémentation ne peut passer en production que si la référence documentaire, son hash et les fixtures de conformité sont renseignés.

## Interface `CabinetController`

`CabinetController` porte les invariants physiques et orchestre l’adapter et le transport.

```kotlin
interface CabinetController {
    suspend fun inventory(): InventorySnapshot
    suspend fun reserveEjectableSlot(request: SlotReservationRequest): SlotReservation
    suspend fun eject(request: AuthorizedEjection): EjectionResult
    suspend fun confirmBatteryTaken(commandId: CommandId): BatteryTakenResult
    suspend fun reconcile(commandId: CommandId): ReconciliationResult
    suspend fun processReturn(event: RawReturnObservation): ReturnResult
    suspend fun disableBattery(request: DisableBatteryRequest): DisableBatteryResult
    suspend fun selfTest(scope: SelfTestScope): SelfTestResult
}
```

### Invariants

- une seule réservation active par slot ;
- une seule éjection physique par `commandId` ;
- station et appareil identiques à l’autorisation ;
- slot présent, louable et non réservé ;
- batterie attendue cohérente avec l’inventaire ;
- commande expirée refusée avant encodage ;
- retour enregistré comme observation avant rapprochement métier ;
- résultat ambigu placé en réconciliation, jamais rejoué à l’aveugle ;
- toute transition et toute intervention manuelle sont auditées.

`CabinetController` ne reçoit jamais un montant ou un statut de paiement venant du frontend. Il reçoit seulement une autorisation serveur déjà créée après validation du paiement.

## Autorisation d’éjection

### Origine

L’autorisation est créée exclusivement par le backend après :

1. réception d’un webhook Stripe valide ;
2. vérification de la session, du montant, de la devise et du snapshot tarifaire ;
3. transition idempotente de la location vers `payment_succeeded` ;
4. création d’une commande matérielle unique.

### Claims minimaux

Le format peut être JWS ou COSE, selon la décision de sécurité documentée. Il doit contenir au minimum :

- `jti` unique ;
- issuer et audience ;
- identifiant du terminal ;
- identifiant de la station ;
- identifiant de location ;
- identifiant de commande ;
- identifiant du paiement confirmé ou de son événement serveur ;
- slot ou contrainte de sélection autorisée ;
- `iat`, `nbf` et `exp` ;
- nonce aléatoire ;
- version du schéma d’autorisation.

Paramètres obligatoires :

```text
EJECTION_AUTH_ALGORITHM=NOT_CONFIGURED
EJECTION_AUTH_PUBLIC_KEY=NOT_CONFIGURED
EJECTION_AUTH_KEY_ID=NOT_CONFIGURED
EJECTION_AUTH_ISSUER=NOT_CONFIGURED
EJECTION_AUTH_AUDIENCE=NOT_CONFIGURED
EJECTION_AUTH_MAX_TTL_SECONDS=NOT_CONFIGURED
EJECTION_AUTH_CLOCK_SKEW_SECONDS=NOT_CONFIGURED
EJECTION_AUTH_NONCE_RETENTION_SECONDS=NOT_CONFIGURED
```

Les algorithmes non signés ou dynamiquement imposés par le token sont interdits. L’algorithme et la clé doivent être allowlistés par la configuration locale signée.

### Validation locale

Ordre obligatoire :

1. parser avec une limite de taille ;
2. vérifier version, algorithme et identifiant de clé ;
3. vérifier la signature ;
4. vérifier issuer et audience ;
5. comparer terminal et station au binding local ;
6. vérifier `nbf`, `iat`, `exp` et la durée maximale ;
7. vérifier la cohérence commande/location/slot ;
8. réserver atomiquement `jti` et nonce dans le registre anti-rejeu ;
9. enregistrer la commande dans la file persistante ;
10. seulement ensuite autoriser l’encodage matériel.

Le nonce doit être marqué consommé de façon durable avant l’écriture physique. Après un crash entre écriture et accusé, la commande passe en réconciliation et ne doit pas être réémise automatiquement.

En l’absence de réseau, de configuration cryptographique, d’heure suffisamment fiable ou de registre anti-rejeu disponible, l’éjection échoue fermée.

## File de commandes mono-écrivain

Un service Android unique possède le `TransportSession`. Les activités, la WebView et le backend ne peuvent jamais écrire directement sur le port.

États recommandés :

```text
received
validated
queued
writing
awaiting_ack
confirmed
reconciling
expired
failed
cancelled
```

Contraintes :

- unicité persistante sur `commandId` ;
- unicité sur `jti` et nonce ;
- ordre FIFO pour les commandes ordinaires ;
- une seule commande susceptible de déplacer une batterie à la fois ;
- timeout distinct pour écriture, accusé et observation physique ;
- retry uniquement lorsqu’il est prouvé qu’aucune action physique n’a commencé ;
- aucune seconde écriture après timeout ambigu ;
- réconciliation par état de carte, slot et batterie ;
- reprise après redémarrage depuis le journal persistant ;
- purge uniquement après synchronisation backend et délai de rétention.

## Modèle d’événements

Tous les événements utilisent une enveloppe commune :

```kotlin
data class HardwareEventEnvelope(
    val eventId: String,
    val deviceId: String,
    val stationId: String,
    val sequence: Long,
    val occurredAt: Instant,
    val commandId: String?,
    val rentalSessionId: String?,
    val protocolFamily: String,
    val protocolVersion: String,
    val eventType: HardwareEventType,
    val severity: Severity,
    val sanitizedPayload: Map<String, Any?>
)
```

`sequence` doit être monotone pour un terminal et persisté avant émission. Le backend déduplique sur `eventId` et contrôle les trous de séquence.

### Types d’événements

| Type | Contenu minimal |
|---|---|
| `transport.connected` | identité transport sanitizée |
| `transport.disconnected` | raison et dernière séquence |
| `transport.permission_denied` | type de périphérique, sans commande shell |
| `board.online` / `board.offline` | carte logique et firmware |
| `inventory.snapshot` | slots louables, slots de retour, batteries |
| `slot.state_changed` | slot, ancien et nouvel état |
| `battery.detected` | batterie, slot, type d’observation |
| `ejection.requested` | commande et slot réservé |
| `ejection.accepted` | accusé protocolaire documenté |
| `ejection.confirmed` | observation physique confirmée |
| `ejection.failed` | catégorie d’échec normalisée |
| `battery.taken` | batterie et slot de départ |
| `return.detected` | batterie et slot observés |
| `return.accepted` / `return.rejected` | résultat du rapprochement |
| `tamper.detected` | catégorie et carte concernée |
| `firmware.reported` | versions sans contenu firmware |
| `reconciliation.required` | état ambigu et éléments observés |

Catégories d’échec normalisées :

- `NOT_CONFIGURED` ;
- `PERMISSION_DENIED` ;
- `PORT_UNAVAILABLE` ;
- `PROTOCOL_MISMATCH` ;
- `INVALID_FRAME` ;
- `TIMEOUT_BEFORE_WRITE` ;
- `ACK_TIMEOUT_AMBIGUOUS` ;
- `BATTERY_NOT_FOUND` ;
- `BATTERY_STUCK` ;
- `SLOT_UNAVAILABLE` ;
- `ANTI_THEFT_TRIGGERED` ;
- `AUTHORIZATION_INVALID` ;
- `AUTHORIZATION_EXPIRED` ;
- `REPLAY_REJECTED` ;
- `RECONCILIATION_REQUIRED`.

Les octets bruts ne doivent pas être envoyés au backend par défaut. Une capture de diagnostic exceptionnelle doit être explicitement activée, bornée, chiffrée, filtrée et limitée à un appareil de test.

## Flux d’éjection

```text
Stripe webhook vérifié
  -> backend payment_succeeded
  -> commande matérielle idempotente
  -> autorisation d’éjection signée
  -> vérification Android et anti-rejeu
  -> réservation du slot
  -> file mono-écrivain
  -> encodage par l’adapter validé
  -> écriture transport
  -> accusé protocolaire
  -> observation d’éjection
  -> observation batterie prise
  -> événements backend
  -> activation de la location
```

Un accusé d’écriture n’est pas une confirmation d’éjection. La transition vers `battery_taken` exige une observation matérielle documentée.

Si le paiement est confirmé mais que l’éjection échoue :

- publier `ejection.failed` ou `reconciliation.required` ;
- ne pas annoncer une batterie délivrée ;
- créer un incident backend ;
- déclencher la procédure de remboursement idempotente côté backend lorsque l’échec est certain ;
- requérir une décision opérateur avant toute nouvelle éjection si l’état est ambigu.

## Flux de retour

Le retour est initié par une observation physique, jamais par le navigateur :

1. détection d’insertion ;
2. lecture ou observation de l’identifiant batterie ;
3. vérification du slot et de la station ;
4. émission `return.detected` ;
5. rapprochement backend avec la location active ;
6. acceptation, retour croisé ou incident ;
7. facturation finale côté serveur ;
8. mise à jour d’inventaire et clôture.

Une batterie inconnue ou un retour sans location correspondante doit rester physiquement observé et ouvrir un incident ; l’événement ne doit pas être supprimé.

## ChargeNow

Les paramètres restent non configurés tant que les accès et la documentation officiels ne sont pas fournis :

```text
CHARGENOW_ENVIRONMENT=NOT_CONFIGURED
CHARGENOW_API_BASE_URL=https://developer.chargenow.top/cdb-open-api/v1
CHARGENOW_BASIC_AUTH=NOT_CONFIGURED
CHARGENOW_BASIC_USERNAME=NOT_CONFIGURED
CHARGENOW_BASIC_PASSWORD=NOT_CONFIGURED
CHARGENOW_MUTATIONS_ENABLED=false
CHARGENOW_TIMEOUT_MS=10000
CHARGENOW_CALLBACK_SECRET=NOT_CONFIGURED
CHARGENOW_PROTOCOL_PROFILE=NOT_CONFIGURED
```

Aucune URL ou credential ne doit être repris depuis l’APK fournisseur. Le backend masque les secrets dans les logs et l’APK ne reçoit que les informations strictement nécessaires à l’identité du terminal et aux autorisations courtes.

## Provisionnement matériel

Le provisionnement d’une station doit enregistrer :

- identifiant station et terminal ;
- numéro de série Android ;
- modèle, version Android et version firmware ;
- mécanisme d’accès série autorisé ;
- transport et périphérique sélectionnés ;
- famille et version de protocole validées ;
- nombre de cartes et mapping des slots ;
- versions firmware des cartes ;
- capacités location, retour, disable et diagnostic ;
- hash de la spécification et du jeu de fixtures validés ;
- résultat du self-test ;
- clé publique backend pour les autorisations d’éjection ;
- clé d’identité terminal protégée par Android Keystore.

Le terminal ne doit pas permettre de modifier localement son `stationId` après activation. Un changement exige révocation et nouveau code d’appairage à usage unique.

## Journalisation et données sensibles

Autorisé dans les logs :

- identifiants internes pseudonymisés ;
- type d’événement ;
- état de commande ;
- catégorie d’erreur ;
- version application, protocole et firmware ;
- compteurs et durées.

Interdit :

- clés ChargeNow ou Stripe ;
- connection tokens Stripe ;
- autorisations d’éjection complètes ;
- données carte ou PIN ;
- mots de passe ;
- trames brutes non filtrées ;
- identifiants personnels inutiles ;
- contenu complet des réponses fournisseur.

## Matrice de tests

Tous les tests marqués « matériel manuel » doivent être exécutés sur une borne de test isolée. Aucun paiement live ni éjection réelle ne doit être lancé par la CI.

| ID | Couche | Scénario | Résultat attendu | Mode |
|---|---|---|---|---|
| CFG-01 | Configuration | transport `NOT_CONFIGURED` | activation refusée, aucun port ouvert | automatisé |
| CFG-02 | Configuration | protocole `NOT_CONFIGURED` | commande refusée explicitement | automatisé |
| TRN-01 | Transport | périphérique absent | `PORT_UNAVAILABLE`, aucun retry infini | automatisé avec fake |
| TRN-02 | Transport | permission refusée | `PERMISSION_DENIED`, aucun `su`/`chmod` | automatisé + appareil |
| TRN-03 | Transport | déconnexion/reconnexion USB | session fermée puis redécouverte sans perdre le journal | matériel manuel |
| TRN-04 | Transport | écriture partielle ou timeout | état déterministe, pas de double écriture | fake + matériel manuel |
| TRN-05 | Transport | deux clients tentent d’écrire | un seul propriétaire du port | automatisé |
| PRO-01 | Protocole | frame valide officielle | message de domaine attendu | fixtures fournisseur |
| PRO-02 | Protocole | frame fragmentée | reconstitution bornée correcte | automatisé |
| PRO-03 | Protocole | plusieurs frames concaténées | séparation correcte | automatisé |
| PRO-04 | Protocole | CRC/longueur invalide | rejet et événement sanitizé | automatisé |
| PRO-05 | Protocole | type inconnu | rejet sans crash | automatisé |
| PRO-06 | Protocole | frame surdimensionnée | rejet avant allocation non bornée | automatisé |
| CTL-01 | Controller | inventaire normal | snapshot stable cartes/slots/batteries | matériel manuel |
| CTL-02 | Controller | deux réservations du même slot | une seule réservation réussit | automatisé |
| CTL-03 | Controller | stock vide | aucune commande d’éjection | automatisé + matériel |
| CTL-04 | Controller | slot signalé indisponible | sélection refusée | automatisé |
| AUT-01 | Sécurité | signature invalide | rejet avant mise en file | automatisé |
| AUT-02 | Sécurité | autorisation expirée | `AUTHORIZATION_EXPIRED` | automatisé |
| AUT-03 | Sécurité | mauvais terminal ou station | rejet | automatisé |
| AUT-04 | Sécurité | slot modifié | rejet cryptographique ou de cohérence | automatisé |
| AUT-05 | Sécurité | même `jti` ou nonce réutilisé | `REPLAY_REJECTED` | automatisé |
| AUT-06 | Sécurité | clé révoquée | rejet immédiat | automatisé |
| AUT-07 | Sécurité | horloge non fiable | échec fermé | automatisé |
| QUE-01 | File | double soumission du `commandId` | une seule commande persistée | automatisé |
| QUE-02 | File | crash avant écriture | reprise ou expiration sans éjection | automatisé |
| QUE-03 | File | crash après écriture avant ACK | réconciliation, aucune réémission aveugle | fake + matériel |
| QUE-04 | File | ACK dupliqué | événement idempotent | automatisé |
| EJT-01 | Éjection | paiement non confirmé | aucune autorisation et aucune écriture | E2E test |
| EJT-02 | Éjection | paiement confirmé | une seule éjection, événements ordonnés | matériel manuel |
| EJT-03 | Éjection | batterie coincée | incident, pas de succès client | matériel manuel |
| EJT-04 | Éjection | timeout avant action certain | échec contrôlé selon spécification | matériel manuel |
| EJT-05 | Éjection | timeout ambigu | réconciliation, pas de seconde éjection | matériel manuel |
| EJT-06 | Éjection | batterie non retirée | location non activée sans événement requis | matériel manuel |
| RET-01 | Retour | batterie attendue | retour rapproché et inventaire mis à jour | matériel manuel |
| RET-02 | Retour | batterie inconnue | incident, observation conservée | matériel manuel |
| RET-03 | Retour | retour croisé | rapprochement selon politique backend | E2E + matériel |
| RET-04 | Retour | aucun slot libre | message indisponible sans faux retour | matériel manuel |
| NET-01 | Réseau | perte réseau avant autorisation | éjection refusée | automatisé |
| NET-02 | Réseau | perte après éjection | journal local puis synchronisation idempotente | matériel manuel |
| BOOT-01 | Android | redémarrage sans commande | service restauré, diagnostic disponible | matériel manuel |
| BOOT-02 | Android | redémarrage avec commande ambiguë | réconciliation avant nouvelle commande | matériel manuel |
| SEC-01 | Android | tentative de sortie kiosque | Lock Task/Device Owner reste actif | matériel manuel |
| SEC-02 | Android | terminal révoqué | commandes refusées, diagnostic limité | E2E + matériel |
| STR-01 | Stripe | Terminal absent | parcours QR Checkout reste utilisable | E2E test |
| STR-02 | Stripe | lecteur USB connecté | seul le sous-système Stripe le revendique | matériel manuel |
| OPS-01 | Opérations | self-test contrôlé | aucun mouvement sans confirmation opérateur | matériel manuel |

## Conditions d’activation d’une borne

Une borne ne peut passer à l’état actif que si :

- tous les paramètres `NOT_CONFIGURED` indispensables sont renseignés ;
- l’accès au périphérique fonctionne sans root ni changement global de permissions ;
- la famille et la version de protocole sont liées à une spécification autorisée ;
- les fixtures de conformité passent ;
- l’inventaire correspond physiquement aux slots ;
- le terminal est provisionné et lié à une seule station ;
- la vérification des autorisations signées et l’anti-rejeu passent ;
- un test de coupure/reprise ne provoque pas de double éjection ;
- le test de retour est concluant ;
- les logs ne contiennent aucun secret ni trame brute ;
- le parcours Stripe Checkout test déclenche l’autorisation uniquement après webhook ;
- un échec post-paiement ouvre un incident et la procédure de remboursement ;
- le test matériel final est signé par l’opérateur responsable.

Tant que ces conditions ne sont pas satisfaites, le statut de l’intégration reste **TERMINÉ — TEST MATÉRIEL REQUIS** et la borne doit rester en staging ou en maintenance.
