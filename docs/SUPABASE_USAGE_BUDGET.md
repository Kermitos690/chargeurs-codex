# Supabase usage budget — staging kiosks

Status date: **2026-08-29**

This document is a source-level budget and incident-prevention contract. It does
not claim that the currently deployed Vercel bundle already contains the source
changes described below. Runtime provenance and post-deploy measurements remain
required before `SUPABASE_USAGE_STORM_RESOLVED` can pass.

## Incident baseline

The Chargeurs.ch Supabase organization entered Fair Use restrictions after an
official usage notification reported:

- egress: **8.19 GB**;
- Edge Function invocations: **2,166,330**.

Live runtime evidence subsequently showed HTTP `402 Payment Required` on Edge
Functions, REST and Realtime traffic.

## Source-confirmed amplification mechanisms

### Historical return overlay

`KioskReturnOverlay` contains local timers for:

- `return-summary`: every **650 ms**;
- `cabinet-snapshot`: every **5 s**.

Before source commit
`4ec8a43bc0bf7b1d1ff8f902a765cf31c7427580`
(`fix: budget kiosk edge invocations`), these reads did not have the later
quiet-read cache/in-flight deduplication layer.

If every local timer became a network invocation continuously, the theoretical
upper bound per station would be approximately:

| Read | Interval | Calls/day/station |
|---|---:|---:|
| `return-summary` | 650 ms | ~132,923 |
| `cabinet-snapshot` | 5 s | 17,280 |
| Combined | — | ~150,203 |

For three continuously running stations this historical theoretical upper bound
is ~450,609 calls/day. These numbers are a capacity model, not a statement that
every historical timer tick reached Supabase.

### Quota-error cache bypass

The quiet-read cache stores successful 2xx responses. A `402` response is not a
successful cache entry. Without a separate error circuit breaker, a fast local
timer can therefore resume network traffic during a service restriction.

### Blocked operational guard

The pre-containment `KioskOperationalGuard` checked
`kiosk-operational-status` every **30 s** while a station was blocked. Across
three continuously blocked stations this cadence alone has a theoretical monthly
upper bound of ~259,200 Edge Function invocations (30-day month).

### Active rental/payment status

`Kiosk.tsx` polls the read-only `kiosk_session_status` RPC every **700 ms** while
a rental is in a protected payment/release phase. This cadence is appropriate
only while successful low-latency state observation is available. A persistent
HTTP `402`, `429` or server failure must not turn an active session into an
unbounded network retry loop.

## Runtime proof for event-driven return wake-up

A read-only inspection of staging PostgreSQL on 2026-08-29 confirms that the
proposed event-driven wake-up has a real runtime producer:

- function: `public.broadcast_kiosk_battery_in_hint`;
- active trigger: `trg_broadcast_kiosk_battery_in_hint`;
- trigger state: enabled (`tgenabled = 'O'`);
- table: `public.cabinet_events`;
- timing: `AFTER INSERT`;
- event filter: only `BATTERY_IN` and `BATTERY_BORROW_OUT`;
- Realtime event: `cabinet_event`;
- topic: `kiosk-cabinet:<station_id>`.

`CABINET_STATUS` heartbeat rows do **not** satisfy this trigger filter. The
return gate therefore does not wake on each ordinary cabinet heartbeat.

This proves the event source exists and is active in staging. It does not prove
that the currently deployed kiosk bundle subscribes correctly until the reviewed
source is deployed and measured.

## Other measured background traffic

The staging provider feed stored roughly **343–346 `CABINET_STATUS` events per
station** over about 18 h 49 min before service restriction. This corresponds to
approximately one provider status push every 3.3 minutes per station.

The current callback architecture uses `cabinet-event-push-auth` as an Edge
Function gateway and then forwards an authenticated request to the canonical
`cabinet-event-push` Edge Function. A successfully admitted provider push can
therefore consume two Edge Function invocations. At the measured three-station
heartbeat cadence, a simple 24/7 extrapolation is approximately 1,320 provider
pushes/day and ~2,640 Edge invocations/day, or ~79,000 invocations per 30-day
month, before retries. This is material for a 500,000-invocation Free-plan
budget, but it is not the primary source-confirmed storm.

Three PostgreSQL Cron jobs also issue HTTP requests to Edge Functions every five
minutes. Their combined schedule has a theoretical 30-day baseline of 25,920
Edge invocations. One of them, `chargeurs-plus-push-outbox`, currently targets a
runtime function named `noop`, representing 8,640 scheduled calls/month. The
source for that runtime-only `noop` function is not present in `main`; retirement
or replacement requires separate dependency proof and is not performed by this
PR.

## Containment design in source

The source-level containment branch introduces the following policy.

### Return observation

Normal idle mode:

1. keep the full return overlay unmounted;
2. keep a lightweight return gate active;
3. wake immediately on the existing authenticated `cabinet_event` broadcast;
4. use a **2-minute** fallback `return-summary` probe in case a broadcast is
   missed;
5. invalidate only the successful `return-summary` cache for that fallback, not
   unrelated station caches;
6. keep quota/rate/server error circuit breakers intact during forced freshness
   probes.

When a cabinet event wakes the return overlay, its existing faster presentation
loop may run temporarily. The proxy cache and error budget remain the network
boundary.

### Same-origin kiosk Edge reads

For cacheable kiosk proxy reads:

- HTTP `402`: retry after 60 s, then exponential backoff capped at 10 min;
- HTTP `429`: retry after 5 s, exponential backoff capped at 2 min;
- transport/server (`null` / `5xx`): retry after 2 s, exponential backoff capped
  at 30 s;
- successful 2xx: clear the failure budget and resume the existing success-cache
  policy.

Critical kiosk mutations are not made cacheable by this change.

### Direct Supabase read-only kiosk traffic

The central `kioskAwareFetch` transport applies the same bounded failure policy
only to these known read-only surfaces:

- `POST /rest/v1/rpc/kiosk_session_status`;
- `POST /rest/v1/rpc/kiosk_quote`;
- `GET|HEAD /rest/v1/stations`.

It does **not** circuit-break payment creation, rental creation, database
mutations or other write paths.

### Operational status

- healthy station: check every **10 min**;
- blocked station: check every **5 min** instead of every 30 s;
- failed status check: exponential 1/2/4/8/10-minute retry, capped at 10 min;
- explicit operator refresh remains available.

For three continuously blocked stations, the 5-minute source target is a
capacity upper bound of ~25,920 successful status checks per 30-day month,
before operator refreshes or lifecycle restarts.

## Budget rules for future code

Any new always-mounted kiosk network loop must document all of the following in
its PR:

1. endpoint and whether it is read-only or mutating;
2. normal interval;
3. error interval/backoff;
4. maximum calls per station per hour and per 30-day month;
5. cache/deduplication behavior;
6. event-driven alternative considered;
7. behavior under HTTP `402`, `429` and `5xx`;
8. lifecycle conditions that start and stop the loop;
9. test proving a persistent failure cannot produce an unbounded fast retry.

No sub-second always-on network polling is acceptable in idle kiosk state.
Sub-second local UI timers are acceptable only when a cache/event boundary
prevents equivalent network traffic.

## Release gates

The source change alone does not close the incident.

`SUPABASE_USAGE_STORM_RESOLVED` requires:

- exact deployed Vercel source/artifact provenance;
- controlled staging deployment of the reviewed containment source;
- measured per-endpoint request rates for each station;
- evidence that persistent 402/429/5xx responses respect the intended backoff;
- no unexpected native/WebView duplicate caller;
- no unexplained Realtime reconnect storm;
- reviewed disposition of scheduled/runtime-only background Edge traffic that
  materially consumes the Free-plan budget.

`SUPABASE_SERVICE_RESTRICTIONS_CLEARED` requires:

- Supabase restriction-clearance evidence;
- successful non-mutating Edge Function, REST and Realtime checks.

A paid Supabase plan is **not** an acceptance criterion for either gate. Capacity
may justify a paid plan later, but upgrading must not be used to hide an
unbounded polling defect.
