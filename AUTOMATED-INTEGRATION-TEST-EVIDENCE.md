# AUTOMATED INTEGRATION TEST EVIDENCE — Chargeurs.ch

_Generated during the final automated phase. No real payment, refund, ChargeNow
order, physical ejection, or production callback was performed. All external
dependencies are mocked; temporary secrets are generated in-process and never
logged or written to any file._

## 1. Harness architecture

| Layer | Tooling | Location |
|-------|---------|----------|
| Unit (pure logic) | Vitest (jsdom) | `src/test/*.test.ts` |
| SQL / DB invariants | `psql` against project DB (read-only assertions) | `supabase/tests/db-tests.sql` |
| Integration / contract / concurrency / resilience / security | Deno test | `supabase/functions/tests/*.test.ts` |

Key design choices:
- **Real production code under test.** Tests import the actual modules
  (`_shared/chargenow.ts`, `_shared/payments.ts`, `_shared/db.ts`, and the
  `cabinet-event-push` handler). The HTTP layer (`globalThis.fetch`) and the DB
  client are the only things stubbed (`supabase/functions/tests/_fakes.ts`).
- **`cabinet-event-push` was refactored** to export a dependency-injected
  `handleEvent(req, db, env)` so the full signed branch runs in-process with a
  fake DB and a temporary secret. `Deno.serve` now simply delegates to it.
- **Stripe payment-integrity logic was extracted** to `_shared/payments.ts`
  (`evaluatePaymentMatch`, `evaluateRefund`) and the webhook now calls it, so the
  tests exercise the exact rules that gate ejection/refunds.
- **Hermetic:** the Deno harness performs **zero writes to the live database**,
  so it leaves no fixtures (see §10).

## 2. Stripe (simulated) — `test:stripe` (15 tests, PASS)
- Real `stripe@17.7.0` signature verification with an in-process `whsec_` secret:
  valid accepted; missing / wrong-secret / tampered-payload rejected.
- `evaluatePaymentMatch`: exact match OK; client-tampered amount → `AMOUNT_MISMATCH`;
  wrong currency → not OK; recomputed≠stored hash → `SNAPSHOT_MISMATCH`;
  spoofed metadata hash → rejected even when recomputed==stored.
- `snapshotHash`: key-order independent, value-sensitive (canonical hashing).
- `evaluateRefund`: full/partial in cents; cannot exceed captured; already-refunded
  no-op; nothing-captured rejected.

## 3. ChargeNow (simulated) — `test:chargenow` (13 tests, PASS)
Against the real client with a stubbed fetch:
- Success `{code:0}`; business failure `{code:1}` → error; HTTP 400/401/403/404/409/429/500
  all map to `ok:false` + surfaced status; non-JSON body does not throw; network
  throw → `ok:false`, status 0; `Authorization: Basic` sent on every call.
- **Contract provenance** (per `chargenow_contract.test.ts` header):
  success envelope `{code:0}` = CONFIRMED by documentation; routes/methods and
  `HTTP_<status>` mapping = DEDUCED FROM IMPLEMENTATION; exact per-endpoint
  business error codes = HYPOTHESIS, to validate manually.

## 4. Callbacks — `test:callbacks` (10 tests, PASS)
Full `cabinet-event-push` signed branch:
- Fail-closed (no secret + prod → 503); **production guard** (`ALLOW_UNSIGNED` has
  NO effect in production); signature missing/wrong → 401, correct → 200 + state
  update; size cap > 64 KB → 413; invalid JSON → 400; replay window (>5 min) → 408;
  atomic dedup (same `external_event_id` twice → second `deduplicated`, single row,
  single business effect); state machine never regresses a terminal session.

## 5. Concurrency — `test:concurrency` (3 tests, PASS)
Real `Promise.all` parallel invocations:
- Two identical `BATTERY_IN` → 1 event row, exactly 1 state-advancing update.
- Two different events → 2 rows, both processed.
- 10 parallel duplicates → 1 inserted, 9 deduplicated.
- **Limitation:** these prove the idempotency *contract* enforced by the UNIQUE
  key (`cabinet_events.external_event_id`, `webhook_events.external_id`, both
  present in migrations). True multi-connection DB races are reserved for the
  isolated staging DB (manual phase).

## 6. Resilience — `test:resilience` (5 tests, PASS)
- ChargeNow network throw / HTTP 500 / HTTP 429 / malformed JSON → `ok:false`, no
  exception. Callback DB insert failure (non-23505) → HTTP 500, no silent success.

## 7. Security — `test:security` (4 tests, PASS)
- Unsigned mode OFF by default and in production; allowed only in dev/test/local
  with explicit flag. `redact()` strips `Authorization`/`token`/`api_key` (incl.
  nested) before logging while preserving non-secret fields.

## 8. Results summary

| Command | Exit | Tests | Result |
|---------|------|-------|--------|
| `npm run typecheck` | 0 | — | PASS |
| `npm run lint` | 1 | — | 37 non-critical frontend `no-explicit-any` remain (see §9); 0 in critical path |
| `npm run build` | 0 | — | PASS (built in ~7s) |
| `npm run test:unit` | 0 | 13 | PASS |
| `npm run test:db` | 0 | 9 assertions | PASS |
| `npm run test:stripe` | 0 | 15 | PASS |
| `npm run test:chargenow` | 0 | 13 | PASS |
| `npm run test:callbacks` | 0 | 10 | PASS |
| `npm run test:concurrency` | 0 | 3 | PASS |
| `npm run test:resilience` | 0 | 5 | PASS |
| `npm run test:security` | 0 | 4 | PASS |
| `npm run test:integration` | 0 | 50 | PASS |

## 9. Corrections applied
- **Security fix:** `cabinet-event-push` now refuses the unsigned dev override in
  any runtime not explicitly marked development/test/local (fail-closed default).
- **ESLint critical path → 0 errors:** typed `cabinet-event-push` (`EventPayload`),
  `sync-cabinet-status` (`CabinetPayload`/`CabinetInfo`/`BatteryInfo`),
  `rental-admin-action` (`RentOrder`). UI: typed `command`/`textarea`/`AdminOverview`/
  `AdminStationDetail` (`LucideIcon`, `ReactNode`), fixed `prefer-const` and the
  `require()` imports in `tailwind.config.ts`.
- **Testability refactors:** `handleEvent` export + injected db/env; extracted
  `_shared/payments.ts` and wired it into `stripe-webhook`.
- **Remaining (non-critical):** 37 `no-explicit-any` in admin **display** pages
  that only render already server-validated read-only data. Documented and
  deliberately deferred; they are outside the security/business critical path.

## 10. Cleanup proof
The Deno integration harness uses in-memory fakes exclusively and performs **no
writes** to the live database; `db-tests.sql` is read-only (assertions only).
Therefore **zero test fixtures are created or left behind**. No campaign prefix
cleanup is required because nothing is persisted.

## 11. Reproduction commands
```bash
npm run typecheck
npm run lint
npm run build
npm run test:unit
npm run test:db
npm run test:stripe
npm run test:chargenow
npm run test:callbacks
npm run test:concurrency
npm run test:resilience
npm run test:security
npm run test:integration   # all Deno suites (50 tests)
npm run test:all           # vitest + db + deno
```
