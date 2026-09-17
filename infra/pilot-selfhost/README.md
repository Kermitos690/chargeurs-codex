# Chargeurs.ch — Pilot Guest-Only Self-Host

This stack is the bounded infrastructure base for the first real Chargeurs.ch field pilot.

## Scope

The physical kiosk pilot exposes only the guest/Express journey:

1. simple Chargeurs.ch welcome screen;
2. no customer account / Chargeurs+ choice;
3. existing kiosk transaction runtime for pricing, battery selection, Stripe Checkout, release and return;
4. local PostgreSQL + API replacing quota-sensitive backend services progressively.

The full member journey remains in source and is re-enabled by removing the pilot flag.

## Safety gates

This first self-host version deliberately exposes only:

- `GET /health` — process health;
- `GET /ready` — PostgreSQL connectivity.

Every `/api/kiosk/*` route returns `503 PILOT_ROUTE_NOT_MIGRATED` until the corresponding canonical Chargeurs.ch behavior has been ported and tested.

Do not point a station at this API yet. In particular, no Stripe LIVE payment and no ChargeNow ejection command should be enabled during infrastructure bring-up.

## Mac / Colima bring-up

Prerequisites already selected for the pilot:

- Docker CLI + Compose;
- Colima;
- Colima VM kept deliberately small;
- enough free APFS space before starting containers.

After Colima reports healthy:

```bash
cd ~/Documents
# use the existing Chargeurs.ch checkout if already present; do not create duplicates
cd chargeurs-codex

git fetch origin
git checkout pilot/guest-only-selfhost

cd infra/pilot-selfhost
cp .env.example .env
```

Generate a local PostgreSQL password without putting it in Git:

```bash
openssl rand -hex 24
```

Paste that value only into `POSTGRES_PASSWORD=` inside `infra/pilot-selfhost/.env`.

Start the bounded stack:

```bash
docker compose up -d --build
```

Validate locally:

```bash
docker compose ps
curl -fsS http://127.0.0.1:8787/health && echo
curl -fsS http://127.0.0.1:8787/ready && echo
```

Expected result: both endpoints return HTTP 200 and `/ready` reports the database as available.

Stop without deleting the database:

```bash
docker compose stop
```

Remove containers but preserve PostgreSQL data:

```bash
docker compose down
```

Never use `docker compose down -v` on a populated pilot unless a disposable database reset is explicitly intended; `-v` removes the PostgreSQL volume.

## Internet exposure

The intended public path is outbound-only:

`api-pilot.chargeurs.ch -> Cloudflare Tunnel -> 127.0.0.1:8787`

PostgreSQL is not published on the host and must never be exposed directly to the Internet.

The tunnel is configured only after local `/health` and `/ready` pass.

## Guest-only frontend flag

Set:

```text
VITE_KIOSK_PILOT_GUEST_ONLY=true
```

for a pilot build. The normal full kiosk remains the default when the variable is absent/false.

## Route migration order

Port only the minimum Express dependencies, in this order:

1. kiosk identity/token validation;
2. station + pricing read;
3. cabinet snapshot read;
4. rental session creation with idempotency;
5. Stripe TEST Checkout creation;
6. signed Stripe webhook as payment truth;
7. payment-confirmed release orchestration;
8. ChargeNow callback ingestion;
9. session status/read model;
10. return detection + final settlement.

Customer accounts, membership, Wallet, ads and marketing jobs are explicitly outside the first field-pilot gate.
