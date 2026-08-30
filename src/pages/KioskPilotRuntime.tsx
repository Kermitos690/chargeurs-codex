import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, BatteryCharging, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Wifi, WifiOff, Zap } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n/i18n";
import { readKioskToken } from "@/lib/kioskFetch";

type Station = {
  station_id: string;
  name: string;
  location_name: string | null;
  status: string | null;
  online: boolean;
  rentable_count: number;
  returnable_count: number;
  total_count: number;
  currency: string;
  last_sync_at: string | null;
};

type PricingTier = { upper_minutes: number; total_cents: number };
type Quote = {
  currency: string;
  profile_name: string;
  deposit_cents: number;
  total_cap_cents: number;
  unreturned_after_minutes: number;
  tiered: boolean;
  tiers: PricingTier[];
};

type Slot = {
  slot_num: number;
  charge_percent: number | null;
  rentable: boolean;
  confidence: "high" | "medium" | "low";
  status: "ready" | "recommended" | "charging" | "checking" | "unavailable" | "return_available" | "technical_issue" | "maintenance";
  recommended: boolean;
};

type PilotState = {
  station: Station | null;
  quote: Quote | null;
  slots: Slot[];
};

const API_BASE = String(import.meta.env.VITE_KIOSK_API_BASE_URL || "").replace(/\/$/, "");
const TRANSACTIONS_ENABLED = import.meta.env.VITE_KIOSK_PILOT_TRANSACTIONS === "true";

function money(cents: number, currency: string) {
  return `${(Number(cents) / 100).toFixed(2)} ${currency}`;
}

function duration(minutes: number, lang: string) {
  if (minutes === 30) return "30 min";
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

async function postPilot<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
  if (!API_BASE) throw new Error("PILOT_API_NOT_CONFIGURED");
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Kiosk-Token": token,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error || `HTTP_${response.status}`);
  return data;
}

export default function KioskPilotRuntime() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const [state, setState] = useState<PilotState>({ station: null, quote: null, slots: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionMessage, setTransactionMessage] = useState<string | null>(null);

  const copy = {
    fr: {
      kicker: "LOCATION EXPRESS · SANS COMPTE",
      title: "Votre batterie est prête.",
      subtitle: "Choisissez, payez sur votre téléphone et prenez la batterie qui s’allume.",
      availability: "Batteries disponibles",
      pricing: "Tarif Express",
      guarantee: "Garantie",
      guaranteeNote: "Séparée du prix de location. Régularisée selon le retour.",
      returnNote: "Retour dans une borne Chargeurs.ch",
      continue: "CONTINUER ET PAYER",
      testLocked: "Le paiement TEST sera activé après validation du serveur local.",
      refresh: "Actualiser",
      online: "Borne connectée",
      offline: "Connexion à vérifier",
      noBattery: "Aucune batterie louable pour le moment",
      config: "Configuration pilote incomplète",
      retry: "Réessayer",
    },
    en: {
      kicker: "EXPRESS RENTAL · NO ACCOUNT",
      title: "Your powerbank is ready.",
      subtitle: "Choose, pay on your phone and take the powerbank that lights up.",
      availability: "Powerbanks available",
      pricing: "Express price",
      guarantee: "Guarantee",
      guaranteeNote: "Separate from the rental price. Adjusted after return.",
      returnNote: "Return at a Chargeurs.ch station",
      continue: "CONTINUE TO PAYMENT",
      testLocked: "TEST payment will be enabled after local-server validation.",
      refresh: "Refresh",
      online: "Station connected",
      offline: "Connection needs checking",
      noBattery: "No rentable powerbank right now",
      config: "Pilot configuration incomplete",
      retry: "Try again",
    },
    de: {
      kicker: "EXPRESS-MIETE · OHNE KONTO",
      title: "Ihre Powerbank ist bereit.",
      subtitle: "Auswählen, auf dem Smartphone bezahlen und die beleuchtete Powerbank nehmen.",
      availability: "Verfügbare Powerbanks",
      pricing: "Express-Tarif",
      guarantee: "Garantie",
      guaranteeNote: "Getrennt vom Mietpreis. Nach der Rückgabe angepasst.",
      returnNote: "Rückgabe an einer Chargeurs.ch Station",
      continue: "WEITER ZUR ZAHLUNG",
      testLocked: "Die TEST-Zahlung wird nach der lokalen Serverprüfung aktiviert.",
      refresh: "Aktualisieren",
      online: "Station verbunden",
      offline: "Verbindung prüfen",
      noBattery: "Derzeit keine Powerbank verfügbar",
      config: "Pilot-Konfiguration unvollständig",
      retry: "Erneut versuchen",
    },
  }[lang];

  const load = useCallback(async () => {
    const token = readKioskToken();
    if (!stationId || !token) throw new Error("KIOSK_AUTH_REQUIRED");
    const [stationResponse, quoteResponse, snapshotResponse] = await Promise.all([
      postPilot<{ ok: true; station: Station }>("/api/kiosk/station", { stationId }, token),
      postPilot<{ ok: true; quote: Quote }>("/api/kiosk/quote", { stationId }, token),
      postPilot<{ ok: true; online: boolean | null; slots: Slot[] }>("/api/kiosk/cabinet-snapshot", { stationId }, token),
    ]);
    setState({
      station: { ...stationResponse.station, online: snapshotResponse.online ?? stationResponse.station.online },
      quote: quoteResponse.quote,
      slots: snapshotResponse.slots,
    });
    setError(null);
  }, [stationId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "PILOT_LOAD_FAILED");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "PILOT_LOAD_FAILED"); }
    finally { setRefreshing(false); }
  };

  const rentable = useMemo(() => state.slots.filter((slot) => slot.rentable), [state.slots]);
  const recommended = rentable.find((slot) => slot.recommended) || rentable[0] || null;
  const currency = state.quote?.currency || state.station?.currency || "CHF";

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4"><Loader2 className="h-12 w-12 animate-spin text-primary" /><BrandLogo size="md" /></div>
      </main>
    );
  }

  if (error || !state.station || !state.quote) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <section className="w-full max-w-xl rounded-[2rem] border border-border bg-card p-8 text-center shadow-2xl">
          <AlertTriangle className="mx-auto h-12 w-12 text-warning" />
          <h1 className="mt-5 text-3xl font-black">{copy.config}</h1>
          <p className="mt-3 font-mono text-sm text-muted-foreground">{error || "PILOT_DATA_MISSING"}</p>
          <button type="button" onClick={() => void refresh()} className="mt-7 rounded-full bg-primary px-8 py-4 font-black text-primary-foreground">{copy.retry}</button>
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-6 py-6 text-foreground sm:px-10">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <BrandLogo size="md" />
          <div className="flex items-center gap-3">
            <div className={`hidden items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold sm:flex ${state.station.online ? "border-primary/30 bg-primary/10" : "border-warning/40 bg-warning/10"}`}>
              {state.station.online ? <Wifi className="h-4 w-4 text-primary" /> : <WifiOff className="h-4 w-4 text-warning" />}
              {state.station.online ? copy.online : copy.offline}
            </div>
            <button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-full border border-border bg-background/80 p-3" aria-label={copy.refresh}>
              <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <LanguageSwitcher />
          </div>
        </header>

        <section className="grid flex-1 items-center gap-7 py-7 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-black tracking-[0.13em] text-primary">
              <Zap className="h-4 w-4" /> {copy.kicker}
            </div>
            <h1 className="mt-5 max-w-2xl font-display text-4xl font-black tracking-tight sm:text-6xl">{copy.title}</h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground sm:text-xl">{copy.subtitle}</p>

            <div className="mt-7 rounded-[1.75rem] border border-border bg-card/85 p-5 shadow-lg backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">{copy.availability}</p>
                  <p className="mt-1 text-3xl font-black">{rentable.length} / {state.station.total_count}</p>
                </div>
                {recommended ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-primary/10 px-4 py-3">
                    <BatteryCharging className="h-7 w-7 text-primary" />
                    <div className="text-left"><p className="text-xs font-bold text-muted-foreground">Slot {recommended.slot_num}</p><p className="text-lg font-black">{recommended.charge_percent ?? "—"}%</p></div>
                  </div>
                ) : <p className="max-w-[16rem] text-right font-semibold text-warning">{copy.noBattery}</p>}
              </div>

              <div className="mt-5 grid grid-cols-4 gap-2">
                {Array.from({ length: state.station.total_count || 4 }, (_, index) => {
                  const slot = state.slots.find((item) => item.slot_num === index + 1);
                  return (
                    <div key={index} className={`rounded-2xl border p-3 text-center ${slot?.rentable ? "border-primary/30 bg-primary/5" : "border-border bg-muted/25"}`}>
                      <p className="text-xs font-bold text-muted-foreground">{index + 1}</p>
                      <p className="mt-1 text-lg font-black">{slot?.charge_percent != null ? `${slot.charge_percent}%` : "—"}</p>
                      {slot?.recommended && <CheckCircle2 className="mx-auto mt-1 h-4 w-4 text-primary" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-card/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">{copy.pricing}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(state.quote.tiers || []).map((tier) => (
                <div key={tier.upper_minutes} className="rounded-2xl border border-border bg-background/70 p-4">
                  <p className="text-sm font-semibold text-muted-foreground">≤ {duration(tier.upper_minutes, lang)}</p>
                  <p className="mt-1 text-2xl font-black">{money(tier.total_cents, currency)}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3 rounded-2xl border border-border bg-muted/30 p-4">
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
              <div><p className="font-black">{copy.guarantee} · {money(state.quote.deposit_cents, currency)}</p><p className="mt-1 text-sm text-muted-foreground">{copy.guaranteeNote}</p></div>
            </div>

            <button
              type="button"
              disabled={!recommended}
              onClick={() => setTransactionMessage(TRANSACTIONS_ENABLED ? "PILOT_TRANSACTION_ROUTE_PENDING" : copy.testLocked)}
              className="mt-6 w-full rounded-full bg-primary px-7 py-5 text-xl font-black text-primary-foreground shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copy.continue}
            </button>
            {transactionMessage && <p className="mt-3 text-center text-sm font-semibold text-muted-foreground">{transactionMessage}</p>}
            <p className="mt-4 text-center text-sm font-semibold text-muted-foreground">{copy.returnNote}</p>
          </div>
        </section>

        <footer className="pb-1 text-center text-xs text-muted-foreground">{state.station.name}{state.station.location_name ? ` · ${state.station.location_name}` : ""}</footer>
      </div>
    </main>
  );
}
