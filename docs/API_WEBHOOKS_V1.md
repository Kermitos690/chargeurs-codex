# Chargeurs.ch Platform API — Webhooks v1

## Rôle

Les webhooks informent une intégration partenaire des changements concernant ses propres locations sans imposer un polling permanent.

Événements disponibles :

```text
rental.created
rental.checkout_created
rental.payment_succeeded
rental.ejected
rental.active
rental.returned
rental.completed
rental.cancelled
rental.refunded
rental.incident
rental.state_changed
```

Le trigger ne crée aucun événement pour une location sans `api_client_id`. Un partenaire ne reçoit donc pas les locations kiosk ou celles d’un autre client API.

## Tables

La migration `20260715133000_platform_api_webhooks.sql` crée :

- `api_webhook_endpoints` ;
- `api_webhook_events` ;
- `api_webhook_jobs` ;
- `api_webhook_attempts`.

Les tables ont RLS activé et aucun accès direct navigateur. Seul `service_role` peut les utiliser.

## Création d’un endpoint

La fonction interne `api-webhook-admin` est réservée au rôle `super_admin`.

Exemple de corps :

```json
{
  "action": "create",
  "clientId": "<uuid>",
  "name": "Application partenaire",
  "targetUrl": "https://hooks.example.ch/chargeurs",
  "eventTypes": ["rental.created", "rental.payment_succeeded", "rental.returned"]
}
```

La réponse contient `signingSecret` une seule fois. Le secret doit être stocké immédiatement dans le gestionnaire de secrets du destinataire.

Autres actions :

- `list` ;
- `update` ;
- `set_active` ;
- `rotate_secret`.

## Modèle de secret

Aucun secret webhook brut n’est stocké en base.

Le backend dérive le secret à partir de :

- `PLATFORM_API_WEBHOOK_MASTER_SECRET` ;
- l’identifiant de l’endpoint ;
- un nonce de rotation public.

La rotation change le nonce et produit un nouveau secret sans conserver l’ancien.

Le master secret doit contenir au minimum 32 caractères aléatoires et rester exclusivement dans les secrets du backend.

## Sécurité de l’URL

La création refuse :

- HTTP sans TLS ;
- identifiants inclus dans l’URL ;
- ports autres que 443 ;
- fragments ;
- localhost ;
- noms `.local` ou `.internal` ;
- adresses IP littérales ;
- hôte sans nom de domaine public.

Cette validation réduit les risques SSRF. Pour une production à forte exposition, ajouter également un proxy de sortie avec résolution DNS et blocage réseau des plages privées.

## Format de livraison

```json
{
  "id": "<event-uuid>",
  "type": "rental.payment_succeeded",
  "createdAt": "2026-07-15T12:00:00Z",
  "resource": {
    "type": "rental",
    "id": "<rental-uuid>"
  },
  "data": {
    "rentalId": "<rental-uuid>",
    "stationId": "DTA21269",
    "state": "payment_succeeded"
  }
}
```

En-têtes :

```text
X-Chargeurs-Webhook-Id
X-Chargeurs-Webhook-Event
X-Chargeurs-Webhook-Timestamp
X-Chargeurs-Webhook-Signature
```

La signature est :

```text
v1=HMAC_SHA256(signingSecret, timestamp + "." + eventId + "." + rawBody)
```

Le destinataire doit :

1. lire le corps brut sans le reformater ;
2. vérifier que le timestamp est récent ;
3. recalculer la signature ;
4. comparer en temps constant ;
5. dédupliquer avec l’identifiant d’événement ;
6. répondre rapidement par un statut HTTP 2xx.

## Worker

Fonction :

```text
platform-api-webhook-worker
```

Authentification interne :

```text
Authorization: Bearer <PLATFORM_API_WEBHOOK_WORKER_TOKEN>
```

Le worker :

- réclame les jobs avec `FOR UPDATE SKIP LOCKED` ;
- récupère aussi les jobs bloqués depuis plus de cinq minutes ;
- livre avec un timeout de dix secondes ;
- refuse les redirections ;
- enregistre le statut, la durée et un hash court de la réponse ;
- ne conserve jamais le corps de réponse ;
- reprogramme les échecs ;
- classe le job `dead` après huit tentatives.

Délais approximatifs :

```text
1 minute
5 minutes
30 minutes
2 heures
12 heures
24 heures
48 heures
```

## Planification

Configurer une tâche Supabase Cron qui appelle le worker chaque minute. Le token du worker doit être transmis comme secret et ne doit apparaître ni dans SQL, ni dans GitHub, ni dans un journal.

## Variables nécessaires

```text
PLATFORM_API_WEBHOOK_MASTER_SECRET
PLATFORM_API_WEBHOOK_WORKER_TOKEN
```

## État réel

Le code, la migration, le worker, l’administration et les tests purs sont présents sur la branche de la PR #7.

Ils ne sont pas déclarés opérationnels tant que :

- les migrations ne sont pas appliquées sur staging ;
- les fonctions ne sont pas déployées ;
- le cron n’est pas configuré ;
- une livraison signée n’est pas vérifiée sur un endpoint de test ;
- les règles de rétention et d’alerte des jobs `dead` ne sont pas validées.
