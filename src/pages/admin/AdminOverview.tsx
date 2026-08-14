import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, BatteryCharging, CheckCircle2, ChevronRight, CircleDollarSign,
  CreditCard, Loader2, Megaphone, RefreshCw, Server, ShieldAlert, Wifi, WifiOff,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Severity = "critical" | "warning" | "info";
type AlertRow = {
  id: string;
  severity: Severity;
  stationId: string;
  title: string;
  detail: string;
  recommendation: string;
  href: string;
};
type FleetRow = {
  stationId: string;
  name: string;
  locationName: string | null;
  providerOnline: boolean;
  kioskAuthenticated: boolean;
  rentalReady: boolean;
  status: string | null;
  rentableCount: number;
  returnableCount: number;
  totalCount: number;
  lastSyncAt: string | null;
  lastProviderSuccessAt: string | null;
  lastKioskSeenAt: string | null;
  providerError: string | null;
};
type TrendRow = {
  date: string;
  rentals: number;
  completedRentals: number;
  payments: number;
  revenueCents: number;
  adMinutes: number;
};
type TrendDisplayRow = TrendRow & { label: string; revenue: number };
type Metrics = {
  stations: number;
  providerOnline: number;
  kioskAuthenticated: number;
  rentalReady: number;
  healthScore: number;
  batteries: number;
  activeRentals: number;
  rentalsToday: number;
  paymentsToday: number;
  revenueTodayCents: number;
  criticalAlerts: number;
  adImpressions30d: number;
  adHours30d: number;
};
type OverviewData = {
  ok: boolean;
  generatedAt: string;
  metrics: Metrics;
  alerts: AlertRow[];
  fleet: FleetRow[];
  trends: TrendRow[];
  error?: string;
};

type MetricCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: string;
};

const money = (cents: number) => `${(Number(cents || 0) / 100).toFixed(2)} CHF`;
const dayLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit" });

function relative(value: string | null): string {
  if (!value) return "jamais";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "à l’instant";
  if (ms < 3_600_000) return `il y a ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `il y a ${Math.floor(ms / 3_600_000)} h`;
  return `il y a ${Math.floor(ms / 86_400_000)} j`;
}

function MetricCard({ icon: Icon, label, value, detail, tone = "text-primary" }: MetricCardProps) {
  return (
    <div className="glass liquid-border rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-sm text-muted-foreground">{label}</div><div className="mt-2 text-3xl font-bold tracking-tight">{value}</div></div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-muted/40"><Icon className={`h-5 w-5 ${tone}`} /></div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function AlertCard({ alert }: { alert: AlertRow }) {
  const critical = alert.severity === "critical";
  return (
    <div className={`rounded-2xl border p-4 ${critical ? "border-destructive/35 bg-destructive/10" : "border-warning/35 bg-warning/10"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {critical ? <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />}
            <strong>{alert.title}</strong>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{alert.detail}</p>
          <div className="mt-3 rounded-xl bg-background/55 px-3 py-2 text-sm"><b>Action conseillée :</b> {alert.recommendation}</div>
        </div>
        <Link to={alert.href}><Button size="sm" variant={critical ? "destructive" : "outline"} className="gap-1">Ouvrir <ChevronRight className="h-4 w-4" /></Button></Link>
      </div>
    </div>
  );
}

function FleetState({ row }: { row: FleetRow }) {
  if (row.rentalReady) return <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-bold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Prête</span>;
  if (!row.providerOnline) return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-bold text-destructive"><WifiOff className="h-3.5 w-3.5" /> Hors ligne</span>;
  if (!row.kioskAuthenticated) return <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-bold text-warning"><ShieldAlert className="h-3.5 w-3.5" /> Location HS</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-bold text-warning"><BatteryCharging className="h-3.5 w-3.5" /> Stock</span>;
}

function ActivityChart({ rows }: { rows: TrendDisplayRow[] }) {
  const width = 700;
  const height = 220;
  const padX = 34;
  const padY = 24;
  const max = Math.max(1, ...rows.flatMap((row) => [row.rentals, row.payments]));
  const x = (index: number) => padX + (rows.length <= 1 ? 0 : index * ((width - padX * 2) / (rows.length - 1)));
  const y = (value: number) => height - padY - (value / max) * (height - padY * 2);
  const points = (key: "rentals" | "payments") => rows.map((row, index) => `${x(index)},${y(row[key])}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label="Locations et paiements des sept derniers jours">
        {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={padX} x2={width - padX} y1={padY + ratio * (height - padY * 2)} y2={padY + ratio * (height - padY * 2)} stroke="currentColor" className="text-border" strokeDasharray="5 7" />)}
        <polyline points={points("rentals")} fill="none" stroke="hsl(var(--primary))" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={points("payments")} fill="none" stroke="hsl(var(--secondary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
        {rows.map((row, index) => <g key={row.date}><circle cx={x(index)} cy={y(row.rentals)} r="5" fill="hsl(var(--primary))" /><circle cx={x(index)} cy={y(row.payments)} r="4" fill="hsl(var(--secondary))" /></g>)}
      </svg>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">{rows.map((row) => <span key={row.date}>{row.label}</span>)}</div>
      <div className="mt-4 flex gap-4 text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-primary" /> Locations</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-secondary" /> Paiements</span></div>
    </div>
  );
}

function RevenueChart({ rows }: { rows: TrendDisplayRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.revenue));
  return (
    <div className="flex h-[19rem] items-end gap-2 pt-8 sm:gap-3">
      {rows.map((row) => {
        const height = Math.max(row.revenue > 0 ? 8 : 2, (row.revenue / max) * 100);
        return (
          <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="text-[10px] font-semibold text-muted-foreground">{row.revenue > 0 ? row.revenue.toFixed(2) : ""}</div>
            <div className="relative flex h-52 w-full items-end overflow-hidden rounded-xl bg-muted/25"><div className="w-full rounded-xl bg-primary/80 transition-all" style={{ height: `${height}%` }} /></div>
            <span className="text-[11px] text-muted-foreground">{row.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data: result, error } = await supabase.functions.invoke<OverviewData>("admin-overview-read", { body: {} });
    if (error || !result?.ok) {
      setLoadError(result?.error ?? error?.message ?? "Le Control Center n’a pas pu être chargé.");
      if (!quiet) setLoading(false);
      return;
    }
    setData(result);
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const trendData = useMemo<TrendDisplayRow[]>(() => (data?.trends ?? []).map((row) => ({ ...row, label: dayLabel(row.date), revenue: row.revenueCents / 100 })), [data]);
  const metrics = data?.metrics;
  const criticalAlerts = data?.alerts.filter((row) => row.severity === "critical") ?? [];
  const secondaryAlerts = data?.alerts.filter((row) => row.severity !== "critical") ?? [];

  return (
    <div className="animate-fade-in space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-primary">Chargeurs Control Center</div>
          <h1 className="font-display text-3xl font-bold">État du réseau</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Ce qui fonctionne, ce qui bloque les locations et l’action recommandée — à partir des données réelles Chargeurs + fournisseur.</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.generatedAt && <span className="hidden text-xs text-muted-foreground md:inline">Mis à jour {relative(data.generatedAt)}</span>}
          <Button variant="outline" className="gap-2" onClick={() => void load(false)} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualiser</Button>
        </div>
      </div>

      {loadError && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</div>}
      {loading && !data && <div className="glass grid min-h-56 place-items-center rounded-3xl"><div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Chargement du réseau…</div></div>}

      {data && metrics && <>
        <section className={`overflow-hidden rounded-3xl border p-5 sm:p-6 ${criticalAlerts.length ? "border-destructive/30 bg-destructive/[.06]" : "border-success/25 bg-success/[.05]"}`}>
          <div className="grid gap-6 xl:grid-cols-[16rem_1fr] xl:items-center">
            <div className="flex items-center gap-5 xl:block">
              <div className="relative grid h-32 w-32 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(hsl(var(--primary)) ${metrics.healthScore * 3.6}deg, hsl(var(--muted)) 0deg)` }}>
                <div className="grid h-24 w-24 place-items-center rounded-full bg-background shadow-inner"><div className="text-center"><div className="text-3xl font-black">{metrics.healthScore}%</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">prêt location</div></div></div>
              </div>
              <div className="xl:mt-4"><div className="font-display text-xl font-bold">{criticalAlerts.length ? `${criticalAlerts.length} action${criticalAlerts.length > 1 ? "s" : ""} urgente${criticalAlerts.length > 1 ? "s" : ""}` : "Réseau opérationnel"}</div><p className="mt-1 text-sm text-muted-foreground">{metrics.rentalReady}/{metrics.stations} bornes peuvent actuellement servir une location complète.</p></div>
            </div>
            <div className="space-y-3">
              {criticalAlerts.slice(0, 4).map((alert) => <AlertCard key={alert.id} alert={alert} />)}
              {!criticalAlerts.length && <div className="flex min-h-28 items-center gap-4 rounded-2xl border border-success/20 bg-background/45 p-5"><CheckCircle2 className="h-9 w-9 text-success" /><div><b>Aucun incident critique détecté.</b><p className="mt-1 text-sm text-muted-foreground">Le matériel fournisseur et les kiosks Chargeurs nécessaires aux locations répondent.</p></div></div>}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Server} label="Bornes prêtes" value={`${metrics.rentalReady}/${metrics.stations}`} detail="Matériel en ligne + kiosk Chargeurs authentifié + batterie rentable." tone="text-success" />
          <MetricCard icon={Wifi} label="Matériel fournisseur" value={`${metrics.providerOnline}/${metrics.stations}`} detail="État physique remonté par la synchronisation fournisseur." />
          <MetricCard icon={ShieldAlert} label="Kiosks authentifiés" value={`${metrics.kioskAuthenticated}/${metrics.stations}`} detail="Le rail Chargeurs peut appeler les APIs protégées de location." tone={metrics.kioskAuthenticated === metrics.stations ? "text-success" : "text-warning"} />
          <MetricCard icon={BatteryCharging} label="Batteries rentables" value={String(metrics.batteries)} detail="Stock actuellement éligible à une nouvelle location." tone="text-secondary" />
          <MetricCard icon={Activity} label="Locations aujourd’hui" value={String(metrics.rentalsToday)} detail={`${metrics.activeRentals} location(s) encore active(s) actuellement.`} tone="text-accent" />
          <MetricCard icon={CreditCard} label="Paiements aujourd’hui" value={String(metrics.paymentsToday)} detail="Transactions enregistrées aujourd’hui dans Chargeurs." />
          <MetricCard icon={CircleDollarSign} label="Encaissé aujourd’hui" value={money(metrics.revenueTodayCents)} detail="Captures moins remboursements enregistrés dans le ledger paiement." tone="text-success" />
          <MetricCard icon={Megaphone} label="Publicité · 30 jours" value={`${metrics.adHours30d.toFixed(1)} h`} detail={`${metrics.adImpressions30d} impression(s) publicitaires enregistrées.`} tone="text-primary" />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="glass liquid-border rounded-2xl p-5 sm:p-6">
            <div className="mb-5"><h2 className="font-display text-xl font-bold">Activité réseau · 7 jours</h2><p className="mt-1 text-sm text-muted-foreground">Locations créées et paiements enregistrés, sans données de démonstration.</p></div>
            <ActivityChart rows={trendData} />
          </div>
          <div className="glass liquid-border rounded-2xl p-5 sm:p-6">
            <div><h2 className="font-display text-xl font-bold">Revenu encaissé · 7 jours</h2><p className="mt-1 text-sm text-muted-foreground">Montants capturés moins remboursements, en CHF.</p></div>
            <RevenueChart rows={trendData} />
          </div>
        </section>

        {secondaryAlerts.length > 0 && <section className="glass rounded-2xl p-5 sm:p-6"><h2 className="font-display text-xl font-bold">À surveiller</h2><div className="mt-4 grid gap-3 xl:grid-cols-2">{secondaryAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}</div></section>}

        <section className="glass liquid-border rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Santé des bornes</h2><p className="mt-1 text-sm text-muted-foreground">Sépare volontairement l’état matériel fournisseur de l’état du service de location Chargeurs.</p></div><Link to="/admin/stations"><Button variant="ghost" className="gap-1">Toutes les bornes <ChevronRight className="h-4 w-4" /></Button></Link></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {data.fleet.map((row) => (
              <Link key={row.stationId} to={`/admin/stations/${encodeURIComponent(row.stationId)}`} className="group rounded-2xl border border-border/70 bg-background/35 p-4 transition hover:border-primary/40 hover:bg-muted/20">
                <div className="flex items-start justify-between gap-3"><div><div className="font-mono text-xs text-muted-foreground">{row.stationId}</div><div className="mt-1 font-bold">{row.name}</div>{row.locationName && <div className="mt-1 text-xs text-muted-foreground">{row.locationName}</div>}</div><FleetState row={row} /></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-muted/30 p-2"><div className="font-bold">{row.providerOnline ? "OK" : "HS"}</div><div className="text-muted-foreground">matériel</div></div><div className="rounded-xl bg-muted/30 p-2"><div className="font-bold">{row.kioskAuthenticated ? "OK" : "HS"}</div><div className="text-muted-foreground">kiosk</div></div><div className="rounded-xl bg-muted/30 p-2"><div className="font-bold">{row.rentableCount}/{row.totalCount}</div><div className="text-muted-foreground">rentables</div></div></div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>Fournisseur {relative(row.lastProviderSuccessAt ?? row.lastSyncAt)}</span><span>Kiosk {relative(row.lastKioskSeenAt)}</span></div>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Appareils kiosk", "/admin/kiosk-devices", ShieldAlert],
            ["Locations", "/admin/rentals", Activity],
            ["Paiements", "/admin/payments", CreditCard],
            ["Publicités", "/admin/advertising", Megaphone],
            ["Tarification", "/admin/pricing", CircleDollarSign],
          ].map(([label, href, Icon]) => {
            const QuickIcon = Icon as LucideIcon;
            return <Link key={String(label)} to={String(href)} className="glass group flex items-center justify-between rounded-2xl p-4 transition hover:border-primary/35"><div className="flex items-center gap-3"><QuickIcon className="h-5 w-5 text-primary" /><b className="text-sm">{String(label)}</b></div><ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" /></Link>;
          })}
        </section>
      </>}
    </div>
  );
}
