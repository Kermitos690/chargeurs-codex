import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";

export default function AdminPayments() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <div className="animate-fade-in">
      <h1 className="mb-6 font-display text-3xl font-bold">Paiements</h1>
      <DataTable
        columns={["Session Stripe", "Montant", "Méthode", "Statut", "Date"]}
        empty="Aucun paiement réel pour l'instant."
        rows={rows.map((p) => [
          <span className="font-mono text-xs">{p.stripe_session_id ?? "—"}</span>,
          `${Number(p.amount ?? 0).toFixed(2)} ${p.currency}`,
          p.payment_method ?? "—",
          <StateChip state={p.status} />,
          new Date(p.created_at).toLocaleString(),
        ])}
      />
    </div>
  );
}
