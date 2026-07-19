import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeClientName,
  normalizeEnvironment,
  normalizeKeyLabel,
  normalizeOwnerEmail,
  normalizeQuota,
  normalizeScopes,
} from "../_shared/apiClientAdmin.ts";

Deno.test("client names are trimmed and bounded", () => {
  assertEquals(normalizeClientName("  Apifox  "), "Apifox");
  assertEquals(normalizeClientName("x"), null);
  assertEquals(normalizeClientName("x".repeat(121)), null);
});

Deno.test("environment defaults safely to test", () => {
  assertEquals(normalizeEnvironment("live"), "live");
  assertEquals(normalizeEnvironment("production"), "test");
  assertEquals(normalizeEnvironment(null), "test");
});

Deno.test("only read-only scopes survive normalization", () => {
  assertEquals(normalizeScopes([
    "stations:read",
    "stations:read",
    "payments:write",
    "*",
    "inventory:read",
    "incidents:read",
  ]), ["stations:read", "inventory:read", "incidents:read"]);
  assertEquals(normalizeScopes("stations:read"), []);
});

Deno.test("quota values are finite integers inside bounds", () => {
  assertEquals(normalizeQuota("120.9", 60, 10_000), 120);
  assertEquals(normalizeQuota(-5, 60, 10_000), 1);
  assertEquals(normalizeQuota(99_999, 60, 10_000), 10_000);
  assertEquals(normalizeQuota("not-a-number", 60, 10_000), 60);
});

Deno.test("owner emails are normalized without accepting malformed values", () => {
  assertEquals(normalizeOwnerEmail("  Test@Chargeurs.CH "), "test@chargeurs.ch");
  assertEquals(normalizeOwnerEmail("not-an-email"), null);
  assertEquals(normalizeOwnerEmail(""), null);
});

Deno.test("key labels are non-empty and bounded", () => {
  assertEquals(normalizeKeyLabel("  Apifox test  "), "Apifox test");
  assertEquals(normalizeKeyLabel(""), "Default key");
  assertEquals(normalizeKeyLabel("x".repeat(200)).length, 120);
});
