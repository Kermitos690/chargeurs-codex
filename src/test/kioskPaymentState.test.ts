import { describe, expect, it } from "vitest";
import { kioskPaymentPresentation } from "@/lib/kioskPaymentState";

describe("kiosk payment state presentation", () => {
  it("shows expiry explicitly even when legacy data uses needs_support", () => {
    expect(kioskPaymentPresentation("needs_support", "CHECKOUT_EXPIRED")).toMatchObject({ phase: "expired", titleKey: "kiosk.state.payment_expired.title" });
  });

  it("keeps a deliberately disabled release under protected server polling", () => {
    expect(kioskPaymentPresentation("needs_support", "HARDWARE_EJECTION_DISABLED")).toMatchObject({ phase: "waitpay", titleKey: "kiosk.state.hardware_ejection_disabled.title" });
  });

  it("keeps a verified payment in preparation until the provider reports release", () => {
    expect(kioskPaymentPresentation("payment_succeeded")).toMatchObject({ phase: "waitpay", titleKey: "kiosk.state.payment_succeeded.title" });
  });
});
