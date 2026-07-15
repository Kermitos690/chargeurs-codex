# Chargeurs.ch Platform API v1

## Purpose

The Platform API is the stable interface owned by Chargeurs.ch. It prevents kiosks, partner dashboards and future mobile applications from depending directly on Stripe, Supabase table layouts or ChargeNow/Bajie routes.

The first release is deliberately **read-first**. It exposes operational data and authoritative pricing while payment and hardware mutations remain behind the existing internal Edge Functions. Public write routes must not be enabled until the staging payment/hardware gate has passed.

## Base URL

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/platform-api
```

Versioned routes start with `/v1`.

## Authentication

Use either header:

```http
Authorization: Bearer chg_test_...
```

or:

```http
X-API-Key: chg_test_...
```

Raw keys are returned once by `api-key-admin`. Only their SHA-256 hash is stored. Never place an API key in a URL, QR code, client-side source bundle, screenshot or Git commit.

### Environments

- `chg_test_...`: test/staging client.
- `chg_live_...`: production client.

Test and live clients are separate database records. A key cannot be converted from one environment to the other.

## Scopes

| Scope | Access |
|---|---|
| `health:read` | Detailed dependency configuration flags |
| `stations:read` | Station list, detail and public availability |
| `inventory:read` | Battery identifiers, slots and charge levels |
| `pricing:read` | Authoritative server-side pricing snapshots |
| `rentals:read` | Sanitized rental state and orchestrator events |
| `rentals:write` | Reserved for the future rental-command API |
| `payments:write` | Reserved for the future payment-command API |
| `stations:write` | Reserved for controlled operational commands |
| `*` | All scopes; super-admin integrations only |

## Current routes

```text
GET  /v1/health
GET  /v1/health/details
GET  /v1/me
GET  /v1/stations
GET  /v1/stations/:stationId
GET  /v1/stations/:stationId/availability
GET  /v1/stations/:stationId/inventory
POST /v1/pricing/quote
GET  /v1/rentals/:rentalIdOrCode
GET  /v1/rentals/:rentalId/events
```

The complete contract is in `docs/openapi/chargeurs-api-v1.yaml`.

## API client administration

`api-key-admin` is an internal Supabase Edge Function. It accepts only an authenticated `super_admin` user.

Supported actions:

- `list`
- `create_client`
- `set_client_active`
- `create_key`
- `revoke_key`

Example request body for a test client:

```json
{
  "action": "create_client",
  "name": "Kiosk staging",
  "environment": "test",
  "description": "Integration test client"
}
```

Example key creation body:

```json
{
  "action": "create_key",
  "clientId": "<uuid>",
  "name": "Staging operator key",
  "scopes": ["health:read", "stations:read", "inventory:read", "pricing:read", "rentals:read"],
  "rateLimitPerMinute": 120
}
```

The response contains `secret` exactly once. Store it immediately in the target service secret manager.

## Rate limiting

Each key has its own requests-per-minute limit. The API returns:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

Rate-limit counters are updated atomically by `consume_platform_api_quota`.

## Logging and privacy

Every authenticated request creates a redacted row in `api_request_logs`:

- request ID;
- API client and key IDs;
- method and path;
- status;
- duration;
- optional salted IP hash;
- user agent;
- non-sensitive metadata.

Authorization headers, raw API keys, Stripe secrets, ChargeNow credentials, kiosk tokens and payment payloads must never be stored.

Configure `API_LOG_HASH_SALT` to enable irreversible IP hashing. If it is absent, no IP-derived value is stored.

## Database migration

Apply:

```text
supabase/migrations/20260715110000_platform_api_v1.sql
```

It creates:

- `api_clients`
- `api_keys`
- `api_rate_limit_windows`
- `api_request_logs`
- `consume_platform_api_quota`
- `prune_platform_api_operational_data`

All tables have RLS enabled and direct `anon`/`authenticated` access revoked. Only server-side `service_role` operations are permitted.

## Required environment variables

Existing backend variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
CHARGENOW_BASIC_AUTH or CHARGENOW_BASIC_USERNAME + CHARGENOW_BASIC_PASSWORD
CHARGENOW_EVENT_SECRET
```

New variable:

```text
API_LOG_HASH_SALT
```

No value belongs in the repository.

## Deployment order

1. Create a dedicated Supabase staging project or confirm the existing staging boundary.
2. Apply the Rental Orchestrator storage migration.
3. Apply the Platform API migration.
4. Deploy `platform-api` and `api-key-admin`.
5. Create a test API client and a least-privilege test key.
6. Run health, station, inventory, pricing and rental read tests.
7. Verify request logs contain no raw credentials.
8. Run rate-limit and revoked-key tests.
9. Only then design the write-command API around the Rental Orchestrator.

## Gate before write routes

The following must all be true before exposing rental, payment or hardware commands through the Platform API:

- Rental Orchestrator migration applied and tested;
- all Stripe and ChargeNow events recorded before processing;
- compensation worker operational;
- periodic reconciliation operational;
- true 30 CHF authorization/capture model validated in Stripe test mode;
- exact battery-to-rental return correlation;
- one-station physical test complete;
- three-station physical test complete;
- credential rotation complete;
- CI, security review and staging deployment green.
