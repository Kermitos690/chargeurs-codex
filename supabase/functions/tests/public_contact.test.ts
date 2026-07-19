import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { originAllowed, saltedIpHash, validatePublicContact } from "../_shared/publicContact.ts";

Deno.test("public contact validation accepts a normalized support request", () => {
  const result = validatePublicContact({
    requestType: "support", name: " Client ", email: "CLIENT@EXAMPLE.CH",
    stationId: "DTA21269", message: "La batterie ne sort pas du slot.", locale: "fr",
  });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.email, "client@example.ch");
});

Deno.test("public contact validation rejects honeypot and malformed data", () => {
  assertEquals(validatePublicContact({ requestType: "support", website: "spam" }).ok, false);
  assertEquals(validatePublicContact({ requestType: "support", name: "A", email: "bad", message: "court" }).ok, false);
});

Deno.test("origin allow-list is exact and the stored IP derivative is salted", async () => {
  assertEquals(originAllowed("https://chargeurs.ch", "https://chargeurs.ch,https://staging.chargeurs.ch"), true);
  assertEquals(originAllowed("https://evil.example", "https://chargeurs.ch"), false);
  const first = await saltedIpHash("192.0.2.1", "a".repeat(32));
  const second = await saltedIpHash("192.0.2.1", "b".repeat(32));
  assertEquals(first.length, 64);
  assertEquals(first === second, false);
});
