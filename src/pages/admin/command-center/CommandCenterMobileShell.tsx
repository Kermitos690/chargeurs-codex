import { useMemo, useState } from "react";
import { Home, MapPin, MoreHorizontal, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { DevelopmentPanel, DecisionsPanel, HealthPanel, MorePanel, StationsPanel } from "./CommandCenterBlocks";
import type { CommandCenterHomeModel } from "./model";

type MobileTab = "home" | "stations" | "development" | "decisions" | "more";

type Props = {
  model: CommandCenterHomeModel;
  roles: string[];
  generatedAt: string;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function relative(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "à l’instant";
  if (ms < 3_600_000) return `il y a ${Math.floor(ms / 60_000)} min`;
  return `il y a ${Math.floor(ms / 3_600_000)} h`;
}

export function CommandCenterMobileShell({ model, roles, generatedAt, loading, error, onRefresh }: Props) {
  const [tab, setTab] = useState<MobileTab>("home");
  const nav = useMemo(() => [
    { id: "home" as const, label: "Accueil", icon: Home },
    { id: "stations" as const, label: "Bornes", icon: MapPin },
    { id: "development" as const, label: "Développement", icon: Workflow },
    { id: "decisions" as const, label: "Décisions", icon: ShieldCheck },
    { id: "more" as const, label: "Plus", icon: MoreHorizontal },
  ], []);

  return (
    <div className="relative min-h-[100dvh] bg-background/90 pb-28">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <BrandLogo size="sm" />
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground min-[390px]:inline">{relative(generatedAt)}</span>
            <Button variant="ghost" size="icon" aria-label="Actualiser le Product Command Center" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {error && <div role="alert" className="rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        {tab === "home" && <>
          <div><p className="text-xs font-black uppercase tracking-[.16em] text-primary">Product Command Center</p><h1 className="mt-1 font-display text-2xl font-bold">Décider quoi faire maintenant</h1><p className="mt-1 text-sm text-muted-foreground">Constater → décider → agir. Les détails restent au second niveau.</p></div>
          <HealthPanel health={model.health} roles={roles} compact />
          <StationsPanel stations={model.stations} roles={roles} compact />
          <DecisionsPanel decisions={model.decisions} roles={roles} compact />
          <DevelopmentPanel development={model.development} roles={roles} />
        </>}

        {tab === "stations" && <><div><h1 className="font-display text-2xl font-bold">Bornes</h1><p className="mt-1 text-sm text-muted-foreground">État réellement remonté par le réseau.</p></div><StationsPanel stations={model.stations} roles={roles} /></>}
        {tab === "development" && <><div><h1 className="font-display text-2xl font-bold">Développement</h1><p className="mt-1 text-sm text-muted-foreground">Le prochain chantier autorisé, sans fragiliser P0.</p></div><DevelopmentPanel development={model.development} roles={roles} /></>}
        {tab === "decisions" && <><div><h1 className="font-display text-2xl font-bold">Décisions</h1><p className="mt-1 text-sm text-muted-foreground">Maximum trois sujets opérationnels prioritaires.</p></div><DecisionsPanel decisions={model.decisions} roles={roles} /></>}
        {tab === "more" && <><div><h1 className="font-display text-2xl font-bold">Plus</h1><p className="mt-1 text-sm text-muted-foreground">Accéder aux analyses et outils spécialisés.</p></div><MorePanel roles={roles} /></>}
      </main>

      <nav aria-label="Navigation Product Command Center" className="fixed inset-x-0 bottom-0 z-40 border-t border-border/75 bg-background/95 px-2 pb-[max(.55rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <div className="mx-auto grid max-w-2xl grid-cols-5 gap-1">
          {nav.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button key={id} type="button" aria-current={active ? "page" : undefined} onClick={() => setTab(id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-bold transition ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"}`}>
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
