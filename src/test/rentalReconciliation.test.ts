import { describe, expect, it } from "vitest";
import { reconcileRental } from "@/lib/rentalReconciliation";

describe("rentalReconciliation", () => {
  it("détecte un paiement Stripe manquant", () => {
    const findings = reconcileRental({
      rentalId: "rental-1",
      localState: "active",
      stripeState: "missing",
      supplierState: "released",
      batteryId: "PB-1",
    });

    expect(findings.some((finding) => finding.code === "PAYMENT_MISSING")).toBe(true);
  });

  it("détecte une batterie délivrée avant activation locale", () => {
    const findings = reconcileRental({
      rentalId: "rental-1",
      localState: "authorized",
      stripeState: "requires_capture",
      supplierState: "released",
    });

    expect(findings.some((finding) => finding.code === "ORPHAN_SUPPLIER_RELEASE")).toBe(true);
  });

  it("détecte un retour non confirmé par le fournisseur", () => {
    const findings = reconcileRental({
      rentalId: "rental-1",
      localState: "return_detected",
      stripeState: "requires_capture",
      supplierState: "released",
      batteryId: "PB-1",
    });

    expect(findings.some((finding) => finding.code === "RETURN_STATE_MISMATCH")).toBe(true);
  });

  it("confirme un état cohérent", () => {
    const findings = reconcileRental({
      rentalId: "rental-1",
      localState: "active",
      stripeState: "requires_capture",
      supplierState: "released",
      paymentIntentId: "pi_1",
      batteryId: "PB-1",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("CONSISTENT");
  });
});
