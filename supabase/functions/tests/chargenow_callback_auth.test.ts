import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildChargeNowCallbackUrl,
  chargeNowCallbackToken,
  verifyChargeNowCallback,
} from "../_shared/chargenowCallbackAuth.ts";

const RENTAL_A = "11111111-1111-4111-8111-111111111111";
const RENTAL_B = "22222222-2222-4222-8222-222222222222";

Deno.test("ChargeNow callback tokens are deterministic and rental scoped", async () => {
  Deno.env.set("CHARGENOW_CALLBACK_SIGNING_KEY", "test-signing-key-with-sufficient-entropy");
  try {
    const first = await chargeNowCallbackToken(RENTAL_A);
    const replay = await chargeNowCallbackToken(RENTAL_A);
    const other = await chargeNowCallbackToken(RENTAL_B);
    assertEquals(first, replay);
    assert(first.length >= 40);
    assert(first !== other);
  } finally {
    Deno.env.delete("CHARGENOW_CALLBACK_SIGNING_KEY");
  }
});

Deno.test("generated callback URL authenticates only the scoped rental", async () => {
  Deno.env.set("CHARGENOW_CALLBACK_SIGNING_KEY", "test-signing-key-with-sufficient-entropy");
  try {
    const url = await buildChargeNowCallbackUrl("https://example.supabase.co", RENTAL_A);
    assert(!url.includes("amp;token"));
    assert(!url.includes("%26amp%3Btoken"));
    assert(!new URL(url).searchParams.has("rental"));
    const request = new Request(url, { method: "POST" });
    assertEquals(await verifyChargeNowCallback(request, RENTAL_A), true);
    assertEquals(await verifyChargeNowCallback(request, RENTAL_B), false);
  } finally {
    Deno.env.delete("CHARGENOW_CALLBACK_SIGNING_KEY");
  }
});

Deno.test("valid legacy amp;token remains scoped to its rental", async () => {
  Deno.env.set("CHARGENOW_CALLBACK_SIGNING_KEY", "test-signing-key-with-sufficient-entropy");
  try {
    const token = await chargeNowCallbackToken(RENTAL_A);
    const request = new Request(
      `https://example.supabase.co/functions/v1/chargenow-rent-callback?extra=1&rental=${RENTAL_A}&amp;token=${token}`,
      { method: "POST" },
    );
    assertEquals(await verifyChargeNowCallback(request, RENTAL_A), true);
    assertEquals(await verifyChargeNowCallback(request, RENTAL_B), false);
  } finally {
    Deno.env.delete("CHARGENOW_CALLBACK_SIGNING_KEY");
  }
});

Deno.test("missing or forged callback tokens are rejected in any query order", async () => {
  Deno.env.set("CHARGENOW_CALLBACK_SIGNING_KEY", "test-signing-key-with-sufficient-entropy");
  try {
    const missing = new Request(`https://example.supabase.co/callback?foo=1&rental=${RENTAL_A}`, { method: "POST" });
    const forged = new Request(`https://example.supabase.co/callback?token=forged&rental=${RENTAL_A}&foo=1`, { method: "POST" });
    assertEquals(await verifyChargeNowCallback(missing, RENTAL_A), false);
    assertEquals(await verifyChargeNowCallback(forged, RENTAL_A), false);
  } finally {
    Deno.env.delete("CHARGENOW_CALLBACK_SIGNING_KEY");
  }
});

Deno.test("legacy global secret is accepted only from a header", async () => {
  Deno.env.set("CHARGENOW_EVENT_SECRET", "legacy-test-secret");
  try {
    const headerRequest = new Request("https://example.supabase.co/functions/v1/chargenow-rent-callback", {
      method: "POST",
      headers: { "x-event-secret": "legacy-test-secret" },
    });
    const queryRequest = new Request(
      "https://example.supabase.co/functions/v1/chargenow-rent-callback?secret=legacy-test-secret",
      { method: "POST" },
    );
    assertEquals(await verifyChargeNowCallback(headerRequest, RENTAL_A), true);
    assertEquals(await verifyChargeNowCallback(queryRequest, RENTAL_A), false);
  } finally {
    Deno.env.delete("CHARGENOW_EVENT_SECRET");
  }
});
