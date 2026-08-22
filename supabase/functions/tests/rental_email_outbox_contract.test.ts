import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../process-rental-email-outbox/index.ts", import.meta.url));

Deno.test("rental e-mail delivery requires an explicit provider, verified sender and cut-over", () => {
  assert(source.includes('"EMAIL_PROVIDER_NOT_CONFIGURED"'));
  assert(source.includes('"EMAIL_FROM_NOT_CONFIGURED"'));
  assert(source.includes('"EMAIL_DELIVERY_NOT_ARMED"'));
  assert(source.includes('transactional_email_send_after'));
  assert(source.includes('.gte("created_at", sendAfterIso)'));
  assertEquals(source.includes('"Chargeurs.ch <noreply@chargeurs.ch>"'), false);
});

Deno.test("rental e-mail outbox retains an idempotency reference per rental template", () => {
  assert(source.includes('"X-Entity-Ref-ID": `${row.rental_session_id}:${row.template_key}`'));
  assert(source.includes('.eq("status", "queued")'));
});
