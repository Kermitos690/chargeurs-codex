# Pre-production Edge Function budget — 2026-08-26

Assumptions: 30-day month; continuously powered stations; no active payment or
hardware incident; current cached/adaptive kiosk behavior. The Supabase Free
ceiling used for planning is 500,000 invocations/month; Chargeurs.ch internal
safety ceiling is 350,000. The known deployed-but-unversioned `noop` Wallet
dispatcher remains an intended cron target and is counted conservatively.

| Call | Trigger | Normal interval | Error interval | Per-station monthly estimate |
| --- | --- | ---: | ---: | ---: |
| `kiosk-operational-status` | safety guard | 10 min | 1 min (bounded retry) | 4,320 normal-state |
| `customer-options` | kiosk footer | 10 min | browser/network retry only | 4,320 |
| `cabinet-snapshot` | kiosk idle refresh, cache-backed | 10 min cache | active transaction only | 4,320 normal-state |
| `kiosk-ads-playlist` | player refresh, cache-backed | 10 min cache | 8–60 s, capped | 4,320 normal-state |
| `kiosk-ads-clock` | synchronized ad clock | 10 min | focus wake, min 1 min | 4,320 normal-state |
| `kiosk-ads-playlist` impression | sampled analytics | 30 min/mode maximum | n/a | up to 96 |

The fast payment/RPC loops are deliberately excluded from normal-state totals:
they run only during an active customer transaction, have finite UI lifetimes,
and must not be slowed for quota savings.

| Active scheduled job | Schedule | Runs/day | Runs/30 days | Target type | Edge Function |
| --- | ---: | ---: | ---: | --- | --- |
| `expire-stale-rental-sessions` | every 5 min | 288 | 8,640 | SQL_ONLY | — |
| `field-incident-watchdog` | every 5 min | 288 | 8,640 | SQL_ONLY | — |
| `chargeurs-wallet-price-transitions` | every 10 sec | 8,640 | 259,200 | SQL_ONLY | — |
| `chargeurs-transactional-email-outbox` | every 5 min | 288 | 8,640 | EDGE_FUNCTION | `process-rental-email-outbox` |
| `chargeurs-plus-push-outbox` | every 5 min | 288 | 8,640 | EDGE_FUNCTION | `noop` (unversioned dispatcher) |
| `chargeurs-advertising-impression-retention` | daily 03:17 | 1 | 30 | SQL_ONLY | — |

`noop` has separate individual-instance and guest/bulk provider-push paths.
Pass Studio confirmed that either path consumes one credit whenever it delivers
a push, so both are disabled by the hardening migration. Its remaining Web Push
outbox is non-transaction-critical and now runs every five minutes.
No other versioned migration schedules an Edge Function. The remote cron export
is still required to exclude additional unversioned jobs.

| Pilot size | Station calls | Fixed Edge crons | Estimated monthly total | Internal 350k |
| ---: | ---: | ---: | ---: | --- |
| 1 | 21,696 | 17,280 | 38,976 | within |
| 3 | 65,088 | 17,280 | 82,368 | within |
| 4 | 86,784 | 17,280 | 104,064 | within |
| 10 | 216,960 | 17,280 | 234,240 | within |
| 20 | 433,920 | 17,280 | 451,200 | exceeds internal; below Free ceiling |

Database-local jobs (`expire-stale-rental-sessions`, field-incident watchdog,
wallet price transitions and advertising-retention) contribute zero Edge
invocations. The 20-station result remains a planning stop: do not exceed 10
stations without measuring real usage and reducing non-critical fixed calls.

## Storage impact

Raw `advertising_impressions` retain 14 days. Daily aggregates retain a small
row per day/campaign/asset/station/mode; under the 20-station worst case this is
at most 600 aggregate rows/month for one active asset/mode (1,200 for both
modes), versus 1,920 raw sampled rows/month. Raw telemetry therefore stops growing indefinitely; actual
bytes require the remote table-size query.
