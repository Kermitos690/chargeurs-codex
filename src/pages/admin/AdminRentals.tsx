import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function AdminRentals() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-finance-read", { body: { action: "rentals" } });
      if (error || !data?.ok) {
        toast.error(data?.error ?? error?.message ?? "Impossible de charger les locations.");
        setRows([]);
        return;
      }
      setRows(data.rentals ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleTimeString() : "—");

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Locations</h1>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser
        </Button>
      </div>
      <DataTable
        columns={["Session", "Borne", "TradeNo", "Slot", "État", "Créé", "Payé", "Éjecté", "Retour"]}
        empty={loading ? "Chargement…" : "Aucune location pour l'instant."}
        rows={rows.map((r) => [
          <span className="font-mono text-xs">{String(r.id).slice(0, 8)}</span>,
          r.station_id,
          <span className="font-mono text-xs">{r.apifox_trade_no ?? "—"}</span>,
          r.selected_slot_num ?? "—",
          <StateChip state={r.state} />,
          fmt(r.created_at), fmt(r.paid_at), fmt(r.ejected_at), fmt(r.returned_at),
        ])}
      />
    </div>
  );
}
