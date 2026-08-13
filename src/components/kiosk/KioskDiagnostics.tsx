import { useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronDown, KeyRound, Lock, LogOut, RefreshCw, ShieldCheck, Wifi, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forceSetStation } from "@/lib/kioskLock";
import { readKioskToken } from "@/lib/kioskFetch";

const KIOSK_TOKEN_KEY = "kiosk_token";

function maskToken(t: string): string {
  if (!t) return "absent";
  return `présent (${t.length} car.)`;
}

type NativeIntegrationStatus = {
  cabinet?: { protocol?: string; commandMode?: string };
  vendorCompatibility?: {
    state?: string;
    installed?: boolean;
    enabled?: boolean;
    versionName?: string;
    publicBridgeStatus?: string;
    canReuseVendorConnection?: boolean;
  };
  physicalEjectionEnabled?: boolean;
};

type NativeWindow = Window & {
  ChargeursNative?: { getHardwareIntegrationStatus?: () => string };
};

function nativeIntegrationStatus(): NativeIntegrationStatus | null {
  try {
    const native = (window as NativeWindow).ChargeursNative;
    const raw = native?.getHardwareIntegrationStatus?.();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NativeIntegrationStatus;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function vendorStateLabel(state?: string): string {
  switch (state) {
    case "VENDOR_APP_NOT_INSTALLED": return "APK fournisseur absente";
    case "VENDOR_APP_DISABLED": return "APK fournisseur désactivée";
    case "VENDOR_APP_PRESENT_NO_LAUNCHER": return "APK présente · sans lanceur";
    case "VENDOR_APP_PRESENT_NO_PUBLIC_BRIDGE": return "APK présente · aucun pont public";
    case "VENDOR_APP_STATUS_UNAVAILABLE": return "État fournisseur indisponible";
    default: return "Non vérifiable depuis ce navigateur";
  }
}

type Props = {
  stationId: string | undefined;
  lockedStation: string | null;
  lastSync: string | null;
  net: "online" | "offline";
  chargenowConfigured: boolean | null;
  stationOnline: boolean | null;
  stationStatus: string | null;
  swUrl: string | null;
  needRefresh: boolean;
  lastFailure?: {
    code: string;
    correlationId?: string;
    sessionId?: string;
    step: string;
  } | null;
  onApplyUpdate: () => void;
  onClose: () => void;
};

type Tone = "ok" | "warn" | "bad" | "neutral";

const TONE = {
  ok: "border-emerald-300/20 bg-emerald-300/[.075] text-emerald-100",
  warn: "border-amber-300/20 bg-amber-300/[.075] text-amber-100",
  bad: "border-red-300/20 bg-red-300/[.075] text-red-100",
  neutral: "border-white/10 bg-white/[.035] text-slate-200",
} as const;

function HealthCard({ title, value, detail, tone, icon }: { title: string; value: string; detail: string; tone: Tone; icon: React.ReactNode }) {
  return (
    <article className={`min-h-[138px] rounded-[1.6rem] border p-5 ${TONE[tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <span className="text-xs font-black uppercase tracking-[.15em] opacity-60">{title}</span>
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-current/15 bg-black/10">{icon}</span>
      </div>
      <div className="mt-4 text-2xl font-black tracking-tight">{value}</div>
      <p className="mt-1 text-sm font-semibold leading-snug opacity-60">{detail}</p>
    </article>
  );
}

function Row({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  const color = tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-slate-200";
  return (
    <div className="kiosk-diagnostics-row grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-5 border-b border-white/[.065] py-2.5 last:border-b-0">
      <span className="text-sm font-semibold text-slate-500">{label}</span>
      <span className={`break-words text-right font-mono text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}

export function KioskDiagnostics(props: Props) {
  const { stationId, lockedStation, lastSync, net, chargenowConfigured, stationOnline, stationStatus, swUrl, needRefresh, lastFailure, onApplyUpdate, onClose } = props;
  const [relocked, setRelocked] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [savedToken, setSavedToken] = useState(() => readKioskToken() ?? "");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [nativeIntegration, setNativeIntegration] = useState<NativeIntegrationStatus | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const nativeWrapper = Boolean((window as NativeWindow).ChargeursNative);

  useEffect(() => {
    setNativeIntegration(nativeIntegrationStatus());
  }, []);

  const tokenReady = savedToken.length >= 24;
  const stationLockedCorrectly = Boolean(stationId && lockedStation === stationId);
  const coreReady = net === "online" && tokenReady && chargenowConfigured === true && stationOnline === true && stationLockedCorrectly;
  const corePending = net === "online" && tokenReady && stationLockedCorrectly && (chargenowConfigured == null || stationOnline == null || stationStatus === "unknown");

  const globalHealth = useMemo(() => {
    if (coreReady && !lastFailure) return { label: "BORNE OPÉRATIONNELLE", tone: "ok" as const, detail: "Le parcours cloud et la borne physique répondent correctement." };
    if (coreReady && lastFailure) return { label: "OPÉRATIONNELLE · INCIDENT RÉCENT", tone: "warn" as const, detail: "La borne répond, mais un incident de parcours est enregistré." };
    if (corePending) return { label: "VÉRIFICATION EN COURS", tone: "warn" as const, detail: "La borne est authentifiée ; un état fournisseur reste à confirmer." };
    return { label: "INTERVENTION REQUISE", tone: "bad" as const, detail: "Un prérequis essentiel du kiosk n’est pas disponible." };
  }, [corePending, coreReady, lastFailure]);

  const chargenowValue = !tokenReady
    ? "Activation requise"
    : chargenowConfigured == null
      ? "Vérification…"
      : chargenowConfigured
        ? "Cloud prêt"
        : "Indisponible";

  const stationValue = !tokenReady
    ? "Activation requise"
    : stationOnline == null
      ? "Vérification…"
      : stationOnline
        ? "En ligne"
        : stationStatus === "unknown"
          ? "À confirmer"
          : "Hors ligne";

  const relock = () => {
    if (stationId) {
      forceSetStation(stationId);
      setRelocked(true);
    }
  };

  const saveToken = () => {
    const t = tokenInput.trim();
    if (t.length < 24) return;
    try {
      localStorage.setItem(KIOSK_TOKEN_KEY, t);
      setSavedToken(t);
      setTokenInput("");
      setTokenSaved(true);
      setTimeout(() => setTokenSaved(false), 2500);
    } catch {
      // Local storage can be unavailable in restricted kiosk mode.
    }
  };

  const exitFullscreen = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    } else {
      const legacyDocument = document as Document & { webkitExitFullscreen?: () => void };
      legacyDocument.webkitExitFullscreen?.();
    }
    onClose();
  };

  return (
    <div className="kiosk-diagnostics fixed inset-0 z-[100] overflow-hidden bg-[#010611]/98 p-4 text-white backdrop-blur-2xl sm:p-6" role="dialog" aria-modal="true" aria-label="Diagnostic borne">
      <div aria-hidden className="pointer-events-none absolute left-[8%] top-[-28%] h-[70%] w-[48%] rounded-full bg-blue-600/15 blur-[130px]" />
      <div aria-hidden className="pointer-events-none absolute bottom-[-35%] right-[3%] h-[75%] w-[48%] rounded-full bg-cyan-500/9 blur-[145px]" />

      <section className="kiosk-diagnostics-panel relative mx-auto flex h-full w-full max-w-[1220px] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#040b17]/94 shadow-[0_42px_130px_rgba(0,0,0,.62)]">
        <header className="flex shrink-0 items-center justify-between gap-5 border-b border-white/[.075] px-8 py-5">
          <div className="flex min-w-0 items-center gap-4 text-left">
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border ${TONE[globalHealth.tone]}`}><Activity className="h-7 w-7" /></span>
            <div className="min-w-0">
              <span className="text-[11px] font-black uppercase tracking-[.19em] text-cyan-200/55">MAINTENANCE · OPÉRATEUR</span>
              <div className="mt-1 flex items-baseline gap-4">
                <h2 className="truncate font-display text-[2.25rem] font-black leading-none tracking-[-.035em]">{stationId ?? "Borne inconnue"}</h2>
                <span className={`rounded-full border px-3 py-1 text-[11px] font-black tracking-[.08em] ${TONE[globalHealth.tone]}`}>{globalHealth.label}</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-500">{globalHealth.detail}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-13 w-13 shrink-0 rounded-2xl border border-white/10 bg-white/[.035]" aria-label="Fermer le diagnostic"><X className="h-6 w-6" /></Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="grid grid-cols-4 gap-4">
            <HealthCard title="Réseau" value={net === "online" ? "Connecté" : "Hors ligne"} detail={net === "online" ? "Accès Internet disponible" : "Connexion Internet requise"} tone={net === "online" ? "ok" : "bad"} icon={<Wifi className="h-5 w-5" />} />
            <HealthCard title="ChargeNow" value={chargenowValue} detail={chargenowConfigured ? "Backend sécurisé configuré" : "Synchronisation fournisseur"} tone={!tokenReady || chargenowConfigured == null ? "warn" : chargenowConfigured ? "ok" : "bad"} icon={<Zap className="h-5 w-5" />} />
            <HealthCard title="Borne physique" value={stationValue} detail={lastSync ? `Synchro ${new Date(lastSync).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}` : "Aucune synchronisation récente"} tone={!tokenReady || stationOnline == null || stationStatus === "unknown" ? "warn" : stationOnline ? "ok" : "bad"} icon={<Activity className="h-5 w-5" />} />
            <HealthCard title="Identité kiosk" value={stationLockedCorrectly && tokenReady ? "Validée" : "À corriger"} detail={stationLockedCorrectly ? `Verrouillée sur ${stationId}` : `Verrou actuel : ${lockedStation ?? "aucun"}`} tone={stationLockedCorrectly && tokenReady ? "ok" : "bad"} icon={<ShieldCheck className="h-5 w-5" />} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <section className="rounded-[1.7rem] border border-white/[.085] bg-white/[.025] p-5 text-left">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-[.17em] text-slate-600">ÉTAT ESSENTIEL</span>
                  <h3 className="mt-1 text-xl font-black">Prêt pour un parcours client ?</h3>
                </div>
                <span className={`rounded-full border px-4 py-2 text-xs font-black ${TONE[coreReady ? "ok" : corePending ? "warn" : "bad"]}`}>{coreReady ? "OUI" : corePending ? "EN VÉRIFICATION" : "NON"}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-6">
                <Row label="Borne verrouillée" value={lockedStation ?? "non verrouillée"} tone={stationLockedCorrectly ? "ok" : "bad"} />
                <Row label="Token kiosk" value={maskToken(savedToken)} tone={tokenReady ? "ok" : "bad"} />
                <Row label="Dernière synchro" value={lastSync ? new Date(lastSync).toLocaleString("fr-CH") : "—"} tone={lastSync ? "ok" : "warn"} />
                <Row label="Stripe" value="Contrôle serveur au paiement" tone="neutral" />
              </div>

              {lastFailure && (
                <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[.055] p-4">
                  <div className="text-xs font-black uppercase tracking-[.14em] text-amber-200/65">DERNIER INCIDENT</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-6">
                    <Row label="Étape" value={lastFailure.step} tone="warn" />
                    <Row label="Code" value={lastFailure.code} tone="warn" />
                    <Row label="Corrélation" value={lastFailure.correlationId ?? "—"} />
                    <Row label="Session" value={lastFailure.sessionId ?? "—"} />
                  </div>
                </div>
              )}
            </section>

            <aside className="rounded-[1.7rem] border border-white/[.085] bg-black/15 p-5 text-left">
              <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-cyan-200" /><div><span className="text-[11px] font-black uppercase tracking-[.17em] text-slate-600">ACTIONS TERRAIN</span><h3 className="mt-1 text-xl font-black">Tablette & kiosk</h3></div></div>

              {!nativeWrapper && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[.03] p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-black"><KeyRound className="h-4 w-4 text-cyan-200" />{savedToken ? "Remplacer le token kiosk" : "Enregistrer le token kiosk"}</div>
                  <p className="mb-3 text-xs leading-relaxed text-slate-500">Token local de la borne {stationId ?? "—"}. La valeur reste masquée après enregistrement.</p>
                  <Input type="password" inputMode="text" autoComplete="off" placeholder="kt_…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="h-11 border-white/10 bg-black/25 font-mono text-sm" />
                  <Button onClick={saveToken} disabled={tokenInput.trim().length < 24} className="mt-3 h-11 w-full gap-2 rounded-xl bg-gradient-primary font-black">{tokenSaved ? <><Check className="h-4 w-4" />Token enregistré</> : <><KeyRound className="h-4 w-4" />Enregistrer</>}</Button>
                </div>
              )}

              <div className="mt-4 grid gap-2.5">
                {needRefresh && <Button onClick={onApplyUpdate} className="h-12 gap-2 rounded-xl bg-gradient-primary font-black"><RefreshCw className="h-4 w-4" />Appliquer la mise à jour</Button>}
                <Button variant="outline" onClick={relock} className="h-12 gap-2 rounded-xl border-white/12 bg-white/[.025] font-black"><Lock className="h-4 w-4" />{relocked ? "Borne reverrouillée" : `Verrouiller sur ${stationId ?? "—"}`}</Button>
                <Button variant="ghost" onClick={exitFullscreen} className="h-12 gap-2 rounded-xl font-black text-slate-400"><LogOut className="h-4 w-4" />Quitter le plein écran</Button>
              </div>
            </aside>
          </div>

          <details className="mt-5 rounded-[1.5rem] border border-white/[.075] bg-white/[.02]" open={advancedOpen} onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left">
              <div><span className="text-[11px] font-black uppercase tracking-[.17em] text-slate-600">DIAGNOSTIC AVANCÉ</span><p className="mt-1 text-sm font-bold text-slate-300">Version, service worker et intégration fournisseur</p></div>
              <ChevronDown className={`h-5 w-5 text-slate-500 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </summary>
            <div className="grid grid-cols-2 gap-x-8 border-t border-white/[.065] px-5 pb-5 pt-2 text-left">
              <Row label="Version frontend" value={typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev"} />
              <Row label="Service Worker" value={swUrl ? swUrl.split("/").pop() ?? "actif" : "inactif (dev/preview)"} tone={swUrl ? "ok" : "warn"} />
              <Row label="Cabinet URL" value={stationId ?? "—"} />
              <Row label="Statut fournisseur" value={stationStatus ?? "—"} />
              {nativeIntegration && <Row label="APK fournisseur" value={vendorStateLabel(nativeIntegration.vendorCompatibility?.state)} tone="neutral" />}
              {nativeIntegration && <Row label="Pont matériel local" value={nativeIntegration.cabinet?.protocol ?? "non configuré"} tone={nativeIntegration.cabinet?.protocol === "NOT_CONFIGURED" ? "neutral" : "ok"} />}
              {nativeIntegration?.vendorCompatibility?.versionName && <Row label="Version APK fournisseur" value={nativeIntegration.vendorCompatibility.versionName} />}
              {nativeIntegration?.cabinet?.commandMode && <Row label="Mode commande local" value={nativeIntegration.cabinet.commandMode} />}
            </div>
          </details>

          <p className="mt-4 text-center text-xs font-semibold text-slate-600">Aucun secret ChargeNow ou Stripe n’est affiché. Les opérations sensibles restent côté serveur.</p>
        </div>
      </section>
    </div>
  );
}
