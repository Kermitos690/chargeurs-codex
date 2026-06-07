import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, StateChip } from "@/components/admin/DataTable";

export default function AdminRentals() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    supabase.from("rental_sessions").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setRows(data ?? []));
  }, []);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleTimeString() : "—");
  return (
    <div className="animate-fade-in">
      <h1 className="mb-6 font-display text-3xl font-bold">Locations</h1>
      <DataTable
        columns={["Session", "Borne", "TradeNo", "Slot", "État", "Créé", "Payé", "Éjecté", "Retour"]}
        empty="Aucune location pour l'instant."
        rows={rows.map((r) => [
          <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>,
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
