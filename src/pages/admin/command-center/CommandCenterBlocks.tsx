import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Code2,
  Gauge,
  RadioTower,
  Server,
  ShieldAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CommandCenterDecision, CommandCenterDevelopment, CommandCenterHealth } from "./model";
import type { FleetRow } from "./types";

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`glass liquid-border rounded-3xl border border-border/60 ${className}`}>{children}</section>;
}

function ActionPill({ action }: { action: CommandCenterDevelopment["action"] }) {
  const tone = action === "FIX"
    ? "border-destructive/35 bg-destructive/10 text-destructive"
    : action === "VALIDATE"
      ? "border-warning/35 bg-warning/10 text-warning"
      : "border-primary/35 bg-primary/10 text-primary";
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black tracking-wide ${tone}`}>{action}</span>;
}

export function HealthPanel({ health, compact = false }: { health: CommandCenterHealth; compact?: boolean }) {
  const score = Math.max(0, Math.min(100, health.score));
  const tone = health.tone === "critical" ? "text-destructive" : health.tone === "warning" ? "text-warning" : "text-success";
  const border = health.tone === "critical" ? "border-destructive/25" : health.tone === "warning" ? "border-warning/25" : "border-success/25";

  return (
    <Panel className={`overflow-hidden ${border}`}>
      <div className={compact ? "p-5" : "p-6"}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">Santé opérationnelle</p>
            <h2 className={`mt-2 font-display text-xl font-bold ${tone}`}>{health.label}</h2>
          </div>
          <Gauge className={`h-6 w-6 ${tone}`} />
        </div>

        <div className="mt-5 flex items-center gap-5">
          <div
            className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(hsl(var(--primary)) ${score * 3.6}deg, hsl(var(--muted)) 0deg)` }}
          >
            <div className="grid h-[4.75rem] w-[4.75rem] place-items-center rounded-full bg-background shadow-inner">
              <div className="text-center"><div className="text-2xl font-black">{score}</div><div className="text-[10px] text-muted-foreground">/100</div></div>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="text-2xl font-black">{health.rentalReady}/{health.stations}</div>
              <div className="text-xs text-muted-foreground">bornes prêtes à servir une location</div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {health.criticalAlerts > 0
                ? <><ShieldAlert className="h-4 w-4 text-destructive" /><span><b>{health.criticalAlerts}</b> alerte(s) critique(s)</span></>
                : <><CheckCircle2 className="h-4 w-4 text-success" /><span>Aucune alerte critique remontée</span></>}
            </div>
          </div>
        </div>
      </div>
      <Link to="/admin/network-overview" className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-sm font-semibold text-primary transition hover:bg-muted/25">
        Analyse réseau détaillée <ChevronRight className="h-4 w-4" />
      </Link>
    </Panel>
  );
}

function StationState({ row }: { row: FleetRow }) {
  if (row.rentalReady) return <span className="inline-flex items-center gap-1 text-xs font-bold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Prête</span>;
  if (!row.providerOnline) return <span className="inline-flex items-center gap-1 text-xs font-bold text-destructive"><ShieldAlert className="h-3.5 w-3.5" /> Matériel hors ligne</span>;
  if (!row.kioskAuthenticated) return <span className="inline-flex items-center gap-1 text-xs font-bold text-warning"><ShieldAlert className="h-3.5 w-3.5" /> Kiosk non prêt</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-bold text-warning"><BatteryCharging className="h-3.5 w-3.5" /> Stock à vérifier</span>;
}

export function StationsPanel({ stations, compact = false }: { stations: FleetRow[]; compact?: boolean }) {
  const visible = compact ? stations.slice(0, 2) : stations;
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div><p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">Bornes</p><h2 className="mt-1 font-display text-xl font-bold">État terrain</h2></div>
        <Server className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 grid gap-3 px-5 pb-5 sm:grid-cols-2">
        {visible.map((row) => (
          <Link key={row.stationId} to={`/admin/stations/${encodeURIComponent(row.stationId)}`} className="rounded-2xl border border-border/70 bg-background/40 p-4 transition hover:border-primary/40 hover:bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="font-mono text-xs text-muted-foreground">{row.stationId}</div><div className="mt-1 truncate font-bold">{row.name}</div></div>
              <StationState row={row} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-muted/30 p-2"><div className="font-bold">{row.rentableCount}/{row.totalCount}</div><div className="text-[10px] text-muted-foreground">rentables</div></div>
              <div className="rounded-xl bg-muted/30 p-2"><div className="font-bold">{row.providerOnline ? "OK" : "HS"}</div><div className="text-[10px] text-muted-foreground">matériel</div></div>
              <div className="rounded-xl bg-muted/30 p-2"><div className="font-bold">{row.kioskAuthenticated ? "OK" : "HS"}</div><div className="text-[10px] text-muted-foreground">kiosk</div></div>
            </div>
          </Link>
        ))}
        {!visible.length && <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:col-span-2">Aucune borne n’est remontée par la source opérationnelle.</div>}
      </div>
      <Link to="/admin/stations" className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-sm font-semibold text-primary transition hover:bg-muted/25">
        Toutes les bornes <ChevronRight className="h-4 w-4" />
      </Link>
    </Panel>
  );
}

export function DecisionsPanel({ decisions, compact = false }: { decisions: CommandCenterDecision[]; compact?: boolean }) {
  const visible = compact ? decisions.slice(0, 2) : decisions;
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div><p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">Décisions</p><h2 className="mt-1 font-display text-xl font-bold">À traiter maintenant</h2></div>
        <ClipboardCheck className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 space-y-3 px-5 pb-5">
        {visible.map((decision) => (
          <Link key={decision.id} to={decision.href} className={`block rounded-2xl border p-4 transition hover:bg-muted/20 ${decision.severity === "critical" ? "border-destructive/30 bg-destructive/[.05]" : "border-warning/25 bg-warning/[.04]"}`}>
            <div className="flex items-start gap-3">
              {decision.severity === "critical" ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />}
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{decision.title}</b><ActionPill action={decision.action} /></div><p className="mt-1 text-sm text-muted-foreground">{decision.recommendation}</p></div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          </Link>
        ))}
        {!visible.length && <div className="flex items-center gap-3 rounded-2xl border border-success/20 bg-success/[.05] p-4"><CheckCircle2 className="h-5 w-5 text-success" /><p className="text-sm">Aucune alerte opérationnelle demandant une décision immédiate n’est remontée.</p></div>}
      </div>
    </Panel>
  );
}

export function DevelopmentPanel({ development }: { development: CommandCenterDevelopment }) {
  const sourceLabel = development.source === "LIVE_ALERT" ? "État réel" : development.source === "OPERATIONS" ? "Exploitation" : "Gouvernance P0";
  return (
    <Panel className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">Développement</p><h2 className="mt-1 font-display text-xl font-bold">Prochain chantier autorisé</h2></div>
          <Code2 className="h-5 w-5 text-primary" />
        </div>
        <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/[.05] p-4">
          <div className="flex flex-wrap items-center gap-2"><ActionPill action={development.action} /><span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-bold">{development.lane}</span><span className="text-[11px] font-semibold text-muted-foreground">{sourceLabel}</span></div>
          <h3 className="mt-3 text-lg font-bold leading-snug">{development.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{development.reason}</p>
        </div>
      </div>
      <Link to={development.href} className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-sm font-semibold text-primary transition hover:bg-muted/25">
        Ouvrir le chantier <ChevronRight className="h-4 w-4" />
      </Link>
    </Panel>
  );
}

const moreLinks: Array<{ label: string; detail: string; href: string; icon: LucideIcon }> = [
  { label: "Vue réseau détaillée", detail: "Métriques, tendances et alertes complètes", href: "/admin/network-overview", icon: RadioTower },
  { label: "Santé du parcours", detail: "Paiement → éjection → retour → règlement", href: "/admin/rental-flow-health", icon: Gauge },
  { label: "Preuves & tests", detail: "Validation terrain et contrôle de test", href: "/admin/test-monitor", icon: ClipboardCheck },
  { label: "Maintenance", detail: "Actions opérateur et incidents", href: "/admin/maintenance", icon: Wrench },
];

export function MorePanel() {
  return (
    <Panel>
      <div className="px-5 pt-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">Plus</p><h2 className="mt-1 font-display text-xl font-bold">Analyse & exploitation</h2></div>
      <div className="mt-4 grid gap-3 px-5 pb-5 sm:grid-cols-2">
        {moreLinks.map(({ label, detail, href, icon: Icon }) => (
          <Link key={href} to={href} className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 p-4 transition hover:border-primary/35 hover:bg-muted/20">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10"><Icon className="h-5 w-5 text-primary" /></div>
            <div className="min-w-0 flex-1"><div className="font-bold">{label}</div><div className="mt-0.5 text-xs text-muted-foreground">{detail}</div></div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </Panel>
  );
}
