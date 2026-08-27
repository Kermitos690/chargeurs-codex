import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVoltSupportMessage, triageVoltMessage, validateVoltText } from "../_shared/voltGateway.ts";

Deno.test("Volt escalates a blocked ejection as high priority", () => {
  const triage = triageVoltMessage("J'ai payé mais la batterie ne sort pas.");
  assertEquals(triage.category, "ejection");
  assertEquals(triage.priority, "high");
  assertEquals(triage.escalate, true);
  assertEquals(triage.provider, "deterministic");
  assertEquals(triage.externalCall, false);
});

Deno.test("Volt answers a generic pricing question without escalation", () => {
  const triage = triageVoltMessage("Quel est le tarif ?");
  assertEquals(triage.category, "pricing");
  assertEquals(triage.priority, "normal");
  assertEquals(triage.escalate, false);
});

Deno.test("Volt validates message boundaries", () => {
  assertEquals(validateVoltText("   ").ok, false);
  assertEquals(validateVoltText("x".repeat(1201)).ok, false);
  assertEquals(validateVoltText("Une question normale").ok, true);
});

Deno.test("Volt support message contains only server-resolved support context", () => {
  const triage = triageVoltMessage("Mon retour n'est pas reconnu.");
  const message = buildVoltSupportMessage({
    mode: "client",
    text: "Mon retour n'est pas reconnu.",
    triage,
    context: { rentalId: "11111111-1111-4111-8111-111111111111", stationId: "DTA21269", rentalState: "active_rental" },
  });
  assertStringIncludes(message, "Source : client");
  assertStringIncludes(message, "Location : 11111111-1111-4111-8111-111111111111");
  assertStringIncludes(message, "Borne : DTA21269");
  assertStringIncludes(message, "État location : active_rental");
  assertEquals(message.includes("user_id"), false);
  assertEquals(message.includes("system_prompt"), false);
});
