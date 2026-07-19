import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  chargeNowCloseFailure,
  PROVIDER_AUTO_SELECT_SLOT_MODE,
  resolveRentSlot,
} from "../_shared/chargenowSafety.ts";

Deno.test("missing rental slot fails closed", () => {
  assertEquals(resolveRentSlot(null), {
    ok: false,
    error: "CHARGENOW_SLOT_SELECTION_REQUIRED",
  });
});

Deno.test("slot zero fails closed without explicit provider convention", () => {
  assertEquals(resolveRentSlot(0), {
    ok: false,
    error: "CHARGENOW_SLOT_ZERO_NOT_ALLOWED",
  });
});

Deno.test("slot zero is enabled only by the explicit provider auto-select mode", () => {
  assertEquals(resolveRentSlot(null, PROVIDER_AUTO_SELECT_SLOT_MODE), {
    ok: true,
    slotNum: 0,
    automatic: true,
  });
  assertEquals(resolveRentSlot(0, PROVIDER_AUTO_SELECT_SLOT_MODE), {
    ok: true,
    slotNum: 0,
    automatic: true,
  });
});

Deno.test("a concrete positive slot remains valid", () => {
  assertEquals(resolveRentSlot(3), { ok: true, slotNum: 3, automatic: false });
});

Deno.test("ChargeNow close failures are never classified as success", () => {
  assertEquals(chargeNowCloseFailure({ ok: true, status: 200, error: null }), null);
  assertEquals(
    chargeNowCloseFailure({ ok: false, status: 200, error: "HTTP_200_CODE_12" }),
    "HTTP_200_CODE_12",
  );
  assertEquals(
    chargeNowCloseFailure({ ok: false, status: 503, error: null }),
    "CHARGENOW_CLOSE_HTTP_503",
  );
});

Deno.test("legacy close handler gates the closed state on provider success", async () => {
  const source = await Deno.readTextFile("supabase/functions/close-rental-order/index.ts");
  assertEquals(source.includes("chargeNowCloseFailure(res)"), true);
  assertEquals(source.includes("CHARGENOW_CLOSE_UNCONFIRMED"), true);
});

Deno.test("rental ejection validates the slot before the hardware ambiguity boundary", async () => {
  const releaseSource = await Deno.readTextFile("supabase/functions/eject-after-payment/index.ts");
  const clientSource = await Deno.readTextFile("supabase/functions/_shared/chargenow.ts");
  const decisionAt = releaseSource.indexOf("const slotDecision = resolveRentSlot");
  const hardwareAt = releaseSource.indexOf("hardwareCommandIssued = true");
  assertEquals(decisionAt >= 0, true);
  assertEquals(hardwareAt > decisionAt, true);
  assertEquals(clientSource.includes("CHARGENOW_RENT_SLOT_ZERO_MODE"), true);
  assertEquals(clientSource.includes("resolveRentSlot(slotNum"), true);
});
