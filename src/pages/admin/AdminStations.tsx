import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Wifi, WifiOff, RefreshCw, ChevronRight, Loader2 } from "lucide-react";

export default function AdminStations() {
  const [stations, setStations] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("stations").select("*").order("station_id");
    setStations(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const syncAll = async () => {
    setSyncing(true);
    const { data } = await supabase.functions.invoke("sync-cabinet-status", { body: {} });
    if ((data as any)?.configured === false) toast.error("API ChargeNow non configurée");
    else toast.success("Synchronisation terminée");
    await load();
    setSyncing(false);
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Bornes</h1>
          <p className="text-muted-foreground">Stations physiques Chargeurs.ch</p>
        </div>
        <Button onClick={syncAll} disabled={syncing} className="gap-2 rounded-full bg-gradient-primary">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Synchroniser
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stations.map((s) => (
          <Link key={s.station_id} to={`/admin/stations/${s.station_id}`}
            className="glass liquid-border group rounded-2xl p-6 transition-transform hover:scale-[1.02]">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-sm text-muted-foreground">{s.station_id}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${s.online ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {s.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {s.online ? "En ligne" : "Hors ligne"}
              </span>
            </div>
            <h3 className="text-lg font-bold">{s.name}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{s.location_name ?? "—"}</p>
            <div className="flex items-center justify-between text-sm">
              <span>{s.rentable_count} batteries · signal {s.signal ?? "—"}</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
