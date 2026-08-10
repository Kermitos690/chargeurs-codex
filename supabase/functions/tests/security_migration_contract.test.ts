import { assert, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL("../../migrations/20260803203905_harden_public_rpc_access.sql", import.meta.url),
);

Deno.test("role helper hardening binds every callable role check to auth.uid", () => {
  const bindings = migration.match(/coalesce\(\(select auth\.uid\(\)\) = _user_id, false\)/g) ?? [];
  assert(bindings.length >= 3);
  assertMatch(migration, /create or replace function public\.has_role\(/);
  assertMatch(migration, /create or replace function public\.has_role_name\(/);
  assertMatch(migration, /create or replace function public\.has_any_role\(/);
});

Deno.test("public kiosk RPC grants are explicit and limited to capability-checked functions", () => {
  assertMatch(migration, /revoke all on function public\.kiosk_quote\(text, text\) from public/);
  assertMatch(migration, /grant execute on function public\.kiosk_quote\(text, text\) to anon, authenticated, service_role/);
  assertMatch(migration, /revoke all on function public\.kiosk_session_status\(uuid, text\) from public/);
  assertMatch(migration, /grant execute on function public\.kiosk_session_status\(uuid, text\) to anon, authenticated, service_role/);
});
