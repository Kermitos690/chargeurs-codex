import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function AdminPayments() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-finance-read", { body: { action: "payments" } });
      if (error || !data?.ok) {
        toast.error(data?.error ?? error?.message ?? "Impossible de charger les paiements.");
        setRows([]);
        return;
      }
      setRows(data.payments ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Paiements</h1>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
        </Button>
      </div>
      <DataTable
        columns={["Session Stripe", "Montant", "Méthode", "Statut", "Date"]}
        empty={loading ? "Chargement…" : "Aucun paiement réel pour l'instant."}
        rows={rows.map((p) => [
          <span className="font-mono text-xs">{p.stripe_session_id ?? "—"}</span>,
          `${Number(p.amount ?? 0).toFixed(2)} ${p.currency ?? "CHF"}`,
          p.payment_method ?? "—",
          <StateChip state={p.status} />,
          new Date(p.created_at).toLocaleString(),
        ])}
      />
    </div>
  );
}
