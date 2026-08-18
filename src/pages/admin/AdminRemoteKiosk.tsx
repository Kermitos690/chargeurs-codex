import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  BatteryCharging,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  Expand,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { stationConnectionLabel, stationConnectionState } from "@/lib/stationConnection";

type Station = Record<string, any> & {
  station_id: string;
  name?: string | null;
  location_name?: string | null;
  rentable_count?: number | null;
  last_sync_at?: string | null;
};

type KioskDevice = {
  id: string;
  station_id: string;
  label: string | null;
  active: boolean;
  token_revoked: boolean;
  last_seen_at: string | null;
  app_version: string | null;
  device_public_id: string | null;
};

type SimStage = "home" | "member" | "express" | "payment" | "release" | "done";

const STAGE_LABELS: Record<SimStage, string> = {
  home: "Accueil",
  member: "Client Chargeurs",
  express: "Location Express",
  payment: "Paiement QR",
  release: "Libération",
  done: "Terminé",
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "medium" });
};

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "warn" | "neutral" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
      tone === "good" && "border-success/30 bg-success/10 text-success",
      tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
      tone === "neutral" && "border-border bg-muted/35 text-muted-foreground",
    )}>
      {children}
    </span>
  );
}

function KioskSimulator({ station, stage, setStage }: { station: Station; stage: SimStage; setStage: (stage: SimStage) => void }) {
  const available = Math.max(0, Number(station.rentable_count ?? 0));
  const stationName = station.location_name || station.name || station.station_id;
  const previewPaymentUrl = `${window.location.origin}/preview/payment/${encodeURIComponent(station.station_id)}`;
  const previewMemberUrl = `${window.location.origin}/preview/member/${encodeURIComponent(station.station_id)}`;

  const shell = "relative flex h-full w-full flex-col overflow-hidden bg-[#05070d] text-white";
  const card = "rounded-[1.4vw] border border-white/10 bg-white/[0.055] backdrop-blur-md";
  const primary = "bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 text-white shadow-[0_0_45px_rgba(168,85,247,0.25)]";

  return (
    <div className={shell}>
      <div className="pointer-events-none absolute -left-[12%] -top-[25%] h-[70%] w-[55%] rounded-full bg-violet-600/20 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-[30%] -right-[10%] h-[75%] w-[55%] rounded-full bg-cyan-400/15 blur-[90px]" />

      <header className="relative z-10 flex items-center justify-between px-[3.2%] py-[2.1%]">
        <BrandLogo size="sm" />
        <div className="flex items-center gap-2 text-[clamp(8px,1vw,13px)]">
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 font-bold tracking-wide text-amber-200">SIMULATION</span>
          <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/65 sm:inline">{station.station_id}</span>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 px-[4%] pb-[4%]">
        {stage === "home" && (
          <div className="grid h-full grid-cols-[1.25fr_0.75fr] gap-[4%]">
            <section className="flex min-h-0 flex-col justify-center">
              <p className="mb-[1.2%] text-[clamp(7px,0.95vw,12px)] font-bold tracking-[0.24em] text-cyan-300">POWER WHEN YOU NEED IT</p>
              <h2 className="font-display text-[clamp(24px,5.1vw,76px)] font-black leading-[0.88] tracking-[-0.05em]">
                PLUS DE<br />BATTERIE ?<br /><span className="bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">RÉGLÉ.</span>
              </h2>
              <div className="mt-[3%] flex items-center gap-[2.5%] text-[clamp(8px,1.25vw,18px)] text-white/70">
                <Zap className="h-[1.5em] w-[1.5em] text-cyan-300" />
                <strong className="text-white">dès 1.90 CHF</strong><span>/ 30 min</span>
                <span className="h-5 w-px bg-white/15" />
                <span>Jusqu'à 24 h</span><strong className="text-white">7.90 CHF</strong>
              </div>
              <div className="mt-[4%] grid grid-cols-2 gap-[2.5%]">
                <button type="button" onClick={() => setStage("express")} className={cn(card, primary, "group p-[5%] text-left transition-transform active:scale-[0.985]")}>
                  <Zap className="mb-[5%] h-[2.2em] w-[2.2em]" />
                  <span className="block text-[clamp(7px,0.8vw,11px)] font-bold tracking-[0.18em] opacity-80">LOCATION</span>
                  <strong className="block text-[clamp(15px,2.4vw,34px)] font-black">EXPRESS</strong>
                  <small className="mt-[4%] block text-[clamp(7px,0.9vw,12px)] leading-relaxed opacity-80">Sans compte. Parcours de test sans paiement réel.</small>
                </button>
                <button type="button" onClick={() => setStage("member")} className={cn(card, "p-[5%] text-left transition-transform active:scale-[0.985]")}>
                  <Smartphone className="mb-[5%] h-[2.2em] w-[2.2em] text-violet-300" />
                  <span className="block text-[clamp(7px,0.8vw,11px)] font-bold tracking-[0.18em] text-white/55">CLIENT</span>
                  <strong className="block text-[clamp(15px,2.4vw,34px)] font-black">CHARGEURS</strong>
                  <small className="mt-[4%] block text-[clamp(7px,0.9vw,12px)] leading-relaxed text-white/55">Connexion simulée par QR, sans session réelle.</small>
                </button>
              </div>
            </section>

            <section className="flex items-center justify-center">
              <div className="relative w-[76%] rounded-[2vw] border border-white/15 bg-gradient-to-b from-white/10 to-white/[0.025] p-[7%] shadow-2xl">
                <div className="rounded-[1.2vw] border border-white/10 bg-black/40 p-[9%] text-center">
                  <BatteryCharging className="mx-auto mb-[6%] h-[3em] w-[3em] text-cyan-300" />
                  <strong className="block text-[clamp(11px,1.55vw,22px)]">{available} batteries disponibles</strong>
                  <span className="mt-[3%] block text-[clamp(7px,0.85vw,12px)] text-white/50">{stationName}</span>
                </div>
                <div className="mt-[8%] grid grid-cols-4 gap-[5%]">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className={cn("aspect-[0.62] rounded-full border", index < Math.min(available, 8) ? "border-cyan-300/50 bg-cyan-300/20" : "border-white/10 bg-white/5")} />
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {stage === "member" && (
          <div className="flex h-full items-center justify-center">
            <div className={cn(card, "grid w-[78%] grid-cols-[1fr_0.75fr] gap-[6%] p-[5%]")}>
              <div className="flex flex-col justify-center">
                <span className="text-[clamp(8px,0.9vw,12px)] font-bold tracking-[0.2em] text-violet-300">CLIENT CHARGEURS</span>
                <h2 className="mt-[2%] font-display text-[clamp(22px,4vw,56px)] font-black leading-none">Scannez avec<br /><span className="text-cyan-300">votre téléphone</span></h2>
                <p className="mt-[5%] text-[clamp(8px,1vw,14px)] text-white/55">QR de démonstration. Aucun compte n’est connecté et aucune donnée n’est envoyée.</p>
                <div className="mt-[7%] flex gap-3">
                  <button type="button" onClick={() => setStage("home")} className="rounded-full border border-white/15 px-[6%] py-[3%] text-[clamp(8px,1vw,13px)]">Annuler</button>
                  <button type="button" onClick={() => setStage("express")} className={cn(primary, "rounded-full px-[6%] py-[3%] text-[clamp(8px,1vw,13px)] font-bold")}>Simuler connexion</button>
                </div>
              </div>
              <div className="flex items-center justify-center rounded-[1.5vw] bg-white p-[8%]">
                <QRCodeSVG value={previewMemberUrl} className="h-auto w-full" level="M" bgColor="#ffffff" fgColor="#05070d" />
              </div>
            </div>
          </div>
        )}

        {stage === "express" && (
          <div className="flex h-full items-center justify-center">
            <div className={cn(card, "w-[72%] p-[5%]")}>
              <div className="flex items-start justify-between gap-5">
                <div>
                  <span className="text-[clamp(8px,0.9vw,12px)] font-bold tracking-[0.2em] text-cyan-300">LOCATION EXPRESS</span>
                  <h2 className="mt-[2%] font-display text-[clamp(24px,4vw,58px)] font-black leading-none">Votre batterie<br />est sélectionnée.</h2>
                </div>
                <div className="rounded-[1.2vw] border border-cyan-300/20 bg-cyan-300/10 p-[4%] text-center">
                  <BatteryCharging className="mx-auto h-[2.5em] w-[2.5em] text-cyan-300" />
                  <strong className="mt-2 block text-[clamp(10px,1.35vw,18px)]">{available > 0 ? "Disponible" : "Simulation"}</strong>
                </div>
              </div>
              <div className="mt-[7%] flex items-center justify-between gap-4">
                <p className="max-w-[58%] text-[clamp(8px,1vw,14px)] text-white/55">Le bouton suivant ouvre uniquement un paiement fictif. Aucun PaymentIntent Stripe n’est créé.</p>
                <button type="button" onClick={() => setStage("payment")} className={cn(primary, "rounded-full px-[7%] py-[3%] text-[clamp(9px,1.1vw,15px)] font-bold")}>Continuer →</button>
              </div>
            </div>
          </div>
        )}

        {stage === "payment" && (
          <div className="grid h-full grid-cols-[1fr_0.72fr] items-center gap-[6%] px-[7%]">
            <div>
              <span className="text-[clamp(8px,0.9vw,12px)] font-bold tracking-[0.2em] text-fuchsia-300">PAIEMENT TEST</span>
              <h2 className="mt-[2%] font-display text-[clamp(24px,4.2vw,62px)] font-black leading-none">Scannez le QR<br />sur votre téléphone.</h2>
              <div className="mt-[5%] flex items-center gap-2 text-[clamp(8px,1vw,14px)] text-emerald-300"><ShieldCheck className="h-[1.4em] w-[1.4em]" /> Aucun débit — aucune autorisation Stripe</div>
              <div className="mt-[7%] flex gap-3">
                <button type="button" onClick={() => setStage("express")} className="rounded-full border border-white/15 px-[6%] py-[3%] text-[clamp(8px,1vw,13px)]">Retour</button>
                <button type="button" onClick={() => setStage("release")} className={cn(primary, "rounded-full px-[6%] py-[3%] text-[clamp(8px,1vw,13px)] font-bold")}>Simuler paiement validé</button>
              </div>
            </div>
            <div className="rounded-[1.6vw] bg-white p-[9%] text-center text-slate-900">
              <QRCodeSVG value={previewPaymentUrl} className="mx-auto h-auto w-full" level="M" bgColor="#ffffff" fgColor="#05070d" />
              <strong className="mt-[6%] block text-[clamp(9px,1.2vw,16px)]">QR DE TEST</strong>
              <span className="text-[clamp(7px,0.85vw,11px)] text-slate-500">ne déclenche aucun paiement</span>
            </div>
          </div>
        )}

        {stage === "release" && (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-[72%]">
              <div className="mx-auto grid h-[7vw] min-h-12 w-[7vw] min-w-12 place-items-center rounded-full border border-cyan-300/25 bg-cyan-300/10">
                <Zap className="h-[45%] w-[45%] animate-pulse text-cyan-300" />
              </div>
              <span className="mt-[5%] block text-[clamp(8px,0.9vw,12px)] font-bold tracking-[0.2em] text-cyan-300">LIBÉRATION SIMULÉE</span>
              <h2 className="mt-[2%] font-display text-[clamp(24px,4.4vw,64px)] font-black leading-none">La borne libère<br />une powerbank.</h2>
              <p className="mx-auto mt-[4%] max-w-[70%] text-[clamp(8px,1vw,14px)] text-white/55">Aucune commande ChargeNow, série ou Android n’est envoyée pendant ce test.</p>
              <button type="button" onClick={() => setStage("done")} className={cn(primary, "mt-[6%] rounded-full px-[7%] py-[3%] text-[clamp(9px,1.1vw,15px)] font-bold")}>Simuler éjection réussie</button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <CheckCircle2 className="mx-auto h-[7vw] min-h-12 w-[7vw] min-w-12 text-emerald-300" />
              <h2 className="mt-[4%] font-display text-[clamp(26px,4.6vw,68px)] font-black leading-none">Test terminé.</h2>
              <p className="mt-[3%] text-[clamp(8px,1vw,14px)] text-white/55">Le parcours a été simulé jusqu’à la sortie de batterie, sans effet réel.</p>
              <button type="button" onClick={() => setStage("home")} className={cn(primary, "mt-[6%] rounded-full px-[7%] py-[3%] text-[clamp(9px,1.1vw,15px)] font-bold")}>Recommencer</button>
            </div>
          </div>
        )}
      </main>

      {stage !== "home" && (
        <button type="button" onClick={() => setStage("home")} className="absolute bottom-[2.5%] left-[3%] z-20 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[clamp(7px,0.9vw,11px)] text-white/60 backdrop-blur">
          <ChevronLeft className="h-[1em] w-[1em]" /> Accueil
        </button>
      )}
    </div>
  );
}

export default function AdminRemoteKiosk() {
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<KioskDevice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stage, setStage] = useState<SimStage>("home");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    const [{ data: stationRows, error: stationError }, { data: kioskData }] = await Promise.all([
      supabase.from("stations").select("*").order("station_id"),
      supabase.functions.invoke("kiosk-admin", { body: { action: "list" } }),
    ]);

    if (!stationError) {
      const next = (stationRows ?? []) as Station[];
      setStations(next);
      setSelectedId((current) => current && next.some((station) => station.station_id === current) ? current : (next[0]?.station_id ?? ""));
    }
    setDevices(((kioskData as { devices?: KioskDevice[] } | null)?.devices ?? []));
    setLastRefresh(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => { setStage("home"); }, [selectedId]);

  const selected = useMemo(() => stations.find((station) => station.station_id === selectedId) ?? null, [stations, selectedId]);
  const kiosk = useMemo(() => devices.find((device) => device.station_id === selectedId && device.active && !device.token_revoked) ?? devices.find((device) => device.station_id === selectedId) ?? null, [devices, selectedId]);
  const connection = selected ? stationConnectionState(selected) : "unknown";
  const online = connection === "online";
  const kioskRecentlySeen = kiosk?.last_seen_at ? Date.now() - new Date(kiosk.last_seen_at).getTime() < 90_000 : false;

  if (loading) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-semibold uppercase tracking-[0.16em] text-primary">Supervision kiosk</p>
          <h1 className="font-display text-3xl font-bold">Écran à distance</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Vue mobile de la borne avec données d’exploitation réelles et parcours tactile simulé. Cette première version n’envoie volontairement aucune commande Stripe, ChargeNow ou Android.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setStage("home"); }} className="gap-2"><RotateCcw className="h-4 w-4" />Réinitialiser</Button>
          <Button onClick={() => void load()} disabled={refreshing} className="gap-2"><RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />Actualiser</Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <section className="glass liquid-border rounded-2xl p-5">
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Borne</label>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-primary focus:ring-2">
              {stations.map((station) => <option key={station.station_id} value={station.station_id}>{station.station_id} — {station.location_name || station.name || "Sans nom"}</option>)}
            </select>

            {selected && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={online ? "good" : "warn"}>{online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{stationConnectionLabel(selected)}</StatusPill>
                  <StatusPill tone={kioskRecentlySeen ? "good" : "neutral"}><CircleDot className="h-3.5 w-3.5" />{kioskRecentlySeen ? "Tablette active" : "Tablette non vue récemment"}</StatusPill>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">Emplacement</div><strong>{selected.location_name || selected.name || "—"}</strong>
                  <div className="mt-3 text-xs text-muted-foreground">Batteries louables</div><strong>{selected.rentable_count ?? "—"}</strong>
                  <div className="mt-3 text-xs text-muted-foreground">Dernière sync station</div><strong className="text-xs">{formatDate(selected.last_sync_at)}</strong>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-center gap-2 font-semibold"><MonitorSmartphone className="h-4 w-4" />Tablette attribuée</div>
                  <div className="mt-2 text-xs text-muted-foreground">{kiosk?.label || "Aucun libellé"}</div>
                  <div className="mt-1 text-xs">APK {kiosk?.app_version || "—"}</div>
                  <div className="mt-1 text-xs">Dernière activité : {formatDate(kiosk?.last_seen_at)}</div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-bold text-success"><ShieldCheck className="h-4 w-4" />Mode test protégé</div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Les touches du simulateur changent uniquement l’écran affiché. Aucun paiement, aucune location et aucune éjection réelle ne sont créés.</p>
          </section>

          <section className="rounded-2xl border border-border bg-card/60 p-4 text-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Étape affichée</div>
            <div className="mt-1 font-semibold">{STAGE_LABELS[stage]}</div>
            <div className="mt-3 text-xs text-muted-foreground">Rafraîchissement données : {lastRefresh ? lastRefresh.toLocaleTimeString("fr-CH") : "—"} · auto toutes les 5 s</div>
          </section>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold">Aperçu tactile</h2>
              <p className="text-xs text-muted-foreground">Format logique 16:9 de la tablette, automatiquement réduit sur iPhone.</p>
            </div>
            <Button variant="outline" onClick={() => setFullscreen(true)} className="gap-2"><Expand className="h-4 w-4" />Plein écran</Button>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-border bg-black shadow-2xl">
            <div className="aspect-video w-full">{selected ? <KioskSimulator station={selected} stage={stage} setStage={setStage} /> : <div className="grid h-full place-items-center text-white/50">Aucune borne disponible</div>}</div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground"><strong>Données réelles :</strong> statut réseau, stock synchronisé, dernière activité kiosk. <strong>Écran :</strong> simulation fonctionnelle sûre. Le miroir vidéo de la tablette Android sera la couche suivante.</p>
        </section>
      </div>

      {fullscreen && selected && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black p-2 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-2 text-sm"><Smartphone className="h-4 w-4" /><strong>{selected.station_id}</strong><span className="text-white/50">{STAGE_LABELS[stage]}</span></div>
            <Button variant="secondary" size="sm" onClick={() => setFullscreen(false)}>Fermer</Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="aspect-video w-full max-w-[calc(100vh*16/9)] overflow-hidden rounded-2xl border border-white/10">
              <KioskSimulator station={selected} stage={stage} setStage={setStage} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
