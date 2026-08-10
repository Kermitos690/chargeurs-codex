import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Server, Wifi, BatteryCharging, CreditCard, AlertTriangle, Activity, Loader2, type LucideIcon } from "lucide-react";

type Stat = { label: string; value: string | number; icon: LucideIcon; tone: string };
type Metrics = { stations: number; online: number; batteries: number; activeRentals: number; paymentsToday: number; errors: number };

export default function AdminOverview() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("admin-overview-read", { body: {} });
      if (error || !data?.ok) {
        setLoadError(data?.error ?? error?.message ?? "Le tableau de bord n’a pas pu être chargé.");
        setStats([]);
        setLoading(false);
        return;
      }
      const metrics = data.metrics as Metrics;
      setLoadError(null);
      setStats([
        { label: "Bornes", value: metrics.stations, icon: Server, tone: "text-primary" },
        { label: "En ligne", value: `${metrics.online}/${metrics.stations}`, icon: Wifi, tone: "text-success" },
        { label: "Batteries dispo", value: metrics.batteries, icon: BatteryCharging, tone: "text-secondary" },
        { label: "Locations actives", value: metrics.activeRentals, icon: Activity, tone: "text-accent" },
        { label: "Paiements aujourd'hui", value: metrics.paymentsToday, icon: CreditCard, tone: "text-primary" },
        { label: "Erreurs", value: metrics.errors, icon: AlertTriangle, tone: "text-destructive" },
      ]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="animate-fade-in">
      <h1 className="mb-2 font-display text-3xl font-bold">Vue d'ensemble</h1>
      <p className="mb-4 text-muted-foreground">Vue staging consolidée, calculée côté serveur avec les mêmes droits que le back-office.</p>
      {loadError && <div role="alert" className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</div>}
      {loading && <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement des données du back-office…</div>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {stats.map((stat) => <div key={stat.label} className="glass liquid-border rounded-2xl p-6"><stat.icon className={`mb-3 h-7 w-7 ${stat.tone}`} /><div className="text-3xl font-bold">{stat.value}</div><div className="text-sm text-muted-foreground">{stat.label}</div></div>)}
      </div>
    </div>
  );
}
