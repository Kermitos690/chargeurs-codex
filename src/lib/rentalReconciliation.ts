import type { RentalState } from "@/lib/rentalOrchestrator";

export type StripeRentalState = "missing" | "requires_payment_method" | "requires_capture" | "succeeded" | "canceled";
export type SupplierRentalState = "unknown" | "available" | "release_requested" | "released" | "returned";

export type RentalReconciliationInput = {
  rentalId: string;
  localState: RentalState;
  stripeState: StripeRentalState;
  supplierState: SupplierRentalState;
  paymentIntentId?: string | null;
  batteryId?: string | null;
};

export type ReconciliationSeverity = "info" | "warning" | "critical";

export type ReconciliationFinding = {
  code:
    | "PAYMENT_MISSING"
    | "CAPTURE_STATE_MISMATCH"
    | "RELEASE_STATE_MISMATCH"
    | "RETURN_STATE_MISMATCH"
    | "ORPHAN_SUPPLIER_RELEASE"
    | "CONSISTENT";
  severity: ReconciliationSeverity;
  message: string;
  recommendedAction: string;
};

const paymentExpectedStates: RentalState[] = [
  "authorized",
  "release_requested",
  "released",
  "active",
  "return_detected",
  "pricing_finalized",
  "payment_captured",
  "completed",
  "non_return",
];

export function reconcileRental(input: RentalReconciliationInput): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];

  if (paymentExpectedStates.includes(input.localState) && input.stripeState === "missing") {
    findings.push({
      code: "PAYMENT_MISSING",
      severity: "critical",
      message: "La location locale nécessite un paiement, mais aucun PaymentIntent Stripe n'est retrouvé.",
      recommendedAction: "Bloquer toute nouvelle action, ouvrir un incident et rechercher l'événement Stripe manquant.",
    });
  }

  if (
    ["payment_captured", "completed"].includes(input.localState) &&
    !["succeeded"].includes(input.stripeState)
  ) {
    findings.push({
      code: "CAPTURE_STATE_MISMATCH",
      severity: "critical",
      message: "La location est déclarée encaissée ou terminée alors que Stripe ne confirme pas le paiement.",
      recommendedAction: "Relancer la réconciliation Stripe sans effectuer de seconde capture automatique.",
    });
  }

  if (
    ["released", "active", "return_detected", "pricing_finalized", "payment_captured", "completed", "non_return"].includes(
      input.localState,
    ) &&
    !["released", "returned"].includes(input.supplierState)
  ) {
    findings.push({
      code: "RELEASE_STATE_MISMATCH",
      severity: "critical",
      message: "Le système local considère la batterie délivrée, mais le fournisseur ne confirme pas sa sortie.",
      recommendedAction: "Ouvrir un incident matériel et suspendre la capture tant que la sortie n'est pas confirmée.",
    });
  }

  if (
    ["return_detected", "pricing_finalized", "payment_captured", "completed"].includes(input.localState) &&
    input.supplierState !== "returned"
  ) {
    findings.push({
      code: "RETURN_STATE_MISMATCH",
      severity: "warning",
      message: "Le retour est enregistré localement sans confirmation fournisseur.",
      recommendedAction: "Vérifier le slot, l'identifiant batterie et le callback de retour avant clôture définitive.",
    });
  }

  if (["created", "payment_pending", "authorized"].includes(input.localState) && input.supplierState === "released") {
    findings.push({
      code: "ORPHAN_SUPPLIER_RELEASE",
      severity: "critical",
      message: "Une batterie semble avoir été délivrée avant l'activation locale de la location.",
      recommendedAction: "Bloquer la borne, associer la batterie à une location ou la déclarer en incident immédiatement.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: "CONSISTENT",
      severity: "info",
      message: "Les états local, Stripe et fournisseur sont cohérents.",
      recommendedAction: "Aucune action corrective nécessaire.",
    });
  }

  return findings;
}
