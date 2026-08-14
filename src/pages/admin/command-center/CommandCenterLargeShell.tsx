import { RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { DevelopmentPanel, DecisionsPanel, HealthPanel, MorePanel, StationsPanel } from "./CommandCenterBlocks";
import type { CommandCenterHomeModel } from "./model";

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
  if (ms < 86_400_000) return `il y a ${Math.floor(ms / 3_600_000)} h`;
  return `il y a ${Math.floor(ms / 86_400_000)} j`;
}

export function CommandCenterLargeShell({ model, roles, generatedAt, loading, error, onRefresh }: Props) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-4">
          <BrandLogo size="sm" className="lg:hidden" />
          <div>
            <div className="text-xs font-black uppercase tracking-[.18em] text-primary">Chargeurs.ch · Product Command Center</div>
            <h1 className="mt-1 font-display text-3xl font-bold">Constater. Décider. Agir.</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Vue exécutive volontairement limitée aux quatre questions qui pilotent le développement : santé, bornes, décisions et prochain chantier autorisé.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Mis à jour {relative(generatedAt)}</span>
          <Button variant="outline" className="gap-2" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualiser
          </Button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="grid gap-5 sm:grid-cols-12">
        <div className="sm:col-span-5"><HealthPanel health={model.health} roles={roles} /></div>
        <div className="sm:col-span-7"><DevelopmentPanel development={model.development} roles={roles} /></div>
        <div className="sm:col-span-7"><StationsPanel stations={model.stations} roles={roles} compact /></div>
        <div className="sm:col-span-5"><DecisionsPanel decisions={model.decisions} roles={roles} /></div>
      </div>

      <MorePanel roles={roles} />
    </div>
  );
}
