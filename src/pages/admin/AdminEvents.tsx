import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/admin/DataTable";

export default function AdminEvents() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    supabase.from("cabinet_events").select("*").order("received_at", { ascending: false }).limit(100)
      .then(({ data }) => setRows(data ?? []));
  }, []);
  const sev = (s: string) => {
    const tone = s === "error" ? "bg-destructive/15 text-destructive" : s === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
    return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{s}</span>;
  };
  return (
    <div className="animate-fade-in">
      <h1 className="mb-6 font-display text-3xl font-bold">Événements bornes</h1>
      <DataTable
        columns={["Type", "Borne", "Sévérité", "Reçu"]}
        empty="Aucun événement reçu (configurez le push depuis Maintenance)."
        rows={rows.map((e) => [
          <span className="font-medium">{e.event_type}</span>,
          e.station_id ?? "—",
          sev(e.severity),
          new Date(e.received_at).toLocaleString(),
        ])}
      />
    </div>
  );
}
