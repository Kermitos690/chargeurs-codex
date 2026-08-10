import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function AdminEvents() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-operations-read", { body: { action: "events" } });
      if (error || !data?.ok) {
        toast.error(data?.error ?? error?.message ?? "Impossible de charger les événements.");
        setRows([]);
        return;
      }
      setRows(data.events ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sev = (s: string) => {
    const tone = s === "error" ? "bg-destructive/15 text-destructive" : s === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
    return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{s}</span>;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div><h1 className="font-display text-3xl font-bold">Événements bornes</h1><p className="text-sm text-muted-foreground">Événements matériels reçus du push ChargeNow global.</p></div>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualiser</Button>
      </div>
      <DataTable
        columns={["Type", "Borne", "Sévérité", "Reçu"]}
        empty={loading ? "Chargement…" : "Aucun événement matériel reçu depuis l’activation du push. Vérifiez Santé API ou provoquez un changement réel sur une borne."}
        rows={rows.map((e) => [<span className="font-medium">{e.event_type}</span>, e.station_id ?? "—", sev(e.severity), new Date(e.received_at).toLocaleString()])}
      />
      <p className="mt-4 text-xs text-muted-foreground">La configuration du webhook n’est plus modifiée ici. Voir <Link to="/admin/api-health" className="text-primary underline">Santé API</Link>.</p>
    </div>
  );
}
