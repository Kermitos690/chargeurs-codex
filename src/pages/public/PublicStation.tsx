import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BatteryCharging,
  Clock3,
  ExternalLink,
  HelpCircle,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  RotateCcw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { PublicNav } from "@/components/public/PublicNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatChf, PUBLIC_PRICING } from "@/lib/publicPricing";
import { PUBLIC_STATION_FIELDS, stationDirectionsUrl } from "./publicStationData";

type PublicStationRecord = {
  station_id: string;
  name: string;
  location_name: string | null;
  status: string | null;
  online: boolean | null;
  rentable_count: number | null;
  returnable_count: number | null;
  total_count: number | null;
  currency: string | null;
  price_per_period: number | null;
  last_sync_at: string | null;
};

type PageState =
  | { status: "loading" }
  | { status: "ready"; station: PublicStationRecord }
  | { status: "not-found" }
  | { status: "error" };

function AvailabilityCard({ icon: Icon, label, value, help }: {
  icon: typeof BatteryCharging;
  label: string;
  value: number;
  help: string;
}) {
  return (
    <article className="glass rounded-2xl p-5">
      <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
      <p className="mt-4 text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-extrabold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </article>
  );
}

export default function PublicStation() {
  const { stationId = "" } = useParams();
  const [page, setPage] = useState<PageState>({ status: "loading" });
  const normalizedStationId = stationId.trim().toUpperCase();

  const loadStation = useCallback(async () => {
    if (!/^[A-Z0-9_-]{4,32}$/.test(normalizedStationId)) {
      setPage({ status: "not-found" });
      return;
    }
    setPage({ status: "loading" });
    const { data, error } = await supabase
      .from("stations")
      .select(PUBLIC_STATION_FIELDS)
      .eq("station_id", normalizedStationId)
      .maybeSingle();

    if (error) {
      setPage({ status: "error" });
      return;
    }
    if (!data) {
      setPage({ status: "not-found" });
      return;
    }
    setPage({ status: "ready", station: data as unknown as PublicStationRecord });
  }, [normalizedStationId]);

  useEffect(() => {
    void loadStation();
  }, [loadStation]);

  const directionsUrl = useMemo(
    () => page.status === "ready"
      ? stationDirectionsUrl(page.station.location_name, page.station.station_id)
      : "#",
    [page],
  );

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />
      <PublicNav />
      <main className="mx-auto w-full max-w-5xl px-5 pb-20 pt-28 sm:px-10 sm:pt-32">
        <Link to="/?section=bornes" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Toutes les bornes
        </Link>

        {page.status === "loading" && (
          <section className="glass-strong mt-6 grid min-h-80 place-items-center rounded-3xl p-8" aria-live="polite">
            <div className="text-center">
              <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
              <p className="mt-4 font-semibold">Chargement de la borne…</p>
              <p className="mt-1 text-sm text-muted-foreground">Nous récupérons sa disponibilité publiée.</p>
            </div>
          </section>
        )}

        {page.status === "error" && (
          <section className="glass-strong liquid-border mt-6 rounded-3xl p-8 text-center" role="alert">
            <WifiOff className="mx-auto h-10 w-10 text-warning" />
            <h1 className="mt-4 font-display text-3xl font-bold">Disponibilité momentanément inaccessible</h1>
            <p className="mx-auto mt-2 max-w-xl text-muted-foreground">Aucune donnée de démonstration n'est affichée. Réessayez ou contactez le support avec l'identifiant {normalizedStationId}.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={() => void loadStation()} className="rounded-full bg-gradient-primary"><RefreshCw className="mr-2 h-4 w-4" />Réessayer</Button>
              <Button asChild variant="outline" className="rounded-full"><Link to={`/support?station=${encodeURIComponent(normalizedStationId)}`}><HelpCircle className="mr-2 h-4 w-4" />Support</Link></Button>
            </div>
          </section>
        )}

        {page.status === "not-found" && (
          <section className="glass-strong liquid-border mt-6 rounded-3xl p-8 text-center">
            <MapPin className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-4 font-display text-3xl font-bold">Borne introuvable</h1>
            <p className="mt-2 text-muted-foreground">Cette borne n'est pas publiée ou son identifiant est incorrect.</p>
            <Button asChild className="mt-6 rounded-full bg-gradient-primary"><Link to="/?section=bornes">Voir les bornes disponibles</Link></Button>
          </section>
        )}

        {page.status === "ready" && (() => {
          const { station } = page;
          const isAvailable = Boolean(station.online && (station.rentable_count ?? 0) > 0);
          const price = station.price_per_period ?? PUBLIC_PRICING.incrementPrice;
          return (
            <>
              <section className="glass-strong liquid-border mt-6 overflow-hidden rounded-3xl p-6 sm:p-10">
                <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge className={isAvailable ? "bg-success/15 text-success hover:bg-success/15" : "bg-warning/15 text-warning hover:bg-warning/15"}>
                        {station.online ? <Wifi className="mr-1 h-3.5 w-3.5" /> : <WifiOff className="mr-1 h-3.5 w-3.5" />}
                        {isAvailable ? "Batteries disponibles" : station.online ? "Aucune batterie disponible" : "Borne hors ligne"}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{station.station_id}</span>
                    </div>
                    <h1 className="mt-5 font-display text-4xl font-extrabold sm:text-6xl">{station.name}</h1>
                    <p className="mt-4 flex items-start gap-2 text-lg text-muted-foreground">
                      <MapPin className="mt-1 h-5 w-5 shrink-0 text-primary" />
                      <span>{station.location_name || "Adresse en cours de publication"}</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-primary/20 bg-primary/10 p-5 sm:min-w-52">
                    <p className="text-sm text-muted-foreground">{station.price_per_period == null ? "Tarif standard" : "Tarif publié"}</p>
                    <p className="mt-1 text-3xl font-extrabold text-gradient">{formatChf(Number(price))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">par tranche de {PUBLIC_PRICING.incrementMinutes} minutes</p>
                  </div>
                </div>

                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  <AvailabilityCard icon={BatteryCharging} label="À louer maintenant" value={station.rentable_count ?? 0} help="Batteries signalées disponibles" />
                  <AvailabilityCard icon={RotateCcw} label="Places de retour" value={station.returnable_count ?? 0} help="Emplacements libres signalés" />
                  <AvailabilityCard icon={Clock3} label="Capacité totale" value={station.total_count ?? 0} help="Slots de cette borne" />
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild className="h-auto flex-1 rounded-2xl bg-gradient-primary px-6 py-4 font-bold shadow-glow">
                    <a href={directionsUrl} target="_blank" rel="noreferrer"><Navigation className="mr-2 h-5 w-5" />Itinéraire<ExternalLink className="ml-2 h-4 w-4" /></a>
                  </Button>
                  <Button asChild variant="outline" className="h-auto flex-1 rounded-2xl px-6 py-4">
                    <Link to={`/support?station=${encodeURIComponent(station.station_id)}`}><HelpCircle className="mr-2 h-5 w-5" />Besoin d'aide</Link>
                  </Button>
                </div>
              </section>

              <section className="mt-6 rounded-2xl border border-border bg-card/60 p-5 text-sm text-muted-foreground">
                <p>La disponibilité est indicative et peut changer entre votre consultation et votre arrivée.</p>
                {station.last_sync_at && <p className="mt-1">Dernière mise à jour : {new Date(station.last_sync_at).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" })}</p>}
              </section>
            </>
          );
        })()}
      </main>
    </div>
  );
}
