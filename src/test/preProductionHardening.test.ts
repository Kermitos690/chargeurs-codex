import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826201025_pre_production_zero_cost_hardening.sql"),
  "utf8",
);
const budget = readFileSync(
  resolve(process.cwd(), "docs/pre-production-zero-cost-budget-2026-08-26.md"),
  "utf8",
);
const passStudioContract = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/passStudio.ts"),
  "utf8",
);
const passStudioWallet = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/passStudioWallet.ts"),
  "utf8",
);
const dispatcherCronMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826210000_reduce_notification_dispatcher_edge_cadence.sql"),
  "utf8",
);

describe("pre-production zero-cost hardening migration", () => {
  it("denies anonymous execution of the historical DTA21269 reconciliation primitive", () => {
    expect(migration).toContain("reconcile_dta21269_pre_release_missing_authorization_projection");
    expect(migration).toContain("revoke all privileges on function %s from public");
    expect(migration).toContain("revoke all privileges on function %s from anon");
    expect(migration).toContain("grant execute on function %s to service_role");
    expect(migration).toContain("has_function_privilege('anon', target.oid, 'execute')");
  });

  it("keeps all automatic PassStudio provider-push paths disabled", () => {
    expect(migration).toContain("customer_wallet.pass_studio_push");
    expect(migration).toContain("customer_wallet.pass_studio_instance_sync");
    expect(migration).toContain("'customer_wallet.pass_studio_push', '{\"enabled\": false");
    expect(migration).toContain("'customer_wallet.pass_studio_instance_sync', '{\"enabled\": false");
  });

  it("archives advertising aggregates before deleting only old raw telemetry", () => {
    expect(migration).toContain("insert into public.advertising_impression_daily");
    expect(migration).toContain("delete from public.advertising_impressions");
    expect(migration).toContain("pg_try_advisory_xact_lock");
    expect(migration).not.toContain("delete from public.rental_sessions");
    expect(migration).not.toContain("delete from public.payments");
  });

  it("keeps the non-critical Wallet dispatcher at a five-minute Edge cadence", () => {
    expect(dispatcherCronMigration).toContain("chargeurs-plus-push-outbox");
    expect(dispatcherCronMigration).toContain("schedule := '*/5 * * * *'");
    expect(budget).toContain("chargeurs-plus-push-outbox");
    expect(budget).toContain("`noop` (unversioned dispatcher)");
    expect(budget).toContain("17,280");
    expect(budget).toContain("82,368");
  });

  it("maps Custom Pass field labels back to their stable provider field keys", () => {
    expect(passStudioContract).toContain("fieldLabels?: Record<string, string>");
    expect(passStudioWallet).toContain("pass.fieldLabels?.[key] ?? key");
  });
});
