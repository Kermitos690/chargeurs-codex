# Field deployment readiness — Chargeurs.ch

## Décision actuelle

**Statut : NO — une borne non surveillée ne peut pas être déposée sur le terrain.**

La décision est fondée sur le commit 757a6009fba7d0e819e6f8cfef07cfab41677198 de codex/staging-qr-i18n, les branches/PR liées, les lectures staging et les tests locaux listés dans FULL_PROJECT_AUDIT.md.

La seule autorisation raisonnable est :

    CONTROLLED_PILOT_ONLY
    Stripe Test uniquement
    opérateur physiquement présent
    station DTA21269 explicitement autorisée
    un slot unique explicitement sélectionné
    une commande unique
    une réconciliation manuelle documentée

## FIELD_DEPLOYMENT_ACCEPTANCE_CRITERIA

| Critère vérifiable | Etat actuel | Preuve requise avant une borne sans surveillance |
|---|---|---|
| La branche canonique est dans main et son SHA est connu | Non | PR #36/#46 réconciliées, main protégée, CI verte au SHA exact. |
| Frontend affiché sur DTA correspond à ce SHA | Non | Version build/SHA visible dans diagnostic opérateur et déploiement Vercel correct. |
| APK release est signée par la clé contrôlée par Chargeurs.ch | Non | apksigner verify, certificat/document SHA, test d'upgrade depuis l'APK installée. |
| DPC/kiosk Android empêche la sortie client et démarre au boot | Non prouvé | Test power-off/power-on, crash WebView, lock task, écran paysage. |
| Prix affiché et snapshot transactionnel sont identiques | Partiel | Tests 1/29/30/31 min, daily cap, non-retour et traces DB/Stripe. |
| Slot payé est réservé atomiquement | Non | Contrainte/transaction testée avec deux clients concurrents. |
| Batterie proposée est fraîche, identifiée et sûre | Non | Fusion C4/C7/C8 avec confiance/freshness et qualification terrain. |
| Checkout QR Test est créé une seule fois | Partiel | Tests double clic, retry réseau, double navigateur et idempotence serveur. |
| Paiement Test réussi est reçu par webhook signé une fois ou plus sans double effet | Partiel | Test webhook normal, duplicate/replay et journal corrélé. |
| Callback ChargeNow est authentifié et accepté sur son URL réellement envoyée | Non | Test avec URL fournisseur réelle, réponse 2xx et event persisté. |
| Une éjection est une seule commande et est physiquement confirmée | Partiel | Commande, callback/snapshot, batterie/slot/horodatage et vidéo/opérateur corrélés. |
| Absence de confirmation fournisseur ne répète jamais une éjection | Partiel | Tests timeout/retry/worker et protection double éjection. |
| Kiosk/téléphone n'attendent jamais indéfiniment après paiement | Non | Machine monotone, délai défini, référence client et chemin support. |
| WebView ou borne redémarrée reprend une location en cours | Non | Tests reboot durant QR, paiement, éjection et retour. |
| Retour est détecté automatiquement et lié à la bonne batterie | Non | Test même slot, autre slot, supplier offline et éventuel autre cabinet. |
| Règlement final et remboursement Test sont corrects | Non | PaymentIntent/Refund/rental receipt prouvés pour chaque moyen admissible. |
| Incident de paiement sans batterie devient une alerte opérateur | Non | Incident automatique, notification, tableau admin et runbook. |
| Auth/RLS/capabilities sont auditées et rate limited | Partiel | Tests anon/auth/kiosk/admin, MFA staff et protection password breached activée. |
| Aucune clé secrète n'est dans Git, navigateur, log ou QR | Partiel | Scan secret, revue logs/headers/diagnostics et rotation. |
| Email Auth/transactionnel est correct et brandé | Non prouvé | Envois staging FR/EN/DE reçus sur appareil, contenu/lien/support validés. |
| Monitoring détecte borne offline, données stale, stock faible et webhooks en erreur | Non | Alertes testées et propriétaire/on-call défini. |
| Rollback frontend, function et APK est documenté/testé | Non | Drill de rollback sans perte de location. |

## Matrice des preuves

| Flux | IMPLEMENTED | TESTED | DEPLOYED | CALLED | PAYMENT_TESTED | HARDWARE_TESTED | PHYSICALLY_VERIFIED | PRODUCTION_READY |
|---|---|---|---|---|---|---|---|---|
| Kiosk frontend | Oui | Unit/type/build | Staging non relié au SHA | Oui visuellement | N/A | N/A | N/A | Non |
| Slot inventory | Oui partiel | Unit partiel | Oui | Oui indirect | N/A | N/A | Non | Non |
| Pricing | Oui | Unit partiel | Oui | Oui sur écran | Partiel | N/A | N/A | Non |
| QR Checkout | Oui | Unit partiel | Oui | Oui | Oui | N/A | N/A | Non |
| Stripe webhook | Oui | Unit/structure partielle | Oui | Oui | Oui | N/A | N/A | Non |
| Ejection | Oui gated | Partiel | Oui staging | Oui | Oui indirect | Oui | Oui, témoignage opérateur | Non |
| Callback fournisseur | Oui | Idéal seulement | Oui | Oui, rejet 401 | N/A | N/A | Non | Non |
| Retour | Oui, modèle | Partiel | Partiel | Partiel | Oui indirect | Partiel | Retour rapporté | Non |
| Settlement/refund | Partiel | Partiel | Partiel | Partiel | Oui Test partiel | N/A | Non | Non |
| APK | Oui | Web tests pas Android | Artefact debug staging | Installée selon contexte utilisateur | N/A | N/A | UI vue sur DTA | Non |
| Alerting/admin | Partiel | Non | Partiel | Non prouvé | N/A | N/A | N/A | Non |

## Conditions de blocage immédiat

Une borne doit arrêter les nouvelles locations et ouvrir un incident automatique si l'une de ces conditions est vraie :

1. dernier snapshot ChargeNow trop ancien;
2. batterie sans identité ou slot non confirmé;
3. batterie faible, défaut, température ou self-check bloquant confirmé;
4. conflit critique entre C4, C7 et C8;
5. station offline ou fournisseur injoignable;
6. une session active/payée existe déjà pour le slot;
7. webhook Stripe ou callback ChargeNow non traité;
8. éjection demandée mais non confirmée après le délai opérationnel;
9. retour non réconcilié;
10. version kiosk/APK non attendue.

Dans ces cas, l'UI client ne doit pas promettre une batterie. Elle doit dire indisponible ou vérification, tandis que l'admin reçoit les données techniques et une action à faire.

## Runbook minimal d'un incident paiement sans batterie

1. Ne jamais demander au client de recommencer aveuglément.
2. Identifier correlation_id, public_code, rental_session_id, Checkout Session et PaymentIntent.
3. Lire l'état Stripe et l'inbox webhook.
4. Lire l'état ChargeNow, slot et batterie sans mutation.
5. Chercher callback, réponse 401/2xx et ordre fournisseur.
6. Si sortie prouvée : corréler batterie et passer la location à active avec trace.
7. Si sortie non prouvée : ouvrir incident, geler toute seconde éjection et appliquer la politique de remboursement validée.
8. Informer le client avec une référence publique et délai de traitement.
9. Ne réessayer une éjection que sous une autorisation humaine explicite, et jamais automatiquement après timeout ambigu.

## Configuration staging et production

Les valeurs ne sont volontairement pas affichées.

| Famille | Variable ou objet à contrôler | Staging | Production | Gate |
|---|---|---|---|---|
| Stripe | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MODE | Noms observés, valeurs non lues | Inconnue | Séparation Test/Live et webhook signé. |
| Stripe | STRIPE_LIVE_ENABLED | Doit rester false | Ne pas activer avant phase 5 | Contrôle CI et revue humaine. |
| ChargeNow | URL, credentials, mutations flag, callback auth | Présents par nom, callback cassé | Inconnue | Test callback et rotation. |
| Supabase | URL, anon key, service role, project ref, Auth URLs | Projet staging actif | Inconnue | RLS, migrations et séparation. |
| Web | PUBLIC_APP_URL, Vercel project, aliases, cache headers | Projet/commit non corrélés | Inconnue | SHA affiché. |
| Android | Keystore, alias, DPC/MDM, launch URL, update channel | Debug/staging | Inconnue | Release signed/rollback. |
| Emails | Sender, DNS, logo URL, support, templates | Non prouvé | Inconnue | Envoi réel FR/EN/DE. |

## Alertes nécessaires avant autonomie

| Alerte | Existe réellement ? | Critère cible |
|---|---|---|
| Borne offline | Non prouvé | aucun heartbeat/fournisseur depuis seuil défini. |
| Sync ChargeNow stale | Non prouvé | données > 120 secondes ou seuil métier. |
| Aucune batterie louable | Non prouvé | toutes batteries non qualifiées/faibles/défectueuses. |
| Batterie/slot défectueux | Partiel UI | défaut confirmé crée incident. |
| Temperature haute | Non prouvé | seuil fournisseur validé. |
| Checkout error / expiry rate | Non prouvé | seuil sur périodes courtes. |
| Webhook Stripe failure | Partiel logs | retry épuisé crée incident. |
| Callback ChargeNow 401/5xx | Non prouvé | alerte immédiate. |
| Paiement sans délivrance | Non prouvé | état non terminal après délai. |
| Batterie non retournée | Non prouvé | dépassement selon policy. |
| Kiosk device non vu | Non prouvé | heartbeat device stale. |

## Sortie de pilote contrôlé vers terrain non surveillé

Ne passer au terrain non surveillé que si ces séries sont toutes réussies et archivées :

1. 20 locations Test QR consécutives, aucun doublon de Checkout ni de réservation.
2. 20 webhooks signés avec duplicats/retries testés, aucun double effet.
3. 20 éjections d'un slot explicitement réservé, avec identité batterie/slot, aucune double sortie.
4. 20 retours automatiques corrélés, avec settlement/refund Test correct et reçu.
5. Tests de perte réseau, arrêt WebView, redémarrage Android, power cut et reprise pendant toutes les étapes.
6. Test de chaque défaut matériel connu, dont slot 3 à 0 %, avec UI client sûre et incident admin.
7. Test tablette en 16:9 réel, lecture 1–2 m, FR/EN/DE et cache/version build.
8. Drill rollback Vercel, Edge Function et APK.
9. Revue sécurité/secret/RLS/role/MFA signée.
10. Revue commerciale/légale des prix, garantie, non-retour, support et emails.

## Décision de go/no-go

| Niveau | Autorisation |
|---|---|
| Aujourd'hui | Test contrôlé manuel uniquement, aucune activation Stripe Live. |
| Après P0 paiement/callback/réservation | Pilote Stripe Test supervisé. |
| Après retour/settlement/recovery/monitoring et release Android | Pilote limité avec vrais utilisateurs seulement après décision séparée. |
| Après tous les critères ci-dessus | Evaluation production, pas activation automatique. |

La réponse actuelle reste : **NO**.
