import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCanonicalUuid } from "../_shared/uuid.ts";

Deno.test("reconcile accepts canonical rental UUIDs from the incident corpus", () => {
  assertEquals(isCanonicalUuid("caf56227-5b44-43ff-93dc-a87f68705248"), true);
  assertEquals(isCanonicalUuid("e3c70716-87c4-4d27-9b39-adfabbe25857"), true);
  assertEquals(isCanonicalUuid("123e4567-e89b-12d3-a456-426614174000"), true);
});

Deno.test("reconcile UUID validation remains fail-closed for malformed ids", () => {
  const invalid = [
    "caf56227-5b44-43ff-93dc-a87f6870524",
    "caf56227-5b44-43ff-93dc-a87f687052480",
    "caf562275b4443ff93dca87f68705248",
    "caf56227-5b44-43ff-93dc-a87f6870524z",
    "caf56227-5b44-43ff-93dc-a87f6870-5248",
    "",
    null,
    42,
  ];
  for (const value of invalid) assertEquals(isCanonicalUuid(value), false, String(value));
});
