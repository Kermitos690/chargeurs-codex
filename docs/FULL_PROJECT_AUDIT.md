# Audit complet Chargeurs.ch avant déploiement terrain

## Cadre et niveau de preuve

- Date de l'audit : 9 août 2026.
- Dépôt : Kermitos690/chargeurs-codex.
- Commit de travail audité : 757a6009fba7d0e819e6f8cfef07cfab41677198, branche codex/staging-qr-i18n.
- Nature : lecture seule. Aucun déploiement, paiement Stripe Live, mutation ChargeNow, éjection, redémarrage de borne, verrouillage/déverrouillage, ni migration n'a été réalisé pendant cet audit.
- Borne pilote examinée : DTA21269, environnement staging.

Les termes utilisés dans ce rapport ont des sens stricts :

| Terme | Signification |
|---|---|
| IMPLEMENTED | Le code existe dans une branche ou dans le projet Supabase. |
| TESTED | Un test automatisé identifié a réellement été exécuté. |
| DEPLOYED | Une version est attestée comme déployée, pas seulement compilée. |
| CALLED | Un service a réellement reçu une requête. |
| PAYMENT_TESTED | Un vrai parcours Stripe Test a été observé. |
| HARDWARE_TESTED | Une vraie commande a atteint le fournisseur ou le matériel. |
| PHYSICALLY_VERIFIED | Une personne a observé le résultat matériel. |
| PRODUCTION_READY | Des preuves couvrent le scénario complet sans supervision permanente. |

Une réponse HTTP 200, une compilation réussie, une image de spinner, ou une table contenant un slot ne sont jamais interprétés comme une preuve d'éjection, de retour, de règlement ou de disponibilité réelle.

## Résumé exécutif

Verdict terrain autonome : **NO**.

Le projet contient un socle sérieux : kiosk Android, React, Supabase, Stripe Checkout hébergé par QR, règles de tarification, garde-fous de mutation ChargeNow, webhook Stripe signé et éléments de journalisation. Un paiement Stripe Test et une sortie physique contrôlée ont été rapportés par l'opérateur sur DTA21269.

Cependant, le flux critique n'est pas réconcilié de bout en bout. Des locations prépayées restent dans l'état ejecting après paiement, le callback ChargeNow est rejeté 401, la borne et le téléphone peuvent rester indéfiniment sur des écrans d'attente, la sélection de slot peut être perdue au rafraîchissement, et le retour/règlement final n'est pas prouvé automatiquement. Les données d'inventaire sont contradictoires ou obsolètes : DTA21269 est marquée en ligne et avec quatre batteries louables alors que les lignes de batterie sont non qualifiées et anciennes.

La borne peut servir uniquement à un **pilote contrôlé avec opérateur présent**, jamais à des clients réels sans surveillance.

## 1. Version canonique et branches

### CANONICAL_BRANCH_RECOMMENDATION

| Élément | Résultat |
|---|---|
| Branche recommandée comme base d'intégration | agent/finalize-chargeurs-platform, portée par la PR #36 |
| Head connu de cette ligne | 9faf102 |
| Branche du travail UX/QR actuellement auditée | codex/staging-qr-i18n |
| Commit auditée sur cette branche | 757a6009fba7d0e819e6f8cfef07cfab41677198 |
| État de main | 7eea69f, 19 juillet 2026, ancien et incomplet |
| Changements QR / CORS / i18n importants | PR #46, ouverte, divergent de #36 et non validée par une CI GitHub à son head |
| APK 1.0.15 staging | PR #42, fusionnée dans #36 uniquement, pas dans main |

PR #36 est la seule ligne qui rassemble réellement le socle Android, Supabase et ChargeNow. PR #46 porte les dernières corrections QR/i18n/CORS et doit être rebasée/réconciliée sur #36, pas fusionnée aveuglément. Une fusion dans le mauvais sens peut perdre soit les normalisations ChargeNow, soit les corrections de paiement/UX.

| PR | État | Décision auditée |
|---|---|---|
| #36 | Brouillon ouvert, 263 commits d'avance, 0 retard | Base d'intégration à vérifier puis finaliser. |
| #46 | Brouillon ouvert, 50 commits d'avance, 1 retard, conflits avec #36 | Rebaser sur #36, résoudre avec revue de flux. |
| #42 | Mergée dans #36 | Conserver son historique APK 1.0.15 comme preuve CI, pas comme release production. |
| #40 | Validation/read-only isolée | Réconcilier sélectivement; ne pas supposer qu'elle est déployée. |
| #39 / #41 | Outils de diagnostic isolés | Réutiliser seulement si leur code est revu et réintégré. |
| #37 / #38 | Déploiements échoués | Fermer ou documenter après correction des secrets/targets. |
| #34 / #16 | Anciennes ouvertes | Examiner puis abandonner si obsolètes. |

Risque de perte fonctionnelle : **élevé** tant que #36 et #46 ne sont pas réconciliées, testées au head exact et reliées à un déploiement Vercel/Supabase identifiable.

## 2. Architecture observée

Parcours logique observé :

    Utilisateur sur téléphone
    -> Kiosk React dans WebView Android
    -> create-rental-session
    -> Supabase PostgreSQL/RPC/RLS
    -> create-stripe-checkout
    -> Stripe Checkout Test hébergé
    -> stripe-webhook signé
    -> eject-after-payment
    -> Cloud ChargeNow
    -> DTA21269, slot et batterie
    -> chargenow-rent-callback ou réconciliation
    -> état kiosk / retour / pricing final / settlement / reçu

| Domaine | Composants observés | État factuel |
|---|---|---|
| Clients | Android kiosk, WebView, React kiosk, PWA, page mobile Pay, site public, espace client, admin | IMPLEMENTED, maturité hétérogène. |
| Backend | Supabase PostgreSQL, Auth, RLS, migrations, RPC, Edge Functions | DEPLOYED en staging, provenance migration/fonction à réconcilier. |
| Paiement | Stripe Checkout par QR, PaymentIntent, webhook, dépôt de 30 CHF | PAYMENT_TESTED en Test; règlement final/remboursement non prouvé. |
| Matériel | API ChargeNow, snapshot cabine/slots/batteries, éjection gated, callbacks | Reads et mutation contrôlée observés; confirmation automatique cassée. |
| Infra | Vercel, GitHub Actions, artefact APK, configuration staging | Partiellement attestée; déploiement frontend et provenance APK non suffisamment traçables. |

## 3. État spécial DTA21269

### Lecture staging au moment de l'audit

| Champ | Valeur observée | Interprétation |
|---|---|---|
| Environnement | staging / pilote | Pas une borne production. |
| Statut station | online | Contradictoire avec la fraîcheur de données; ne prouve pas l'état réel. |
| Dernier sync / succès fournisseur | 8 août 2026 21:59:54 UTC pour la station | Obsolète au regard d'une exploitation commerciale; quelques batteries ont un horodatage ultérieur. |
| Batteries station | 4 déclarées | Ne signifie pas quatre batteries louables. |
| Qualification | read_only | Pas une qualification de santé production. |
| Tarification station | 0.75 CHF / 30 min, CHF | Correspond au pilote attendu, mais doit être vérifié par snapshot transactionnel. |
| Éjection | Autorisée uniquement via permit contrôlé pendant les essais | Non adaptée à une borne autonome. |

### Snapshots batterie observés

| Slot | Batterie | Etat inventaire | Niveau stocké | Fraîcheur / qualification | Décision sûre |
|---|---|---|---:|---|---|
| 1 | FECA02C714 | in_station | 77 | confidence unknown, metric kind unknown, untested | Ne pas dire prête sans nouvelle qualification. |
| 2 | F0F0004944 | in_station | 36 | inventory_seen, pricing_eligible false | Ne pas proposer automatiquement. |
| 3 | F0F00045BC | in_station | 0 | inventory_seen, non qualifiée | Diagnostiquer batterie/slot; pas de location. |
| 4 | F0F000503E | in_station | 52 | valeur plus récente 8 août 23:09:10 UTC, non qualifiée | Lecture à recouper avant location. |

Les photos terrain ont affiché notamment 56/58/0/81 ou 57/62/0/inconnu. Cela démontre que l'UI reçoit des valeurs évolutives, mais pas leur sémantique ni leur exactitude. Les indicateurs C4/C7/C8 ne sont pas encore fusionnés dans une vérité unique et fraîche.

### Incidents et locations observés

- Trois locations Stripe Test prépayées sont restées en ejecting avec EJECTION_PROVIDER_CONFIRMATION_PENDING.
- Une location de test a été manuellement réconciliée : paiement 30 CHF capturé, batterie de slot 4 déclarée sortie puis retournée, mais montant final nul et remboursement nul. C'est une preuve d'un parcours manuel, pas d'un règlement automatisé.
- Les journaux Stripe récents montrent les évènements checkout.session.completed et checkout.session.expired traités; aucun async_payment_succeeded observé dans la fenêtre auditée.
- Aucun incident DTA21269 n'a été trouvé dans system_incidents malgré les locations bloquées. L'alerting métier est donc insuffisant.
- L'opérateur a rapporté et photographié une batterie sortie lors d'un test autorisé. C'est PHYSICALLY_VERIFIED par témoignage opérateur, mais la confirmation fournisseur automatique et l'UI terminale n'ont pas suivi.

## 4. Parcours client kiosk et machine à états

### Etats présents dans le code UI

| Etat UI | Existe | Traduction principale | Sortie de secours actuelle | Risque |
|---|---:|---:|---|---|
| loading | Oui | Partielle | Chargement normal | Peut rester si API silencieuse. |
| idle | Oui | FR/EN/DE principales | Rafraîchir / choisir slot | Inventaire contradictoire. |
| pricing | Oui | Partielle | Retour | Prix affiché non garanti égal au final. |
| starting | Oui | Partielle | Aucun vrai timeout transactionnel | Double clic/concurrence. |
| qr | Oui | Principales présentes | Annuler / expiration | QR fonctionne visuellement. |
| waitpay | Oui | Principales présentes | Aucun timeout réel, spinner durable | P0. |
| success | Oui | Partielle | Absence de confirmation durable | Peut être écrasé par polling ancien. |
| error | Oui | Partielle | Recommencer | Peut masquer diagnostic. |
| support | Oui | Partielle | Recommencer reset | Peut masquer une location payée. |
| expired | Oui | Partielle | Recommencer | Nécessite idempotence vérifiée. |

Machine attendue :

    quote
    -> checkout_created
    -> payment_pending
    -> payment_succeeded
    -> release_requested
    -> ejected
    -> active_rental
    -> return_detected
    -> settlement
    -> completed

Branche incident attendue :

    payment_pending -> payment_expired ou payment_failed
    release_requested -> eject_ambiguous -> manual_review

La machine réelle diverge : la couche UI accepte payment_succeeded et ejecting comme attente permanente; l'orchestrateur contient des états legacy/récents non unifiés; et le retour peut être manuellement corrélé sans règlement final.

### Défauts prouvés par le code et les photos

1. payment_succeeded et ejecting restent en waitpay sans délai maximal dans src/pages/Kiosk.tsx lignes 246-267, 370-391 et 800-808; la page mobile Pay fait de même.
2. Le polling setInterval async n'a ni verrou, ni AbortController, ni garde monotone. Une ancienne réponse payment_succeeded peut remplacer une réponse ejected.
3. Le rafraîchissement inventaire reste actif pendant le flux. Il peut effacer selectedSlotNum; la scène rend alors un point d'interrogation.
4. La session client est uniquement dans React useState. Un crash WebView/redémarrage peut abandonner l'affichage d'une location payée.
5. Support/recommencer appelle un reset UI sans garder une référence client durable.

## 5. Audit UX / UI

### UX_READY = NO

Les écrans ont une identité visuelle en construction, le QR est lisible lorsqu'il apparaît et l'action de paiement par téléphone est conceptuellement claire. Mais l'expérience n'est pas prête grand public :

- l'information critique de slot peut disparaître ou devenir inconnue;
- des spinners infiniment longs sont montrés après paiement;
- la borne et le téléphone ne donnent pas d'issue opérationnelle claire;
- la résolution effective affichée sur les photos ne correspond pas de manière démontrable à la scène 16:9 attendue;
- les grands espaces vides, l'échelle des cartes et les états d'attente empêchent une lecture immédiate à 1–2 mètres;
- aucune récupération durable après rechargement/WebView crash n'est prouvée;
- une disponibilité affichée peut être basée sur des données stale ou non qualifiées.

La scène 3D est IMPLEMENTED dans les composants récents, mais elle n'est pas une preuve de transition fonctionnelle ni d'affichage du bon slot. Les photos avec Releasing powerbank et un badge inconnu confirment cette limite.

## 6. Audit i18n

| Écran | FR | EN | DE | Dynamique | Persistant | Problème |
|---|---|---|---|---|---|---|
| Accueil kiosk | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | Oui | localStorage | EN/DE commencent par étendre FR; traduction exhaustive non garantie. |
| Choix/confirmation | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | Oui | Oui dans même WebView | Textes secondaires/hardcodes à vérifier. |
| QR paiement | IMPLEMENTED après correctifs récents | IMPLEMENTED | IMPLEMENTED | Oui | Oui | Pas de preuve staging au HEAD exact. |
| Etats post-paiement | Principales clés présentes | Principales clés présentes | Principales clés présentes | Oui | Non après reboot | Etat peut être erroné plutôt que non traduit. |
| Page téléphone Pay | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED | Locale locale | Locale propre au téléphone | locale Checkout et success/cancel URL non corrélées. |
| Diagnostics/runtime guard | Partiel | Partiel | Partiel | Partiel | N/A | Français hardcodé. |
| Admin | Majoritairement FR | Non exhaustif | Non exhaustif | N/A | N/A | Pas prêt multilingue. |
| Android natif | FR hardcodé | Non exhaustif | Non exhaustif | N/A | N/A | strings.xml non complet. |
| Emails | Documents/modèles partiels | Non prouvé | Non prouvé | Non prouvé | N/A | Aucun envoi staging brandé reçu pendant audit. |

Preuves : src/i18n/i18n.tsx construit EN et DE en étendant initialement FR; src/pages/KioskHome.tsx, src/components/kiosk/KioskRuntimeGuard.tsx, src/components/kiosk/KioskDiagnostics.tsx et des strings Android gardent des textes codés. Le kiosk transmet lang à Checkout, mais les success_url/cancel_url ne propagent pas explicitement cette langue. Les photos montrent précisément un kiosk EN et un téléphone FR.

## 7. Inventaire, slots, batteries et sélection

Le code utilise ou prévoit les lectures C4 Cabinet Detail, C7 Battery List By Cabinet et C8 Slot List By Cabinet. Aucune preuve ne permet aujourd'hui de considérer l'un de ces endpoints comme vérité absolue. Il faut conserver toutes les sources, horodatages, champs bruts et conflits.

Le système ne démontre pas encore un snapshot interne fiable comprenant : slot, battery_id, présence, charge, température, online, health, self-check, erreurs, rentable, confiance, horodatages de sources et conflits.

Les champs ChargeNow non documentés ne doivent jamais servir à produire un pourcentage, une température ou un statut prêt.

| Question | Réponse auditée |
|---|---|
| Un utilisateur peut choisir un slot ? | Oui, côté UI. |
| Le slot est-il revalidé atomiquement au paiement ? | Partiellement; pas de réservation DB atomique prouvée. |
| Un slot 0/ambigu est-il empêché partout ? | Non suffisamment prouvé. |
| La batterie la mieux chargée est-elle choisie sur données fiables ? | NON. |
| Peut-on garantir que la batterie payée est celle délivrée ? | **NO**. |
| Peut-on distinguer vide / défaut / charge / donnée stale ? | Partiellement et pas de manière cohérente côté client. |

Deux demandes différentes peuvent passer le test de disponibilité avant l'insertion, car l'unicité ne couvre que l'idempotency key. Il manque une réservation atomique par station/slot pour les sessions non terminales.

Une batterie n'est prête que si présence, identité, slot, fraîcheur, données de charge documentées, absence de faute bloquante, température normale, self-check valable et possibilité fournisseur d'éjection sont confirmés. Sinon l'UI doit dire vérification ou indisponible, tandis que l'admin affiche la raison et la source.

## 8. Tarification

| Paramètre | Valeur attendue |
|---|---:|
| Devise | CHF |
| Prix période | 0.75 CHF |
| Période | 30 minutes |
| Prix horaire calculé | 1.50 CHF |
| Plafond journalier | 18 CHF |
| Garantie/dépôt | 30 CHF |
| Non-retour maximum | 99 CHF |

Le code contient price_profiles, assignments, résolution et snapshot. La station DTA21269 expose 0.75 CHF. Mais l'audit ne prouve pas les cas 1/29/30/31 minutes, plafonnement journalier, non-retour, arrondis, ni l'égalité entre montant présenté, PaymentIntent capturé et montant final. Une location retournée observée reste à captured=3000, refunded=0, final_amount=null. Cette absence de settlement est un bloqueur financier.

## 9. Stripe Test et garantie

### Ce qui est établi

- Stripe Checkout est hébergé et lancé depuis un QR; la borne ne collecte pas de données bancaires.
- Checkout Stripe Test a été atteint depuis un téléphone; un paiement Test TWINT a été attesté visuellement par l'opérateur au cours des essais antérieurs.
- Le webhook Stripe est signé, persisté dans une inbox retryable et traite checkout.session.completed, checkout.session.expired, PaymentIntent et les chemins async prévus.
- Le code utilise des moyens de paiement dynamiques plutôt qu'une liste uniquement card.
- CHF et locale sont transmis à la création Checkout.

### Ce qui n'est pas établi

| Moyen | Configuré / code | Affiché sur appareil éligible | Paiement Test observé | Production-ready |
|---|---|---|---|---|
| TWINT | Oui, contexte Test observé | Oui, test précédemment photographié | Oui, attesté | Non |
| Apple Pay | Configuration dynamique prévue | Non prouvé | Non | Non |
| Google Pay | Configuration dynamique prévue | Non prouvé | Non | Non |
| Link | Configuration dynamique prévue | Non prouvé | Non | Non |
| Carte sur téléphone | Checkout hébergé | Non formellement prouvé dans cet audit | Non | Non |

Le modèle financier actuel correspond à un débit/dépôt de 30 CHF avec règlement/remboursement ultérieur, non à une préautorisation universelle démontrée. Les moyens tels que TWINT ne se comportent pas comme une autorisation différée carte. L'UX ne doit jamais promettre une garantie libérée avant de connaître le comportement réel du moyen et l'état final de settlement.

## 10. Webhook Stripe vers éjection

Chemin codé :

    Stripe Checkout Test
    -> stripe-webhook signé
    -> rental_session / paiement
    -> eject-after-payment
    -> ChargeNow
    -> chargenow-rent-callback ou réconciliation

Garde-fous observés :

- CHARGENOW_MUTATIONS_ENABLED;
- HARDWARE_EJECTION_ENABLED;
- allowlist station;
- permit unique de test;
- idempotence de la commande;
- absence de retry automatique dangereux après réponse matériel ambiguë.

Ces garde-fous sont positifs. Ils prouvent également que le système n'est pas conçu pour une borne sans surveillance dans son état staging actuel.

### P0 : callback ChargeNow brisé

Les quatre callbacks observés en 24 h ont reçu 401. Le générateur construit une URL contenant :

    ?rental=<uuid>&amp%3Btoken=<token>

ChargeNow transmet donc amp;token; le validateur ne lit que token. Les fichiers sont :

- supabase/functions/_shared/chargenowCallbackAuth.ts, lignes 50-84;
- supabase/functions/chargenow-rent-callback/index.ts, lignes 272-294;
- supabase/functions/eject-after-payment/index.ts, lignes 601-620.

Le code maintient volontairement les sessions en confirmation fournisseur pending plutôt que de répéter une commande ambiguë. C'est le comportement matériel sûr, mais le callback cassé rend ces sessions indéfiniment bloquées.

## 11. ChargeNow : inventaire d'API

Catégories d'opérations présentes dans le connecteur source :

| Catégorie | Opérations | Niveau audit |
|---|---|---|
| Auth/read cabinet | oauth2Login, cabinetQuery, cabinetDetail, cabinetListGeo, getDeviceByShopId, getAllDevicePage | READ_UNVALIDATED sauf lectures DTA vues indirectement. |
| Read batteries/slots | batteryListByCabinetId, slotByCabinetId | READ_UNVALIDATED; contradictions observées. |
| Read orders | orderQuery, orderDetail, orderList | READ_UNVALIDATED. |
| Read shops/pricing | getShopList, shopDetail, priceStrategyPage, priceStrategyDetail | READ_UNVALIDATED. |
| Ejection/location | orderCreate, orderCreateWithOneTimeRentalPermit, ejectByRent, ejectByRentWithOneTimeRentalPermit, ejectByRepair, ejectByRepairWithOneTimePermit, orderClose | MUTATION_STAGING_TESTED partiellement; PHYSICALLY_VALIDATED seulement par témoignage contrôlé, pas par callback automatique. |
| Cabinet maintenance | cabinetOperation, operationPop | MUTATION_NOT_TESTED pendant audit. |
| Shop mutation | bind2shop, unbindShop, shopCreate, shopUpdate, shopDelete | MUTATION_NOT_TESTED. |
| Advertising | bindAd, publishAd | MUTATION_NOT_TESTED. |
| Price mutation | priceStrategySave, priceStrategyDelete, priceStrategyBind, priceStrategyUnbind | MUTATION_NOT_TESTED. |
| Event push config | eventPushConfig, eventPushConfigGet | Config GET READ_UNVALIDATED; mutation non testée. |

Les noms proviennent de supabase/functions/_shared/chargenow.ts. Leur existence ne prouve pas une documentation fournisseur complète ni un comportement stable.

## 12. Retour batterie

Le modèle veut corréler rental -> batterie -> station -> slot -> temps -> pricing. Le code impose un lien strict station/slot/batterie pour éviter de fermer une mauvaise location, ce qui est positif.

Ce qui manque :

- preuve d'un retour automatiquement détecté et réconcilié sans intervention;
- preuve de retour dans un autre slot;
- preuve de retour dans une autre borne;
- comportement en fournisseur offline;
- déclenchement de prix final, remboursement/capture et reçu;
- système d'incident lorsque la batterie est physiquement revenue mais non reconnue.

La seule séquence observée est une réconciliation humaine indiquant return_detected; elle ne valide pas la détection automatique.

## 13. Supabase, schéma, migrations et RLS

### Schéma / migrations

Le projet contient des tables/rôles adaptés au domaine : stations, batteries, rental_sessions, payments, kiosk_devices, pairing codes, incidents et journaux. Les migrations locales et la base staging divergent :

- plusieurs migrations sont locales uniquement, dont 20260808000001 et 20260808000002;
- de nombreuses migrations existent côté remote sans équivalent local;
- la définition déployée de kiosk_session_status correspond à une migration locale mais son inscription dans le ledger est incohérente.

La provenance du schéma n'est donc pas reproductible à partir du dépôt seul. C'est P1 avant production.

### RLS observée

RLS est activée sur batteries, stations, rental_sessions, payments, kiosk_devices, kiosk_pairing_codes et system_incidents. Les policies staff/client existent sur les locations et paiements. Toutefois :

- batteries et stations ont une lecture publique; il faut vérifier que les champs raw provider/battery identifiers ne permettent pas d'exposer plus que nécessaire;
- kiosk_quote et kiosk_session_status sont SECURITY DEFINER publiquement appelables par capacité; ils doivent être audités contre rate limiting, énumération et réutilisation de code;
- plusieurs SECURITY DEFINER de rôles sont appelables par authenticated, à revoir pour search_path et privilèges;
- l'adviser Supabase indique que la protection contre mots de passe compromis Auth est désactivée;
- des alertes de performance signalent des RLS initplan/permissive policies. Ce n'est pas le blocage matériel, mais peut nuire à l'exploitation.

## 14. Pairing kiosk et secrets

Le projet prévoit code de pairing, token device, binding station et headers X-Kiosk-Token. Aucun secret n'est affiché dans ce rapport.

Points non prouvés :

- expiration/revocation réellement testées;
- réappairage après vol/tablette remplacée;
- protection contre brute force et rate limiting pairing;
- récupération de session de location active après reboot;
- séparation effective et rotation staging/production.

Des secrets sont présents dans Supabase sous des noms cohérents avec Stripe, ChargeNow, flags et URLs. Leur valeur n'a pas été lue ni rapportée. Leur présence ne prouve ni la bonne valeur ni la séparation production.

## 15. Android APK

| Sujet | Preuve / constat |
|---|---|
| Package source | ch.chargeurs.kiosk; variant staging ch.chargeurs.kiosk.staging. |
| Version source | versionCode 115, versionName 1.0.15-staging pour staging. |
| Signature staging | debug/test only; non acceptable comme release production. |
| Hardware staging | HARDWARE_EJECTION_ENABLED=false dans le build source. |
| Release signing | dépend d'un keystore externe non vérifié. |
| Réseau | HTTPS / cleartext false, Safe Browsing et restrictions WebView implémentées. |
| Debug WebView staging | activé dans BuildConfig.DEBUG. |
| Kiosk lock task | dépend d'un DPC externe, non testé. |
| Boot | BootReceiver gère LOCKED_BOOT_COMPLETED mais le manifest ne l'enregistre pas; autonomie boot non prouvée. |
| Orientation | pas d'orientation Android forcée alors que la borne terrain est paysage; PWA indique portrait. |
| APK artifact | Artefact GitHub 1.0.15 staging attesté via run 30846463013, expiration 17 août; SHA-256 non vérifié durant audit. |

Conclusion : 1.0.15-staging est un artefact de test, pas une APK installable production dont la mise à jour, la signature et la conservation de pairing sont prouvées.

## 16. PWA, WebView, Vercel et CORS

Le code prévoit no-store sur les routes kiosk, PWA contrôlée et désactivation dans le wrapper Android. Cela réduit les risques de cache, mais ne suffit pas :

- HTML NetworkFirst de 5 secondes et assets CacheFirst 30 jours;
- bundle principal environ 1.14 MiB non compressé, avertissement Vite > 500 kB;
- la page staging observée à 1280x720 ne contenait pas des marqueurs du head 757a600; asset observé index-CNB95TaM.js;
- les checks Vercel liés aux PR pointent vers un projet esim-telegram-bot, pas une preuve du déploiement Chargeurs;
- les corrections CORS/QR peuvent exister dans le code sans être la version servie à la tablette.

Les CORS headers, X-Kiosk-Token, X-Idempotency-Key et les Edge Functions doivent être validés par un test de navigateur/tablette contre le déploiement réellement affiché, avec SHA de build visible.

## 17. Back-office, observabilité et alertes

L'admin contient des pages stations, locations, paiements, maintenance et flow health. Il ne permet pas encore une exploitation fiable :

- AdminRentals et AdminPayments ignorent des erreurs API/RLS et peuvent afficher du vide comme 0;
- AdminRentalFlowHealth n'applique pas de seuils de fraîcheur ni d'alerting;
- system_incidents ne reflète pas les locations bloquées observées;
- le diagnostic kiosk est ouvrable par cinq taps et peut permettre une action d'update sans vérifier busy; il doit être restreint à un opérateur;
- aucune alerte prouvée pour callback 401, paiement capturé sans éjection, éjection sans battery_released, donnée ChargeNow stale, slots défectueux, ou application kiosk non vue.

En cas de litige client, la reconstruction est **PARTIAL** : correlation_id, rental_session, paiement et événements existent souvent, mais la confirmation fournisseur/callback, l'identité batterie et le règlement final ne sont pas fiables.

## 18. Emails, reçus et branding

La marque Chargeurs.ch est visible dans le kiosk et des documents de modèles existent. Les limites :

- aucun e-mail Supabase Auth brandé n'a été envoyé/reçu/testé pendant audit;
- les emails transactionnels de paiement/location/retour/remboursement ne sont pas prouvés;
- aucun reçu/facture final cohérent avec la garantie, le prix final et le remboursement n'a été observé;
- les contenus FR/EN/DE des emails ne sont pas validés;
- les coordonnées légales/fiscales ne doivent pas être inventées.

Stripe Checkout conserve sa propre page hébergée; la personnalisation ne doit utiliser que les options Stripe réellement disponibles. Elle ne doit pas promettre un pixel-perfect Chargeurs.ch.

## 19. GitHub Actions et CI/CD

| Preuve | Résultat | Limite |
|---|---|---|
| Actions run 30846463013, PR #42 | Vert; build staging/apksigner | Head #42/#36, pas le head actuel #46. |
| PR #36 head 9faf102 | Pas de CI GitHub trouvée pour ce head | Pas une base intégrée validée. |
| PR #46 head | Pas de CI GitHub trouvée | QR/i18n non validés sur head. |
| Runs #37 / #38 | Echec secrets/target | Déploiement infra non fiable. |
| Vercel status | Présent mais projet eSIM | Ne valide pas Chargeurs.ch. |
| Main | Ancien | Ne contient pas la plateforme actuelle. |

Un mauvais commit peut aujourd'hui être mis en ligne sans que le bon workflow, le bon projet Vercel, le bon projet Supabase et la version Android installée soient reliés par un SHA unique.

## 20. Tests exécutés pendant cet audit

| Commande | Résultat |
|---|---|
| npm run typecheck | PASS |
| npm run lint | PASS avec 15 warnings Fast Refresh, 0 erreur |
| npm test | PASS : 30 fichiers, 107 tests |
| npm run build | PASS : PWA générée, 15 entrées précachées, avertissement bundle principal >500 kB |
| ./gradlew test lintStaging | NON EXÉCUTÉ : Java Runtime absent dans l'environnement d'audit |
| E2E navigateur contre staging | NON EXÉCUTÉ comme preuve de transaction |
| Stripe Test créé pendant audit | INTERDIT / NON EXÉCUTÉ |
| ChargeNow mutation pendant audit | INTERDITE / NON EXÉCUTÉE |

Les tests passés sont principalement unitaires/fonctions pures. Ils ne prouvent pas les courses de polling, la reprise WebView, les callbacks Fox transformés, l'éjection, le retour, le remboursement, le boot Android ou un déploiement Vercel précis.

## 21. Findings classés

### ID: P0-01

Severity: P0 BLOCKER  
Subsystem: ChargeNow callback / orchestration  
Title: Callback fournisseur rejeté parce que le token est encodé en amp;token  
Current behavior: Les callbacks récents renvoient 401; les locations payées restent en confirmation fournisseur pending.  
Expected behavior: Le callback authentifié doit être accepté, idempotent et faire avancer l'état vers une confirmation ou un incident explicite.  
Evidence: URL observée avec amp%3Btoken; chargenowCallbackAuth.ts lignes 50-84; chargenow-rent-callback index.ts lignes 272-294; quatre 401 en 24 h.  
Files: supabase/functions/_shared/chargenowCallbackAuth.ts; supabase/functions/chargenow-rent-callback/index.ts.  
Database objects: rental_sessions, payment/rental events, callback logs.  
Functions: chargenow-rent-callback, eject-after-payment.  
Reproduction: Envoyer une callback avec paramètre amp;token généré par la configuration actuelle.  
Customer impact: Client payé sans confirmation de délivrance.  
Operational impact: Sessions bloquées et réconciliation manuelle.  
Security/financial impact: Dépôt capturé sans clôture fiable; risque de litige.  
Recommended fix: Une seule capacité signée; compatibilité temporaire amp;token; test de non-régression avec URL réellement transformée.  
Estimated complexity: S/M.  
Dependencies: Contrat callback ChargeNow.  
Blocks field deployment: YES.

### ID: P0-02

Severity: P0 BLOCKER  
Subsystem: Kiosk / post-payment polling  
Title: Paiement confirmé peut rester indéfiniment sur un spinner  
Current behavior: waitpay n'a ni délai borné ni action de récupération, et les réponses de polling peuvent régresser.  
Expected behavior: Etat monotone délivrée/incidente/expirée avec référence publique et reprise après crash.  
Evidence: Kiosk.tsx lignes 246-267, 359-391, 800-808; Pay.tsx lignes 21-34/60-66; photos téléphone et borne.  
Files: src/pages/Kiosk.tsx; src/pages/Pay.tsx; src/lib/kioskPaymentState.ts.  
Database objects: kiosk_session_status, rental_sessions.  
Functions: reconcile-pending-ejection.  
Reproduction: Retarder une réponse payment_succeeded après une réponse ejected.  
Customer impact: Client ne sait pas où est sa batterie.  
Operational impact: Faux incidents, nouvelles tentatives, support manuel.  
Security/financial impact: Risque de double tentative et dispute paiement.  
Recommended fix: Poll séquentiel/versionné, états terminaux monotones, timeout, référence et récupération serveur.  
Estimated complexity: M.  
Dependencies: Contrat d'état backend.  
Blocks field deployment: YES.

### ID: P0-03

Severity: P0 BLOCKER  
Subsystem: Slot selection / concurrence  
Title: Deux locations peuvent réserver le même slot  
Current behavior: Le test de disponibilité précède l'insertion et l'unicité porte seulement sur idempotency_key.  
Expected behavior: Une seule session active peut réserver un slot donné, atomiquement.  
Evidence: create-rental-session/index.ts lignes 135-152 et 188-211.  
Files: supabase/functions/create-rental-session/index.ts; migrations rental_sessions.  
Database objects: rental_sessions.  
Functions: create-rental-session.  
Reproduction: Deux demandes avec clés d'idempotence différentes sur le même slot.  
Customer impact: Mauvaise batterie, absence de batterie ou deux paiements.  
Operational impact: Réconciliation manuelle.  
Security/financial impact: Risque financier direct.  
Recommended fix: Transaction/lock + contrainte partielle de réservation active par station/slot.  
Estimated complexity: M.  
Dependencies: Modèle d'état unifié.  
Blocks field deployment: YES.

### ID: P0-04

Severity: P0 BLOCKER  
Subsystem: Return / settlement  
Title: Retour de test ne déclenche pas de règlement final ni remboursement  
Current behavior: Une session returned garde 30 CHF capturés, remboursement 0, final_amount null.  
Expected behavior: Retour corrélé déclenche pricing final, capture/remboursement selon méthode et reçu.  
Evidence: Lecture staging de la session retournée manuellement.  
Files: Fonctions de pricing/finalisation/settlement à réconcilier; documents de settlement.  
Database objects: rental_sessions, payments, refunds.  
Functions: return/reconciliation/finalization.  
Reproduction: Retourner une batterie et suivre l'état sans intervention humaine.  
Customer impact: Garantie potentiellement retenue à tort.  
Operational impact: Gestion manuelle des remboursements.  
Security/financial impact: Risque financier et réputationnel majeur.  
Recommended fix: Finalisation idempotente, matrice par payment method, test Stripe Test complet.  
Estimated complexity: L.  
Dependencies: Détection retour fiable et stratégie Stripe.  
Blocks field deployment: YES.

### ID: P0-05

Severity: P0 BLOCKER  
Subsystem: Deployment provenance  
Title: Le staging observé n'est pas relié de façon prouvée au head audité  
Current behavior: Les marqueurs UI du head 757a600 étaient absents du staging observé; Vercel PR cible un autre projet.  
Expected behavior: Chaque écran terrain doit exposer SHA frontend/APK et environnement.  
Evidence: DOM staging versus source; checks Vercel eSIM.  
Files: src/pages/Kiosk.tsx; src/index.css; vercel.json; GitHub PR status.  
Database objects: N/A.  
Functions: N/A.  
Reproduction: Comparer un marqueur du build source au DOM servi.  
Customer impact: Correctifs non visibles et comportement impossible à diagnostiquer.  
Operational impact: Aucune confiance dans les essais terrain.  
Security/financial impact: Correctifs de sécurité potentiellement non livrés.  
Recommended fix: Pipeline qui injecte SHA versionné, cible Vercel correcte, APK versionnée et attestation d'installation.  
Estimated complexity: M.  
Dependencies: GitHub/Vercel/Android distribution.  
Blocks field deployment: YES.

### ID: P1-01

Severity: P1 CRITICAL  
Subsystem: Inventaire / santé batterie  
Title: Etat online et rentable contradictoire avec batteries non qualifiées ou stale  
Current behavior: Station online/rentable_count 4 alors que les batteries sont unknown/non pricing eligible.  
Expected behavior: Une vérité fusionnée bloque toute location douteuse.  
Evidence: Lectures DTA21269 et photos terrain divergentes.  
Files: Snapshot ChargeNow, logique kiosk de sélection.  
Database objects: stations, batteries.  
Functions: kiosk-cabinet-snapshot, sync-cabinet-status.  
Reproduction: Lire station puis batteries de DTA21269.  
Customer impact: Batterie vide ou défectueuse proposée.  
Operational impact: Incidents non expliqués.  
Security/financial impact: Risque de paiement sans service.  
Recommended fix: Agrégateur C4/C7/C8 avec fraîcheur/confidence/conflits et règles d'éligibilité.  
Estimated complexity: L.  
Dependencies: Sémantique fournisseur validée.  
Blocks field deployment: YES.

### ID: P1-02

Severity: P1 CRITICAL  
Subsystem: Kiosk state persistence  
Title: Reboot WebView perd une location active  
Current behavior: sessionId/publicCode/slot/phase sont seulement React state.  
Expected behavior: Reprise bornée de l'unique location active de la tablette.  
Evidence: Kiosk.tsx lignes 80-103, 228-233; MainActivity lifecycle.  
Files: src/pages/Kiosk.tsx; MainActivity.java.  
Database objects: kiosk device / rental session.  
Functions: Endpoint de récupération absent.  
Reproduction: Recréer WebView durant waitpay.  
Customer impact: Paiement perdu de vue.  
Operational impact: Support manuel.  
Security/financial impact: Risque de double paiement.  
Recommended fix: Persistance non secrète + récupération serveur liée au device/station.  
Estimated complexity: M/L.  
Dependencies: Pairing/auth kiosk.  
Blocks field deployment: YES.

### ID: P1-03

Severity: P1 CRITICAL  
Subsystem: Migrations  
Title: Ledger migrations local et staging divergent  
Current behavior: Migrations local-only et remote-only.  
Expected behavior: Un historique unique permet de reproduire staging et production.  
Evidence: supabase migration list --linked.  
Files: supabase/migrations.  
Database objects: Tous les objets issus de migrations divergentes.  
Functions: Toutes les Edge/RPC dépendantes.  
Reproduction: Comparer migration list locale et remote.  
Customer impact: Régressions invisibles.  
Operational impact: Déploiement non reproductible.  
Security/financial impact: Risque de policy/fonction incohérente.  
Recommended fix: Réconciliation additive, baseline et CI de drift.  
Estimated complexity: M/L.  
Dependencies: Accès Supabase contrôlé.  
Blocks field deployment: YES.

### ID: P1-04

Severity: P1 CRITICAL  
Subsystem: Android production  
Title: APK 1.0.15-staging debug n'est pas une release terrain  
Current behavior: Variant debug/test-only, keystore release non vérifié, boot/lock-task non prouvés.  
Expected behavior: Release signée, mise à jour compatible, rollback, DPC et boot testés.  
Evidence: android-kiosk/app/build.gradle.kts; AndroidManifest.xml; run #42.  
Files: android-kiosk/app/build.gradle.kts; AndroidManifest.xml; MainActivity.java; BootReceiver.java.  
Database objects: N/A.  
Functions: N/A.  
Reproduction: Installer/mettre à jour/rebooter une release signée sur DTA.  
Customer impact: Borne indisponible après reboot/update.  
Operational impact: Intervention terrain obligatoire.  
Security/financial impact: Build debug / surface debug.  
Recommended fix: Pipeline release, signature/upgrade test, DPC enrollment, boot recovery.  
Estimated complexity: M.  
Dependencies: Keystore, MDM/DPC, tablette.  
Blocks field deployment: YES.

### ID: P1-05

Severity: P1 CRITICAL  
Subsystem: Back-office / incidents  
Title: Les échecs peuvent apparaître comme un tableau vide et n'ouvrent pas d'incident  
Current behavior: Certains écrans ignorent erreurs API/RLS; system_incidents ne montre pas les sessions bloquées.  
Expected behavior: Toute location payée non délivrée déclenche incident et alerte actionnable.  
Evidence: AdminRentals.tsx/AdminPayments.tsx erreurs ignorées; lecture system_incidents vide.  
Files: src/pages/admin/AdminRentals.tsx; AdminPayments.tsx; AdminRentalFlowHealth.tsx.  
Database objects: system_incidents.  
Functions: Orchestration/incident creation.  
Reproduction: Forcer erreur lecture ou session ejecting.  
Customer impact: Aucun support proactif.  
Operational impact: Exploitation aveugle.  
Security/financial impact: Retards de remboursement.  
Recommended fix: Etats d'erreur visibles, alerting, incidents automatiques avec correlation ID.  
Estimated complexity: M.  
Dependencies: Monitoring/notifications.  
Blocks field deployment: YES.

### ID: P2-01

Severity: P2 IMPORTANT  
Subsystem: Auth Supabase  
Title: Protection contre mots de passe compromis désactivée  
Current behavior: Adviser Supabase le signale disabled.  
Expected behavior: Protection activée et politique MFA administrateurs.  
Evidence: Supabase security advisor.  
Files: Configuration Auth externe.  
Database objects: auth.users.  
Functions: Auth.  
Reproduction: Vérification configuration.  
Customer impact: Compte plus exposé.  
Operational impact: Réponse incident.  
Security/financial impact: Compromission compte.  
Recommended fix: Activer contrôle de mots de passe compromis, MFA et revue admin.  
Estimated complexity: S.  
Dependencies: Configuration Supabase Auth.  
Blocks field deployment: NO, mais doit être fait avant production.

### ID: P2-02

Severity: P2 IMPORTANT  
Subsystem: PWA / diagnostics  
Title: Cache long et diagnostic public affaiblissent la maîtrise de version  
Current behavior: Assets cache 30 jours; diagnostic ouvert par cinq taps et update possible sans busy check.  
Expected behavior: Build exact visible, diagnostics opérateur authentifiés, mise à jour transactionnelle.  
Evidence: vite.config.ts; Kiosk.tsx; KioskDiagnostics.tsx.  
Files: vite.config.ts; src/pages/Kiosk.tsx; src/components/kiosk/KioskDiagnostics.tsx.  
Database objects: kiosk device/token.  
Functions: Native bridge / update.  
Reproduction: Ouvrir diagnostic et changer état lors d'une location.  
Customer impact: UI ancienne / flux perturbé.  
Operational impact: Support difficile.  
Security/financial impact: Token/diagnostic surface.  
Recommended fix: Auth opérateur, busy guard, version SHA visible, politique cache explicitement testée.  
Estimated complexity: M.  
Dependencies: Android bridge/Vercel.  
Blocks field deployment: NO, mais P1 pour pilote ouvert.

### ID: P3-01

Severity: P3 IMPROVEMENT  
Subsystem: Performance / UI  
Title: Bundle kiosk lourd et scènes 16:9 non validées  
Current behavior: JS principal > 1 MiB; layout/photo staging ne démontre pas le rendu exact attendu.  
Expected behavior: Performance et cadrage mesurés sur DTA.  
Evidence: npm run build; photos terrain.  
Files: Vite output; CSS kiosk.  
Database objects: N/A.  
Functions: N/A.  
Reproduction: Mesurer cold start/WebView DTA.  
Customer impact: Attente et lisibilité réduite.  
Operational impact: Diagnostic UX.  
Security/financial impact: Aucun direct.  
Recommended fix: Découpage de bundle, tests 1280x720/16:9, QA visuelle réelle.  
Estimated complexity: M.  
Dependencies: Tablette réelle.  
Blocks field deployment: NO.

## 22. Maturité par flux critique

| Feature | Code exists | Automated tested | Integration tested | Deployed staging | Tested on tablet | Tested with Stripe Test | Tested with real ChargeNow | Physically tested | Production-ready |
|---|---|---|---|---|---|---|---|---|---|
| Kiosk | Oui | Partiel | Non | Non prouvé au SHA | Oui visuellement | N/A | N/A | N/A | Non |
| Languages | Oui | Partiel | Non | Non prouvé | Oui visuellement | N/A | N/A | N/A | Non |
| Pairing | Oui | Partiel | Non | Partiel | Non prouvé | N/A | N/A | N/A | Non |
| Station online | Oui | Partiel | Read only | Oui | Oui | N/A | Oui indirect | Non | Non |
| Slot inventory | Oui | Partiel | Non | Oui | Oui visuellement | N/A | Oui indirect | Non | Non |
| Battery health | Partiel | Partiel | Non | Partiel | Oui visuellement | N/A | Oui indirect | Non | Non |
| Pricing | Oui | Partiel | Non | Oui | Oui visuellement | Oui partiel | N/A | N/A | Non |
| Rental creation | Oui | Partiel | Partiel | Oui | Oui | Oui | N/A | N/A | Non |
| Stripe Checkout | Oui | Partiel | Partiel | Oui | Oui | Oui | N/A | N/A | Non |
| TWINT | Oui dynamique | Non | Oui partiel | Oui | Téléphone | Oui attesté | N/A | N/A | Non |
| Apple Pay | Oui dynamique | Non | Non | Inconnu | Non | Non | N/A | N/A | Non |
| Google Pay | Oui dynamique | Non | Non | Inconnu | Non | Non | N/A | N/A | Non |
| Webhook | Oui | Partiel | Partiel | Oui | N/A | Oui | N/A | N/A | Non |
| Eject | Oui, gated | Partiel | Partiel | Oui | Oui | Oui indirect | Oui | Oui par opérateur | Non |
| Return | Oui, modèle | Partiel | Non | Partiel | Non | Oui indirect | Partiel | Retour rapporté | Non |
| Settlement/refund | Oui partiel | Partiel | Non | Partiel | Non | Oui Test partiel | N/A | Non | Non |
| Emails/receipts | Partiel | Non | Non | Non prouvé | Non | Non | N/A | Non | Non |
| Monitoring | Partiel | Non | Non | Partiel | N/A | N/A | N/A | N/A | Non |
| Admin | Oui | Partiel | Non | Partiel | N/A | N/A | N/A | N/A | Non |
| OTA/update | Partiel | Non | Non | Non prouvé | Non | N/A | N/A | N/A | Non |
| Recovery/boot | Partiel | Non | Non | Non prouvé | Non | N/A | N/A | N/A | Non |

## 23. Scores de readiness

| Domaine | Score /100 | Justification |
|---|---:|---|
| Kiosk UX | 25 | Flux visible mais attentes infinies, slot instable et recovery absent. |
| Payment | 48 | Checkout/webhook Test existent et paiement Test attesté, settlement incomplet. |
| Rental orchestration | 23 | Callback 401 et états bloqués. |
| Hardware | 30 | Commande/garde-fous existent, une sortie contrôlée est rapportée, confirmation automatique absente. |
| Return flow | 10 | Retour manuel rapporté, détection/règlement automatique non prouvés. |
| Pricing | 45 | Profil pilote présent, cas/settlement final non prouvés. |
| Security | 48 | Bon durcissement WebView/RLS, mais Auth, diagnostics et capabilities à revoir. |
| Reliability | 15 | Pas de reprise après crash, callback cassé, sources inventory stale. |
| Observability | 25 | Correlation ids existent, mais incidents/alerting non fiables. |
| Operations | 20 | Back-office existe mais masque des erreurs et pas d'alertes terrain. |
| i18n | 45 | Chemin principal présent, mais hardcodes/fallbacks/locale phone non terminés. |
| Branding | 45 | Marque UI présente, emails/reçus Stripe non prouvés. |
| Deployment | 15 | Branches, migrations, Vercel et APK non reconcilés. |
| Overall field readiness | **23** | Uniquement pilote contrôlé avec opérateur présent. |

## 24. TOP_10_FIELD_DEPLOYMENT_RISKS

| Rang | Risque | Probabilité | Impact | Détectabilité | Mitigation |
|---:|---|---|---|---|---|
| 1 | Paiement capturé, callback 401, batterie non réconciliée | Haute | Critique | Moyenne | Corriger callback + tests réels + compensation. |
| 2 | Client payé voit spinner/aucune instruction | Haute | Critique | Haute visuellement, faible backend | Etats terminaux, timeout, référence support. |
| 3 | Deux clients réservent le même slot | Moyenne | Critique | Faible | Réservation atomique DB. |
| 4 | Retour non détecté / dépôt non remboursé | Haute | Critique | Faible | Retour + settlement Test de bout en bout. |
| 5 | Batterie stale/0 %/défectueuse proposée | Haute | Critique | Moyenne | Fusion C4/C7/C8 et règles d'éligibilité. |
| 6 | Mise à jour/branche différente de celle testée | Haute | Critique | Faible | SHA déploiement/APK et CI obligatoire. |
| 7 | Reboot WebView après paiement perd la location | Moyenne | Critique | Faible | Réhydratation durable. |
| 8 | Double éjection/faux état après réponses concurrentes | Moyenne | Critique | Faible | Poll monotone + réservation/permit/idempotence. |
| 9 | Incident invisible dans admin / support | Haute | Fort | Faible | Alerting, incident automatique, erreurs UI explicites. |
| 10 | APK staging/debug/DPC/boot non prêt | Moyenne | Fort | Haute lors du terrain | Release signée, DPC, boot/update/rollback testés. |

## 25. MUST_FIX_BEFORE_FIRST_UNATTENDED_STATION

1. Corriger et tester le callback ChargeNow, puis réconcilier les locations bloquées.
2. Mettre en place une réservation atomique de slot/batterie et une machine d'états monotone.
3. Prouver le cycle complet : Checkout Test -> webhook -> éjection confirmée -> batterie identifiée -> retour détecté -> prix final -> remboursement/capture -> reçu.
4. Construire une vérité d'inventaire fraîche et sûre : les données contradictoires ne doivent jamais être louables.
5. Ajouter recovery après crash/reboot et une sortie client claire après délai.
6. Mettre en place incidents/alertes et un back-office qui ne masque pas les erreurs.
7. Réconcilier branches, migrations, fonctions et déploiements sous un SHA vérifiable.
8. Produire et tester une APK release signée, DPC/kiosk, boot, mise à jour et rollback.
9. Valider règles financières par moyen Stripe et la communication garantie/remboursement.
10. Vérifier RLS/capabilities, rate limit, Auth password protection et rotation de secrets avant Live.

## 26. CAN_WAIT_UNTIL_AFTER_FIRST_FIELD_PILOT

- Raffinement esthétique 3D avancé et contenus publicitaires.
- App Store/Play Store plutôt que wrapper kiosk interne.
- Optimisation fine du bundle au-delà des mesures de stabilité.
- Expansion à d'autres bornes et retours inter-stations.
- Fidélité, abonnements, wallet, campagnes promotionnelles.
- Toutes les langues du back-office, après validation du parcours client FR/EN/DE.

## 27. Réponses aux incidents terrain simulés

| Situation | Réponse actuelle | Réponse cible |
|---|---|---|
| Internet coupé 5 min | UI peut afficher réseau/support ou spinner; pas de récupération prouvée | Session durable, état hors-ligne clair, reprise sans double paiement. |
| Courant/tablette reboot | WebView peut perdre la session active | Reprise device-bound au boot, état client récupérable. |
| ChargeNow tombe | Snapshot stale peut encore dire online/ready | Bloquer location, incident et message honnête. |
| Supabase tombe | Pas de chemin résilient prouvé | Ne pas initier paiement; écran incident et monitoring. |
| Stripe tombe | Checkout creation erreur gérée partiellement | Erreur claire, aucune location/charge persistante. |
| Batterie coincée | Etat support possible mais incident/compensation non prouvés | Stop, ticket automatique, remboursement/capture policy. |
| QR expire | Etat prévu | Prouver annulation/recréation idempotente. |
| Client touche dix fois | Idempotence même key existe; deux keys/slot non protégés | Disable UI + serveur atomicité. |
| Batterie chauffe | Pas de santé fusionnée fiable | Exclure auto, alerter, maintenance. |
| Toutes faibles | Station peut encore compter rentable 4 | Zéro disponibilité client, alerte réassort. |

## 28. Variables de configuration à vérifier sans afficher de valeur

| Groupe | Variables attendues | Staging | Production | Impact si absente/incohérente |
|---|---|---|---|---|
| Stripe | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MODE, STRIPE_LIVE_ENABLED, Stripe branding/URLs | Noms présents; valeur non auditée | Non prouvé | Checkout/webhook/risque Live. |
| Supabase | SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, project ref, auth URLs | Partiel observé | Non prouvé | DB/Auth/RLS/functions. |
| ChargeNow | CHARGENOW_BASE_URL, credentials, mutations flag, callback secret, allowlist | Noms présents; callback dysfonctionne | Non prouvé | Reads/ejection/callback. |
| Kiosk | X-Kiosk-Token config, public app URL, API base URL, environment, diagnostics policy | Partiel observé | Non prouvé | Pairing/session/UI. |
| Android | keystore path/alias/password via CI, DPC/MDM config, launch URL, update channel | Non prouvé | Non prouvé | Release/boot/update. |
| Email | SMTP/Resend provider, Supabase templates, logo URL, support address, sender domain | Non prouvé | Non prouvé | Auth and transactional comms. |
| Vercel | project binding, env vars, alias/domain, cache headers | Incohérent | Non prouvé | Mauvais frontend servi. |

## 29. Roadmap recommandée sans implémentation

### PHASE 0 — Critical cleanup

Objectif : définir une base versionnée et observable.  
Résout : P0-05, P1-03, partie P1-04.  
Sortie : #46 réconciliée sur #36, migrations/fonctions réconciliées, CI du head exact verte, SHA visible sur staging et APK.

### PHASE 1 — Payment reliability

Objectif : qu'un paiement Test soit toujours correctement connu et récupérable.  
Résout : P0-01, P0-02, P1-02, P1-05.  
Sortie : callback Fox validé sur URL réelle, webhook/callback idempotents, états/timeout/références client, aucun spinner permanent.

### PHASE 2 — Hardware lifecycle

Objectif : sélectionner, délivrer et récupérer exactement une batterie.  
Résout : P0-03, P1-01, retour/settlement.  
Sortie : snapshot fusionné, réservation atomique, éjection unique confirmée, retour automatique, prix final et compensation Test.

### PHASE 3 — Field reliability

Objectif : borne autonome récupérable.  
Résout : APK/DPC/boot, monitoring, alerting, support.  
Sortie : reboot/crash/network tests, incidents, alertes, rollback et runbook.

### PHASE 4 — UX polish

Objectif : expérience claire et premium sans masquer les états réels.  
Résout : layout 16:9, animations, i18n exhaustive, accessibilité, QR.  
Sortie : QA visuelle DTA/phone FR/EN/DE et tests de lisibilité.

### PHASE 5 — Production activation

Objectif : passage Live seulement après preuves.  
Sortie : revue sécurité, juridique/fiscal, Stripe Live isolé, APK release, pilote contrôlé stable puis go/no-go.

## 30. Question finale

« Peut-on aujourd’hui déposer DTA21269 dans un établissement réel et la laisser fonctionner de manière autonome avec de vrais clients ? »

**NO**

La seule étape acceptable avant la fermeture des P0/P1 est un **CONTROLLED_PILOT_ONLY** avec opérateur présent, Stripe Test, permissions matérielles explicitement bornées et réconciliation manuelle documentée.

## 31. Privacy, données client et conditions

### Données identifiées

| Catégorie | Exemples | Risque / action |
|---|---|---|
| Identité | e-mail, compte Auth, rôle | RLS, durée de conservation, export/suppression à prouver. |
| Paiement | Checkout Session, PaymentIntent, moyen/état, reçu | Ne jamais exposer données carte; accès staff limité. |
| Location | station, slot, batterie, heures, prix, incidents | Historique et nécessité opérationnelle à définir. |
| Appareil | kiosk device, token, version, diagnostics | Token hors logs/URLs/localStorage non protégé. |
| Réseau | IP, logs Edge, erreurs webhook/provider | Rétention/minimisation et accès à documenter. |

Le projet contient des éléments d'export/suppression de compte, mais l'audit ne valide ni leur exécution ni les durées de conservation. Ce rapport ne constitue pas un avis juridique. Une revue professionnelle est requise avant données de vrais clients, notamment sur informations de prix, dépôt, non-retour, remboursements, support et politique de confidentialité.

### Informations client

Le client doit voir, avant paiement :

- le tarif réel et l'unité;
- le montant de garantie/dépôt et sa nature exacte pour le moyen de paiement;
- la règle de non-retour et son maximum;
- la politique de remboursement;
- un contact support;
- les conditions applicables.

Le parcours actuel montre le tarif et le dépôt dans certains écrans, mais le comportement financier final n'est pas suffisamment prouvé pour que ces promesses soient considérées correctes.

## 32. E-mails, factures et reçus : inventaire de maturité

| Message | Existe sous forme de code/document | Envoi staging reçu | FR | EN | DE | Branding vérifié |
|---|---|---|---|---|---|---|
| Confirmation inscription | Modèle/config à prévoir | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Réinitialisation mot de passe | Modèle/config à prévoir | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Magic link / invitation / changement e-mail | Partiel/à configurer | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Location créée | Partiel/à configurer | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Paiement reçu | Partiel/à configurer | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Batterie délivrée | Partiel/à configurer | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Retour / location terminée | Partiel/à configurer | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Remboursement / incident | Partiel/à configurer | Non | Non prouvé | Non prouvé | Non prouvé | Non |
| Reçu Stripe / facture | Stripe peut le produire | Non observé | Non prouvé | Non prouvé | Non prouvé | Non |

Le document EMAIL_TEMPLATE_MATRIX.md ne doit pas être lu comme preuve de configuration : il indique lui-même qu'un déploiement et des envois staging reçus sont nécessaires.

## 33. Déploiement : ce qui est réellement où

| Élément | Local / Git | Mergé dans main | Staging attesté | Installé/physiquement vu | Production |
|---|---|---|---|---|---|
| main 7eea69f | Git | Oui | Non établi | Non | Non |
| PR #36 head 9faf102 | Git / PR ouverte | Non | Non établi au head | Non | Non |
| PR #46 / 757a600 | Git / PR ouverte | Non | Staging ne correspond pas démontrablement | Des écrans proches sont vus, version incertaine | Non |
| Edge Functions staging | Supabase actif | N/A | Oui, versions actives listées | Appelées | Non |
| APK 1.0.15 staging | Artefact Actions #42 | Dans #36 seulement | Artifact attesté | Une application staging est vue sur DTA, provenance signature inconnue | Non |
| Stripe Test | Config/staging | N/A | Oui | Test téléphone attesté | Live interdit |
| ChargeNow | Connecteur / project settings | N/A | Oui pour reads et essais contrôlés | Sortie signalée par opérateur | Non |

## 34. Dossier de preuves

### Git/GitHub

- Branche auditée : codex/staging-qr-i18n.
- Commit auditée : 757a6009fba7d0e819e6f8cfef07cfab41677198.
- main : 7eea69f.
- PR d'intégration : #36, head 9faf102.
- PR QR/i18n : #46, ouverte/conflit #36.
- APK staging : PR #42, GitHub Actions run 30846463013, artefact Chargeurs_CH_Kiosk_1.0.15-staging, date d'expiration indiquée 17 août 2026. SHA-256 non vérifié pendant audit.
- Déploiements en échec à examiner : runs/PR #37 et #38.
- Validation isolée : #40.

### Fichiers source principaux

| Domaine | Preuves |
|---|---|
| Kiosk | src/pages/Kiosk.tsx, src/pages/Pay.tsx, src/lib/kioskPaymentState.ts, src/lib/kioskSlotSelection.ts |
| I18n | src/i18n/i18n.tsx, src/pages/KioskHome.tsx, src/components/kiosk/KioskRuntimeGuard.tsx |
| QR/3D | src/components/kiosk/PowerbankScene.tsx, src/index.css |
| Stripe | supabase/functions/create-stripe-checkout/index.ts, supabase/functions/stripe-webhook/index.ts |
| Rental | supabase/functions/create-rental-session/index.ts |
| Ejection | supabase/functions/eject-after-payment/index.ts, supabase/functions/reconcile-pending-ejection/index.ts |
| Callback | supabase/functions/_shared/chargenowCallbackAuth.ts, supabase/functions/chargenow-rent-callback/index.ts |
| ChargeNow client | supabase/functions/_shared/chargenow.ts |
| Android | android-kiosk/app/build.gradle.kts, android-kiosk/app/src/main/AndroidManifest.xml, android-kiosk/app/src/main/java/ch/chargeurs/kiosk/MainActivity.java, android-kiosk/app/src/main/java/ch/chargeurs/kiosk/BootReceiver.java |
| Cache/deploy | vite.config.ts, vercel.json |
| Admin | src/pages/admin/AdminRentals.tsx, AdminPayments.tsx, AdminRentalFlowHealth.tsx, AdminMaintenance.tsx |
| Migrations | supabase/migrations and output of supabase migration list --linked |

### Lectures staging effectuées

- Projet Supabase staging actif : ref xqepbqnaenoeyfjkjnzl, région eu-central-2.
- Tables/policies/RLS interrogées en lecture seule.
- Liste de migrations locale versus remote examinée.
- Liste de fonctions Supabase active examinée.
- Station, batteries, rental_sessions, payments, webhook inbox, événements, permits et incidents DTA21269 interrogés en lecture seule.
- Aucune valeur de secret n'a été affichée, stockée dans ce rapport ou modifiée.

### Preuves terrain fournies par l'opérateur

- Checkout QR mobile atteint et paiement Stripe Test attesté.
- DTA21269 a physiquement sorti au moins une batterie lors d'un test contrôlé.
- Borne et téléphone sont restés bloqués sur Paiement confirmé / Releasing powerbank dans des essais ultérieurs.
- La scène de sortie a affiché un slot inconnu alors qu'une batterie était sortie.
- Le slot 3 a été observé à 0 %, sans diagnostic fiable aujourd'hui.

## 35. Fin de l'audit

Conclusion inchangée :

« Peut-on aujourd’hui déposer DTA21269 dans un établissement réel et la laisser fonctionner de manière autonome avec de vrais clients ? »

**NO**
