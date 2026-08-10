import { supabase } from "@/integrations/supabase/client";

export type CustomerRental = {
  id: string;
  station_id: string;
  state: string;
  amount_paid: number | null;
  amount_expected: number | null;
  currency: string | null;
  created_at: string;
  paid_at: string | null;
  ejected_at: string | null;
  returned_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
};

export type CustomerPayment = {
  id: string;
  rental_session_id: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  payment_method: string | null;
  provider: string | null;
  created_at: string;
  refunded_at: string | null;
};

export type CustomerRefund = {
  id: string;
  rental_session_id: string | null;
  status: string;
  amount: number;
  currency: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerIncident = {
  id: string;
  rental_session_id: string | null;
  type: string;
  severity: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type CustomerProfile = {
  display_name: string;
  phone: string;
  preferred_language: string;
  marketing_consent: boolean;
};

export const ACTIVE_RENTAL_STATES = new Set(["ejected", "battery_taken", "active_rental"]);

export const RENTAL_STATE_LABELS: Record<string, string> = {
  created: "Créée",
  checkout_created: "Paiement à confirmer",
  payment_processing: "Paiement en cours",
  payment_succeeded: "Payée",
  ejecting: "Distribution en cours",
  ejected: "Batterie distribuée",
  battery_taken: "Batterie retirée",
  active_rental: "Location en cours",
  battery_returned: "Batterie rendue",
  billing_pending: "Clôture en cours",
  completed: "Terminée",
  closed: "Clôturée",
  payment_failed: "Paiement refusé",
  payment_expired: "Paiement expiré",
  chargenow_failed: "Distribution impossible",
  eject_failed: "Distribution impossible",
  needs_support: "Assistance requise",
  refund_pending: "Remboursement en cours",
  refunded: "Remboursée",
  partially_refunded: "Partiellement remboursée",
  non_returned: "Batterie non restituée",
};

export function rentalStateLabel(state: string) {
  return RENTAL_STATE_LABELS[state] ?? "État en cours de vérification";
}

export function formatAccountMoney(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: currency || "CHF",
  }).format(amount);
}

export function formatAccountDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" });
}

export async function fetchCustomerRentals(limit = 100): Promise<CustomerRental[]> {
  const summary = await fetchPrivateAccountSummary();
  return summary.rentals.slice(0, limit);
}

export async function fetchCustomerPayments(limit = 100): Promise<CustomerPayment[]> {
  const summary = await fetchPrivateAccountSummary();
  return summary.payments.slice(0, limit);
}

export async function fetchPrivateAccountSummary(): Promise<{
  rentals: CustomerRental[];
  payments: CustomerPayment[];
  refunds: CustomerRefund[];
  incidents: CustomerIncident[];
  profile: Record<string, unknown> | null;
}> {
  const { data, error } = await supabase.functions.invoke("account-privacy", {
    body: { action: "summary" },
  });
  if (error || !data?.ok) throw new Error("ACCOUNT_SUMMARY_UNAVAILABLE");
  return {
    rentals: (data.data?.rentals ?? []) as CustomerRental[],
    payments: (data.data?.payments ?? []) as CustomerPayment[],
    refunds: (data.data?.refunds ?? []) as CustomerRefund[],
    incidents: (data.data?.incidents ?? []) as CustomerIncident[],
    profile: (data.data?.profile ?? null) as Record<string, unknown> | null,
  };
}

export function profileFromRecord(record: Record<string, unknown> | null): CustomerProfile {
  return {
    display_name: String(record?.display_name ?? ""),
    phone: String(record?.phone ?? ""),
    preferred_language: String(record?.preferred_language ?? "fr"),
    marketing_consent: Boolean(record?.marketing_consent),
  };
}
