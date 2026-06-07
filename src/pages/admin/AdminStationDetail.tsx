import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, Loader2, Wifi, WifiOff, Battery } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminStationDetail() {
  const { stationId } = useParams();
  const [station, setStation] = useState<any>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [rental, setRental] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [{ data: st }, { data: sl }, { data: ev }, { data: rt }] = await Promise.all([
      supabase.from("stations").select("*").eq("station_id", stationId).maybeSingle(),
      supabase.from("slots").select("*").eq("station_id", stationId).order("slot_num"),
      supabase.from("cabinet_events").select("*").eq("station_id", stationId).order("received_at", { ascending: false }).limit(8),
      supabase.from("rental_sessions").select("*").eq("station_id", stationId).in("state", ["active_rental", "battery_taken", "ejected"]).order("created_at", { ascending: false }).limit(1),
    ]);
    setStation(st); setSlots(sl ?? []); setEvents(ev ?? []); setRental(rt?.[0] ?? null);
  }, [stationId]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    const { data } = await supabase.functions.invoke("sync-cabinet-status", { body: { stationId } });
    if ((data as any)?.configured === false) toast.error("API ChargeNow non configurée");
    else toast.success("Synchronisé");
    await load(); setSyncing(false);
  };

  if (!station) return <Loader2 className="h-8 w-8 animate-spin text-primary" />;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-muted-foreground">{station.station_id}</p>
          <h1 className="font-display text-3xl font-bold">{station.name}</h1>
          <p className="text-muted-foreground">{station.location_name}</p>
        </div>
        <Button onClick={sync} disabled={syncing} className="gap-2 rounded-full bg-gradient-primary">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Synchroniser
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Info label="Statut" value={station.online ? "En ligne" : "Hors ligne"} icon={station.online ? Wifi : WifiOff} tone={station.online ? "text-success" : "text-muted-foreground"} />
        <Info label="Signal" value={station.signal ?? "—"} />
        <Info label="Disponibles" value={station.rentable_count} />
        <Info label="Dernière sync" value={station.last_sync_at ? new Date(station.last_sync_at).toLocaleTimeString() : "—"} />
      </div>

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Carte des emplacements</h2>
        {slots.length === 0 ? (
          <p className="text-muted-foreground">Aucune donnée d'emplacement (synchronisation requise).</p>
        ) : (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {slots.map((sl) => (
              <div key={sl.slot_num} className={cn("flex flex-col items-center gap-1 rounded-xl p-3",
                sl.battery_id ? "bg-success/15" : "bg-muted/50")}>
                <Battery className={cn("h-6 w-6", sl.battery_id ? "text-success" : "text-muted-foreground")} />
                <span className="text-xs font-bold">#{sl.slot_num}</span>
                <span className="truncate text-[10px] text-muted-foreground">{sl.battery_id ?? "vide"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {rental && (
        <section className="glass liquid-border rounded-2xl p-6">
          <h2 className="mb-2 font-display text-xl font-bold">Location active</h2>
          <p className="font-mono text-sm">{rental.id}</p>
          <p className="text-muted-foreground">État : {rental.state} · slot {rental.selected_slot_num ?? "—"}</p>
        </section>
      )}

      <section className="glass liquid-border rounded-2xl p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Derniers événements</h2>
        {events.length === 0 ? <p className="text-muted-foreground">Aucun événement reçu.</p> : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm">
                <span className="font-medium">{e.event_type}</span>
                <span className="text-muted-foreground">{new Date(e.received_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Info({ label, value, icon: Icon, tone }: { label: string; value: any; icon?: any; tone?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      {Icon && <Icon className={cn("mb-2 h-5 w-5", tone)} />}
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
