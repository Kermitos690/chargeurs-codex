import { assert, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL("../../migrations/20260826201025_pre_production_zero_cost_hardening.sql", import.meta.url),
);
const budget = await Deno.readTextFile(
  new URL("../../../docs/pre-production-zero-cost-budget-2026-08-26.md", import.meta.url),
);
const dispatcherCronMigration = await Deno.readTextFile(
  new URL("../../migrations/20260826210000_reduce_notification_dispatcher_edge_cadence.sql", import.meta.url),
);
const accountPrivacy = await Deno.readTextFile(
  new URL("../account-privacy/index.ts", import.meta.url),
);

Deno.test("P0: historical DTA21269 reconciliation primitive is denied to anon", () => {
  assertMatch(migration, /reconcile_dta21269_pre_release_missing_authorization_projection/);
  assertMatch(migration, /revoke all privileges on function %s from public/);
  assertMatch(migration, /revoke all privileges on function %s from anon/);
  assertMatch(migration, /grant execute on function %s to service_role/);
  assertMatch(migration, /has_function_privilege\('anon', target\.oid, 'execute'\)/);
});

Deno.test("P1: PassStudio automatic provider-push paths remain disabled", () => {
  assertMatch(migration, /customer_wallet\.pass_studio_push/);
  assertMatch(migration, /customer_wallet\.pass_studio_instance_sync/);
  assertMatch(migration, /'customer_wallet\.pass_studio_push', '\{"enabled": false/);
  assertMatch(migration, /'customer_wallet\.pass_studio_instance_sync', '\{"enabled": false/);
});

Deno.test("P1: advertising archive is aggregate-before-delete and stays non-financial", () => {
  assertMatch(migration, /create table if not exists public\.advertising_impression_daily/);
  assertMatch(migration, /insert into public\.advertising_impression_daily/);
  assertMatch(migration, /delete from public\.advertising_impressions/);
  assertMatch(migration, /pg_try_advisory_xact_lock/);
  assertMatch(migration, /retire_advertising_impressions\(14\)/);
  assert(!migration.includes("delete from public.rental_sessions"));
  assert(!migration.includes("delete from public.payments"));
});

Deno.test("P1: e-mail worker is bounded at five minutes, not an Edge hot loop", () => {
  assertMatch(migration, /'\*\/5 \* \* \* \*'/);
  assertMatch(migration, /chargeurs-transactional-email-outbox/);
});

Deno.test("P1: non-critical Wallet dispatcher runs every five minutes", () => {
  assertMatch(dispatcherCronMigration, /chargeurs-plus-push-outbox/);
  assertMatch(dispatcherCronMigration, /schedule := '\*\/5 \* \* \* \*'/);
  assertMatch(budget, /chargeurs-membership-email-outbox/);
  assertMatch(budget, /chargeurs-plus-push-outbox/);
  assertMatch(budget, /chargeurs-plus-push-reminders/);
  assertMatch(budget, /guest-wallet-price-transitions/);
  assertMatch(budget, /every 1 min/);
  assertMatch(budget, /25,920/);
  assertMatch(budget, /91,008/);
});

Deno.test("P1: disabled PassStudio sync cannot queue a manual provider refresh", () => {
  assertMatch(accountPrivacy, /customer_wallet\.pass_studio_instance_sync/);
  assertMatch(accountPrivacy, /status: "current"/);
  assert(accountPrivacy.indexOf("if (!instanceSyncEnabled)") < accountPrivacy.indexOf("enqueue_customer_wallet_sync_event"));
});
