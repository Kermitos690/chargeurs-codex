import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  derivePlatformWebhookSecret,
  nextPlatformWebhookAttempt,
  signPlatformWebhook,
  validatePlatformWebhookUrl,
  webhookEventTypes,
} from "../_shared/platformWebhooks.ts";

Deno.test("derives stable endpoint secrets without persisting the master", async () => {
  const master = "m".repeat(64);
  const first = await derivePlatformWebhookSecret("endpoint-1", "nonce-1", master);
  const second = await derivePlatformWebhookSecret("endpoint-1", "nonce-1", master);
  const rotated = await derivePlatformWebhookSecret("endpoint-1", "nonce-2", master);
  assertEquals(first, second);
  assertNotEquals(first, rotated);
  assert(first.startsWith("whsec_"));
  assertEquals(first.includes(master), false);
});

Deno.test("signs timestamp, event id and exact body", async () => {
  const secret = await derivePlatformWebhookSecret("endpoint-1", "nonce-1", "m".repeat(64));
  const first = await signPlatformWebhook(secret, "1720000000", "event-1", "{\"ok\":true}");
  const second = await signPlatformWebhook(secret, "1720000000", "event-1", "{\"ok\":true}");
  const changed = await signPlatformWebhook(secret, "1720000000", "event-1", "{\"ok\":false}");
  assertEquals(first, second);
  assertNotEquals(first, changed);
  assert(first.startsWith("v1="));
});

Deno.test("accepts only public HTTPS webhook destinations", () => {
  assertEquals(validatePlatformWebhookUrl("https://hooks.example.ch/chargeurs").ok, true);
  assertEquals(validatePlatformWebhookUrl("http://hooks.example.ch/chargeurs").ok, false);
  assertEquals(validatePlatformWebhookUrl("https://localhost/hook").ok, false);
  assertEquals(validatePlatformWebhookUrl("https://127.0.0.1/hook").ok, false);
  assertEquals(validatePlatformWebhookUrl("https://user:pass@hooks.example.ch/hook").ok, false);
  assertEquals(validatePlatformWebhookUrl("https://hooks.example.ch:9443/hook").ok, false);
});

Deno.test("uses bounded exponential webhook retries", () => {
  const origin = Date.UTC(2026, 6, 15, 12, 0, 0);
  assertEquals(nextPlatformWebhookAttempt(1, origin), new Date(origin + 60_000).toISOString());
  assertEquals(nextPlatformWebhookAttempt(2, origin), new Date(origin + 5 * 60_000).toISOString());
  assertEquals(nextPlatformWebhookAttempt(8, origin), null);
});

Deno.test("normalizes webhook event subscriptions", () => {
  assertEquals(webhookEventTypes(undefined), ["*"]);
  assertEquals(webhookEventTypes(["rental.created", "rental.created", "unknown"]), ["rental.created"]);
});
