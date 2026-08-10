import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accountDeletionBlocked, safeDeletedEmail } from "../_shared/accountPrivacy.ts";

Deno.test("account deletion is blocked by any active or unsettled rental", () => {
  assertEquals(accountDeletionBlocked(["closed", "refunded"]), false);
  assertEquals(accountDeletionBlocked(["closed", "active_rental"]), true);
  assertEquals(accountDeletionBlocked(["refund_pending"]), true);
});

Deno.test("deleted customer alias contains no original email", () => {
  const alias = safeDeletedEmail("11111111-1111-4111-8111-111111111111");
  assertEquals(alias, "deleted+11111111-1111-4111-8111-111111111111@invalid.chargeurs.ch");
});
