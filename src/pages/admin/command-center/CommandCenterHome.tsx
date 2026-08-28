import { Loader2, RefreshCw } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AdminOutletContext } from "../AdminLayout";
import { buildCommandCenterHomeModel } from "./model";
import { CommandCenterLargeShell } from "./CommandCenterLargeShell";
import { CommandCenterMobileShell } from "./CommandCenterMobileShell";
import { useCommandCenterMode } from "./useCommandCenterMode";
import { useCommandCenterOverview } from "./useCommandCenterOverview";

export function CommandCenterHome() {
  const mode = useCommandCenterMode();
  const { roles } = useOutletContext<AdminOutletContext>();
  const { data, loading, error, refresh } = useCommandCenterOverview();

  if (!data) {
    return (
      <div className="grid min-h-[70dvh] place-items-center px-5">
        <div className="glass-strong w-full max-w-lg rounded-3xl border border-border/70 p-7 text-center">
          {loading ? (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <h1 className="mt-4 font-display text-xl font-bold">Chargement du Product Command Center</h1>
              <p className="mt-2 text-sm text-muted-foreground">Lecture des données opérationnelles réelles…</p>
            </>
          ) : (
            <>
              <h1 className="font-display text-xl font-bold">Données indisponibles</h1>
              <p className="mt-2 text-sm text-muted-foreground">{error ?? "NOT_AVAILABLE"}</p>
              <Button variant="outline" className="mt-5 gap-2" onClick={() => void refresh(false)}><RefreshCw className="h-4 w-4" /> Réessayer</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const model = buildCommandCenterHomeModel(data);
  const common = {
    model,
    roles,
    generatedAt: data.generatedAt,
    loading,
    error,
    onRefresh: () => void refresh(false),
  };

  return mode === "mobile" ? <CommandCenterMobileShell {...common} /> : <CommandCenterLargeShell {...common} />;
}
