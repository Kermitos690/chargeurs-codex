import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCustomer } from "@/hooks/useCustomer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoltAssistant } from "@/components/support/VoltAssistant";
import {
  ACTIVE_RENTAL_STATES,
  CustomerIncident,
  PrivateAccountSummary,
  fetchPrivateAccountSummary,
  formatAccountDate,
  rentalStateLabel,
} from "./accountData";

export default function AccountSupport() {
  const { user } = useCustomer();
  const [searchParams] = useSearchParams();
  const [summary, setSummary] = useState<PrivateAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSummaryError(false);
    try {
      setSummary(await fetchPrivateAccountSummary());
    } catch {
      setSummaryError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeRental = useMemo(
    () => summary?.rentals.find((rental) => ACTIVE_RENTAL_STATES.has(rental.state)) ?? summary?.rentals[0] ?? null,
    [summary],
  );
  const stationId = searchParams.get("station")?.trim().toUpperCase() || activeRental?.station_id || "";
  const rentalId = searchParams.get("rental")?.trim() || activeRental?.id || "";
  const profileName = String(summary?.profile?.display_name ?? user?.user_metadata?.display_name ?? "Client Chargeurs.ch");
  const contextHint = activeRental
    ? `location=${activeRental.id}; station=${activeRental.station_id}; état=${activeRental.state}`
    : "aucune location récente disponible dans le résumé du compte";
  const incidents: CustomerIncident[] = summary?.incidents ?? [];

  return (
    <div className="space-y-7 pt-3">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2"><h1 className="font-display text-3xl font-extrabold">Volt</h1><Badge variant="outline">Assistant client</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">Assistance Chargeurs.ch avec contexte limité à votre propre compte.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser le contexte</Button>
      </header>

      <section className="glass rounded-2xl p-5">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" /><div><h2 className="font-semibold">Contexte sécurisé du compte</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Le navigateur ne fournit aucun identifiant utilisateur à Volt. Le résumé privé est obtenu via la session authentifiée, puis seules les informations utiles à l'assistance sont présentées ici.</p></div></div>
        {loading && <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Chargement du contexte…</div>}
        {!loading && summaryError && <p role="alert" className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Le contexte du compte n'est pas disponible. Volt reste utilisable, mais aucune donnée de location ne sera ajoutée au dossier.</p>}
        {!loading && !summaryError && activeRental && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-3 py-1.5 font-semibold text-primary">Borne {activeRental.station_id}</span>
            <span className="rounded-full bg-muted px-3 py-1.5 text-muted-foreground">{rentalStateLabel(activeRental.state)}</span>
            <span className="rounded-full bg-muted px-3 py-1.5 font-mono text-muted-foreground">{activeRental.id.slice(0, 8)}</span>
          </div>
        )}
      </section>

      <VoltAssistant
        mode="client"
        userName={profileName}
        userEmail={user?.email ?? ""}
        stationId={stationId}
        rentalId={rentalId}
        contextHint={summaryError ? "contexte compte indisponible" : contextHint}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Incidents liés à vos locations</h2><p className="text-sm text-muted-foreground">Seuls les incidents retournés par votre résumé de compte sont affichés.</p></div></div>
        {loading && <div className="glass grid min-h-28 place-items-center rounded-2xl"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {!loading && !summaryError && incidents.length === 0 && <p className="glass rounded-2xl p-5 text-sm text-muted-foreground">Aucun incident n'est associé à vos locations.</p>}
        {!loading && !summaryError && incidents.map((incident) => (
          <article key={incident.id} className="glass rounded-2xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex items-center gap-2"><AlertTriangle className={`h-5 w-5 ${incident.resolved ? "text-success" : "text-warning"}`} /><h3 className="font-semibold">{incident.type.replace(/_/g, " ")}</h3></div><p className="mt-2 text-xs text-muted-foreground">{formatAccountDate(incident.created_at)}</p></div>
              <Badge variant={incident.resolved ? "secondary" : "outline"}>{incident.resolved ? "Résolu" : "En cours"}</Badge>
            </div>
          </article>
        ))}
      </section>

      <Link to="/compte/locations" className="inline-flex text-sm font-semibold text-primary">Consulter mes locations</Link>
    </div>
  );
}
