import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canApplyTransition,
  targetState,
} from "../_shared/rentalOrchestratorRuntime.ts";

Deno.test("server orchestrator maps canonical payment and release events", () => {
  assertEquals(targetState("payment_started"), "payment_pending");
  assertEquals(targetState("payment_authorized"), "authorized");
  assertEquals(targetState("release_requested"), "release_requested");
  assertEquals(targetState("test_ejection_resumed"), "release_requested");
  assertEquals(targetState("battery_released"), "released");
  assertEquals(targetState("rental_activated"), "active");
});

Deno.test("server orchestrator enforces the nominal rental lifecycle", () => {
  assertEquals(canApplyTransition("created", "payment_started"), true);
  assertEquals(canApplyTransition("payment_pending", "payment_authorized"), true);
  assertEquals(canApplyTransition("authorized", "release_requested"), true);
  assertEquals(canApplyTransition("release_requested", "battery_released"), true);
  assertEquals(canApplyTransition("failed", "test_ejection_resumed"), true);
  assertEquals(canApplyTransition("released", "rental_activated"), true);
  assertEquals(canApplyTransition("active", "return_detected"), true);
  assertEquals(canApplyTransition("return_detected", "pricing_finalized"), true);
  assertEquals(canApplyTransition("pricing_finalized", "payment_captured"), true);
  assertEquals(canApplyTransition("payment_captured", "rental_completed"), true);
});

Deno.test("server orchestrator rejects unsafe shortcuts", () => {
  assertEquals(canApplyTransition("created", "rental_completed"), false);
  assertEquals(canApplyTransition("payment_pending", "battery_released"), false);
  assertEquals(canApplyTransition("authorized", "rental_activated"), false);
  assertEquals(canApplyTransition("active", "payment_captured"), false);
  assertEquals(canApplyTransition("completed", "payment_refunded"), false);
  assertEquals(canApplyTransition("failed", "battery_released"), false);
});

Deno.test("refund completion is supported after authorization, release request or pricing", () => {
  assertEquals(canApplyTransition("authorized", "payment_refunded"), true);
  assertEquals(canApplyTransition("release_requested", "payment_refunded"), true);
  assertEquals(canApplyTransition("pricing_finalized", "payment_refunded"), true);
  assertEquals(canApplyTransition("refunded", "rental_completed"), true);
});
