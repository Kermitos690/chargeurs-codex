import { useEffect, useState } from "react";
import { X, RefreshCw, Lock, LogOut, KeyRound, Check, Activity, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forceSetStation } from "@/lib/kioskLock";
import { readKioskToken } from "@/lib/kioskFetch";

const KIOSK_TOKEN_KEY = "kiosk_token";

function maskToken(t: string): string {
  if (!t) return "aucun token enregistré";
  // A diagnostics screen must never reveal a reusable credential, even in
  // shortened form. Presence and length are enough to diagnose provisioning.
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
    case "VENDOR_APP_NOT_INSTALLED": return "application fournisseur absente";
    case "VENDOR_APP_DISABLED": return "application fournisseur désactivée";
    case "VENDOR_APP_PRESENT_NO_LAUNCHER": return "application fournisseur sans lanceur";
    case "VENDOR_APP_PRESENT_NO_PUBLIC_BRIDGE": return "application fournisseur détectée — aucun pont public";
    case "VENDOR_APP_STATUS_UNAVAILABLE": return "état fournisseur indisponible";
    default: return "non vérifiable depuis ce navigateur";
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

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="kiosk-diagnostics-row flex min-h-12 items-center justify-between gap-6 border-b border-white/8 py-2.5 last:border-b-0">
      <span className="text-sm font-semibold text-slate-400">{label}</span>
      <span className={`max-w-[62%] break-words text-right font-mono text-sm font-bold ${color}`}>{value}</span>
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

  const nativeWrapper = Boolean((window as NativeWindow).ChargeursNative);

  useEffect(() => {
    // Reading a metadata-only bridge state is safe and lets operators see why
    // a vendor APK cannot be used as a hardware SDK by this independent app.
    setNativeIntegration(nativeIntegrationStatus());
  }, []);

  const tokenReady = savedToken.length >= 24;
  const chargenowValue = !tokenReady
    ? "activation kiosk requise"
    : chargenowConfigured == null
      ? "vérification…"
      : chargenowConfigured
        ? "configurée"
        : "non configurée ou inaccessible";
  const chargenowTone = !tokenReady || chargenowConfigured == null
    ? "warn"
    : chargenowConfigured
      ? "ok"
      : "bad";

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
    <div className="kiosk-diagnostics fixed inset-0 z-[100] overflow-hidden bg-[#020817]/96 p-5 text-white backdrop-blur-2xl sm:p-7" role="dialog" aria-modal="true" aria-label="Diagnostic borne">
      <div aria-hidden className="pointer-events-none absolute -left-[12vw] top-[-18vh] h-[58vh] w-[58vh] rounded-full bg-blue-600/18 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-[24vh] right-[-8vw] h-[64vh] w-[64vh] rounded-full bg-cyan-500/10 blur-[130px]" />

      <section className="kiosk-diagnostics-panel relative mx-auto flex h-full w-full max-w-[1180px] flex-col overflow-hidden rounded-[2.35rem] border border-white/12 bg-slate-950/82 shadow-[0_38px_120px_rgba(0,0,0,.55),0_0_80px_rgba(37,99,235,.10)]">
        <header className="flex shrink-0 items-center justify-between gap-5 border-b border-white/10 px-7 py-5 sm:px-9">
          <div className="flex min-w-0 items-center gap-4 text-left">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-cyan-200/20 bg-cyan-300/8 text-cyan-200"><Activity className="h-7 w-7" /></span>
            <div className="min-w-0">
              <span className="text-xs font-black uppercase tracking-[.18em] text-cyan-200/65">MAINTENANCE · OPÉRATEUR</span>
              <h2 className="mt-1 truncate font-display text-3xl font-black tracking-tight">Diagnostic borne {stationId ?? "—"}</h2>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-white/5" aria-label="Fermer le diagnostic"><X className="h-6 w-6" /></Button>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 p-5 sm:p-7 lg:grid-cols-[1.15fr_.85fr]">
          <section className="min-h-0 overflow-y-auto rounded-[1.75rem] border border-white/10 bg-white/[.035] p-5 text-left sm:p-6">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div><span className="text-xs font-black uppercase tracking-[.16em] text-slate-500">ÉTAT SYSTÈME</span><h3 className="mt-1 text-xl font-black">Connectivité & intégration</h3></div>
              <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${net === "online" ? "border-emerald-300/20 bg-emerald-300/8 text-emerald-200" : "border-red-300/20 bg-red-300/8 text-red-200"}`}>{net === "online" ? "RÉSEAU OK" : "HORS LIGNE"}</span>
            </div>

            <Row label="Version frontend" value={typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev"} />
            <Row label="Service Worker" value={swUrl ? swUrl.split("/").pop() ?? "actif" : "inactif (dev/preview)"} tone={swUrl ? "ok" : "warn"} />
            <Row label="Cabinet (URL)" value={stationId ?? "—"} />
            <Row label="Cabinet verrouillé" value={lockedStation ?? "non verrouillé"} tone={lockedStation && lockedStation === stationId ? "ok" : lockedStation ? "bad" : "warn"} />
            <Row label="Dernière synchro" value={lastSync ? new Date(lastSync).toLocaleString("fr-CH") : "—"} />
            <Row label="Réseau Internet" value={net === "online" ? "connecté" : "indisponible"} tone={net === "online" ? "ok" : "bad"} />
            <Row label="API ChargeNow" value={chargenowValue} tone={chargenowTone} />
            <Row label="Borne physique" value={!tokenReady ? "activation requise" : stationOnline == null ? "—" : stationOnline ? "en ligne" : stationStatus === "unknown" ? "statut fournisseur à vérifier" : "hors ligne"} tone={!tokenReady ? "warn" : stationOnline ? "ok" : stationStatus === "unknown" ? "warn" : stationOnline === false ? "bad" : "warn"} />
            {nativeIntegration && (
              <>
                <Row label="App fournisseur" value={vendorStateLabel(nativeIntegration.vendorCompatibility?.state)} tone={nativeIntegration.vendorCompatibility?.installed ? "warn" : "bad"} />
                <Row label="Pont matériel local" value={nativeIntegration.cabinet?.protocol ?? "non disponible"} tone={nativeIntegration.cabinet?.protocol === "NOT_CONFIGURED" ? "warn" : "ok"} />
              </>
            )}
            <Row label="Stripe" value="vérifié côté serveur au paiement" />
            <Row label="Token kiosk" value={maskToken(savedToken)} tone={tokenReady ? "ok" : "bad"} />
            <Row label="Dernière étape" value={lastFailure?.step ?? "—"} tone={lastFailure ? "bad" : undefined} />
            <Row label="Dernier code" value={lastFailure?.code ?? "—"} tone={lastFailure ? "bad" : undefined} />
            <Row label="Corrélation" value={lastFailure?.correlationId ?? "—"} />
            <Row label="Session location" value={lastFailure?.sessionId ?? "—"} />
          </section>

          <aside className="min-h-0 overflow-y-auto rounded-[1.75rem] border border-white/10 bg-black/15 p-5 text-left sm:p-6">
            <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-cyan-200" /><div><span className="text-xs font-black uppercase tracking-[.16em] text-slate-500">OUTILS LOCAUX</span><h3 className="mt-1 text-xl font-black">Configuration tablette</h3></div></div>

            {!nativeWrapper && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[.035] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-black"><KeyRound className="h-4 w-4 text-cyan-200" />{savedToken ? "Remplacer le token kiosk" : "Enregistrer le token kiosk"}</div>
                <p className="mb-3 text-xs leading-relaxed text-slate-400">Collez le token fourni pour cette borne ({stationId ?? "—"}). Il reste local à cette tablette et n'est envoyé qu'aux fonctions kiosk autorisées.</p>
                <Input type="password" inputMode="text" autoComplete="off" placeholder="kt_…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="h-12 border-white/10 bg-black/25 font-mono text-sm" />
                <Button onClick={saveToken} disabled={tokenInput.trim().length < 24} className="mt-3 h-12 w-full gap-2 rounded-xl bg-gradient-primary font-black">{tokenSaved ? <><Check className="h-4 w-4" />Token enregistré ✓</> : <><KeyRound className="h-4 w-4" />Enregistrer le token</>}</Button>
              </div>
            )}

            {nativeIntegration?.vendorCompatibility?.installed && (
              <p className="mt-4 rounded-2xl border border-warning/20 bg-warning/8 p-4 text-xs leading-relaxed text-slate-400">L’APK fournisseur peut être installée sur cette tablette, mais Chargeurs.ch ne réutilise ni sa connexion privée ni ses fichiers internes sans SDK/contrat public. Le cloud ChargeNow reste appelé uniquement par le backend sécurisé.</p>
            )}

            <div className="mt-5 grid gap-3">
              {needRefresh && <Button onClick={onApplyUpdate} className="h-14 gap-2 rounded-2xl bg-gradient-primary text-base font-black"><RefreshCw className="h-5 w-5" />Appliquer la mise à jour</Button>}
              <Button variant="outline" onClick={relock} className="h-14 gap-2 rounded-2xl border-white/12 bg-white/[.025] text-base font-black"><Lock className="h-5 w-5" />{relocked ? "Borne verrouillée ✓" : `Verrouiller sur ${stationId ?? "—"}`}</Button>
              <Button variant="ghost" onClick={exitFullscreen} className="h-14 gap-2 rounded-2xl text-base font-black text-slate-300"><LogOut className="h-5 w-5" />Quitter le plein écran</Button>
            </div>

            <p className="mt-5 rounded-2xl border border-emerald-300/10 bg-emerald-300/[.035] p-4 text-xs leading-relaxed text-slate-400"><ShieldCheck className="mr-2 inline h-4 w-4 text-emerald-300" />Aucun secret ChargeNow / Stripe n'est exposé ici. Les opérations sensibles restent côté serveur.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
