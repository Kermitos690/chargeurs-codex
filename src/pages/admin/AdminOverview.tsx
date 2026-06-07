import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Server, Wifi, BatteryCharging, CreditCard, AlertTriangle, Activity, type LucideIcon } from "lucide-react";

type Stat = { label: string; value: string | number; icon: LucideIcon; tone: string };

export default function AdminOverview() {
  const [stats, setStats] = useState<Stat[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: stations }, { count: payCount }, { count: activeCount }, { count: errCount }] = await Promise.all([
        supabase.from("stations").select("online, rentable_count"),
        supabase.from("payments").select("id", { count: "exact", head: true }).gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase.from("rental_sessions").select("id", { count: "exact", head: true }).in("state", ["active_rental", "battery_taken", "ejected"]),
        supabase.from("rental_sessions").select("id", { count: "exact", head: true }).in("state", ["eject_failed", "needs_support"]),
      ]);
      const total = stations?.length ?? 0;
      const online = (stations ?? []).filter((s: any) => s.online).length;
      const batteries = (stations ?? []).reduce((a: number, s: any) => a + (s.rentable_count ?? 0), 0);
      setStats([
        { label: "Bornes", value: total, icon: Server, tone: "text-primary" },
        { label: "En ligne", value: `${online}/${total}`, icon: Wifi, tone: "text-success" },
        { label: "Batteries dispo", value: batteries, icon: BatteryCharging, tone: "text-secondary" },
        { label: "Locations actives", value: activeCount ?? 0, icon: Activity, tone: "text-accent" },
        { label: "Paiements aujourd'hui", value: payCount ?? 0, icon: CreditCard, tone: "text-primary" },
        { label: "Erreurs", value: errCount ?? 0, icon: AlertTriangle, tone: "text-destructive" },
      ]);
    })();
  }, []);

  return (
    <div className="animate-fade-in">
      <h1 className="mb-2 font-display text-3xl font-bold">Vue d'ensemble</h1>
      <p className="mb-8 text-muted-foreground">Données réelles synchronisées depuis les bornes ChargeNow.</p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="glass liquid-border rounded-2xl p-6">
            <s.icon className={`mb-3 h-7 w-7 ${s.tone}`} />
            <div className="text-3xl font-bold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
