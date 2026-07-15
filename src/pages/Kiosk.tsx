import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BatteryCharging, Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle, X,
  ShieldCheck, CreditCard, Smartphone, Clock, RefreshCw, Lock, HelpCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useKioskPwa } from "@/pwa/useKioskPwa";
import { getLockedStation, lockStationIfUnset, isValidStationId } from "@/lib/kioskLock";
import { KioskDiagnostics } from "@/components/kiosk/KioskDiagnostics";

type Station = {
  station_id: string; name: string; location_name: string | null;
  online: boolean; rentable_count: number;
  price_per_period: number; currency: string; last_sync_at: string | null;
};
type Quote = {
  amount: number; currency: string; profile_name: string;
  final_cents: number; profile_id: string; source: string; error?: string;
};
type Phase = "loading" | "idle" | "pricing" | "starting" | "qr" | "waitpay" | "success" | "error" | "support" | "expired";

const STATE_MSG: Record<string, { phase: Phase; title: string; sub: string }> = {
  payment_succeeded: { phase: "waitpay", title: "Paiement reçu", sub: "Préparation de votre batterie…" },
  ejecting: { phase: "waitpay", title: "Libération en cours", sub: "Votre batterie va être libérée." },
  payment_failed: { phase: "error", title: "Paiement non abouti", sub: "Le paiement n'a pas abouti. Aucun débit ne sera effectué automatiquement." },
  chargenow_failed: { phase: "support", title: "Vérification en cours", sub: "Le paiement a été reçu mais la batterie n'a pas pu être préparée. Une vérification ou un remboursement est en cours." },
  eject_failed: { phase: "support", title: "Intervention requise", sub: "La batterie n'a pas pu être libérée. Votre paiement est sécurisé et une intervention est en cours." },
  needs_support: { phase: "support", title: "Support requis", sub: "Une vérification est en cours. Votre paiement est sécurisé." },
  manual_review: { phase: "support", title: "Revue manuelle", sub: "Votre demande est en cours de vérification manuelle." },
  refunded: { phase: "error", title: "Remboursé", sub: "Cette location a été remboursée." },
  payment_expired: { phase: "expired", title: "QR code expiré", sub: "Ce QR code a expiré. Vous pouvez générer un nouveau paiement." },
  payment_cancelled: { phase: "error", title: "Annulé", sub: "La demande de location a été annulée." },
  cancelled: { phase: "error", title: "Annulé", sub: "La demande de location a été annulée." },
};

export default function Kiosk() {
  const { stationId } = useParams();
  const { lang } = useI18n();
  const [station, setStation] = useState<Station | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [slotNum, setSlotNum] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ title: string; sub: string } | null>(null);
  const [lockedStation, setLockedStation] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const tapRef = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  const idemRef = useRef<string | null>(null);

  const net = useOnlineStatus();
  const offline = net === "offline";
  const { needRefresh, swUrl, applyUpdate } = useKioskPwa();
  const busy = ["pricing", "starting", "qr", "waitpay"].includes(phase);

  const onLogoTap = useCallback(() => {
    const nowMs = Date.now();
    const r = tapRef.current;
    r.n = nowMs - r.t < 600 ? r.n + 1 : 1;
    r.t = nowMs;
    if (r.n >= 5) { r.n = 0; setShowDiag(true); }
  }, []);

  const loadStation = useCallback(async () => {
    if (!stationId) return;
    const { data } = await supabase
      .from("stations")
      .select(
        "id, station_id, name, location_name, status, online, rentable_count, returnable_count, total_count, currency, price_per_period, last_sync_at, created_at, updated_at, shop_id",
      )
      .eq("station_id", stationId)
      .maybeSingle();
    setStation(data as Station | null);
    setPhase((p) => (p === "loading" ? "idle" : p));
  }, [stationId]);

  const loadQuote = useCallback(async () => {
    if (!stationId) return;
    const token = localStorage.getItem("kiosk_token");
    if (!token) {
      setQuote(null);
      setQuoteError("KIOSK_AUTH_REQUIRED");
      return;
    }
    const { data, error } = await supabase.rpc("kiosk_quote", { p_token: token, p_station: stationId });
    const snap = data as Record<string, unknown> | null;
    if (error || !snap || snap.error || !snap.final_cents) {
      setQuote(null);
      setQuoteError((snap?.error as string) ?? error?.message ?? "PRICING_NOT_CONFIGURED");
      return;
    }
    setQuoteError(null);
    setQuote({
      amount: Number(snap.amount),
      currency: String(snap.currency),
      profile_name: String(snap.profile_name ?? ""),
      final_cents: Number(snap.final_cents),
      profile_id: String(snap.profile_id ?? ""),
      source: String(snap.source ?? ""),
    });
  }, [stationId]);

  useEffect(() => {
    if (!isValidStationId(stationId)) { setMismatch(false); setLockedStation(getLockedStation()); return; }
    const effective = lockStationIfUnset(stationId);
    setLockedStation(effective);
    setMismatch(!!effective && effective !== stationId);
  }, [stationId]);

  useEffect(() => {
    document.documentElement.classList.add("kiosk-mode");
    const blockGesture = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", blockGesture);
    document.addEventListener("contextmenu", blockGesture);
    return () => {
      document.documentElement.classList.remove("kiosk-mode");
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("contextmenu", blockGesture);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onPopState = () => { window.history.pushState(null, "", window.location.href); };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [busy]);

  useEffect(() => {
    if (needRefresh && !busy && (phase === "idle" || phase === "loading")) {
      const t = setTimeout(() => { applyUpdate(); }, 4000);
      return () => clearTimeout(t);
    }
  }, [needRefresh, busy, phase, applyUpdate]);

  useEffect(() => {
    loadStation();
    loadQuote();
    supabase.functions.invoke("sync-cabinet-status", { body: { stationId } })
      .then(({ data }) => { setConfigured((data as { configured?: boolean })?.configured ?? false); loadStation(); })
      .catch(() => setConfigured(false));
    const i = setInterval(loadStation, 15000);
    return () => clearInterval(i);
  }, [stationId, loadStation, loadQuote]);

  useEffect(() => {
    if (phase !== "qr") return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [phase]);

  useEffect(() => {
    if (phase === "qr" && expiresAt && now >= expiresAt) setPhase("expired");
  }, [phase, expiresAt, now]);

  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => reset(), 12000);
    return () => clearTimeout(t);
  }, [phase]);

  const goFullscreen = useCallback(() => {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) {
      (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch(() => {});
    }
  }, []);

  const applyState = useCallback((s: string, slot: number | null) => {
    if (s === "ejected" || s === "active_rental" || s === "battery_taken") {
      setSlotNum(slot); setPhase("success"); return;
    }
    const m = STATE_MSG[s];
    if (m) { setStatusMsg({ title: m.title, sub: m.sub }); setPhase(m.phase); }
  }, []);

  useEffect(() => {
    if (!sessionId || !publicCode || !["qr", "waitpay", "starting"].includes(phase)) return;
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: sessionId, p_code: publicCode });
      const r = data as { state?: string; selected_slot_num?: number | null } | null;
      if (r?.state) applyState(r.state, r.selected_slot_num ?? null);
    }, 3000);
    return () => clearInterval(poll);
  }, [sessionId, publicCode, phase, applyState]);

  const startRental = async () => {
    if (offline) { setStatusMsg({ title: "Connexion indisponible", sub: "Vérifiez la connexion Internet de la borne avant de payer." }); setPhase("error"); return; }
    setPhase("starting");
    try {
      const kioskToken = localStorage.getItem("kiosk_token");
      if (!kioskToken) {
        setStatusMsg({ title: "Borne non activée", sub: "Cette tablette n'est pas appairée. Contactez le support." });
        setPhase("error");
        return;
      }
      if (!idemRef.current) idemRef.current = crypto.randomUUID();
      const { data: sess } = await supabase.functions.invoke("create-rental-session", {
        body: { stationId, language: lang },
        headers: { "X-Kiosk-Token": kioskToken, "X-Idempotency-Key": idemRef.current },
      });
      if (!(sess as { ok?: boolean })?.ok) { setPhase("error"); return; }
      const rentalSessionId = (sess as { session: { id: string } }).session.id;
      setSessionId(rentalSessionId);
      const { data: co } = await supabase.functions.invoke("create-stripe-checkout", {
        body: { rentalSessionId, origin: window.location.origin },
        headers: { "X-Kiosk-Token": kioskToken },
      });
      const c = co as { ok?: boolean; checkout_url?: string; public_session_code?: string; expires_at?: string };
      if (!c?.ok || !c?.checkout_url) { setPhase("error"); return; }
      setCheckoutUrl(c.checkout_url);
      setPublicCode(c.public_session_code ?? null);
      setExpiresAt(c.expires_at ? new Date(c.expires_at).getTime() : null);
      setPhase("qr");
    } catch { setPhase("error"); }
  };

  const reset = () => {
    idemRef.current = null;
    setPhase("idle"); setCheckoutUrl(null); setSessionId(null);
    setPublicCode(null); setExpiresAt(null); setSlotNum(null); setStatusMsg(null);
    loadStation();
  };

  const available = station?.rentable_count ?? 0;
  const canRent = station?.online && available > 0 && configured && !offline;
  const fmtAmount = (a: number, c: string) => `${Number(a).toFixed(2)} ${c}`;
  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");

  if (mismatch && lockedStation) {
    return (
      <div className="relative grid min-h-screen place-items-center px-6 text-center">
        <LiquidBackground />
        <div className="glass-strong liquid-border flex max-w-md flex-col items-center gap-5 rounded-3xl p-8">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-warning/20"><Lock className="h-10 w-10 text-warning" /></div>
          <h1 className="font-display text-2xl font-bold">Borne verrouillée</h1>
          <p className="text-muted-foreground">
            Cette tablette est configurée pour la borne <span className="font-mono text-foreground">{lockedStation}</span>,
            mais l'URL demande <span className="font-mono text-foreground">{stationId}</span>.
          </p>
          <Button onClick={() => { window.location.href = `/kiosk/${lockedStation}`; }} className="rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold">
            Revenir à la borne {lockedStation}
          </Button>
          <button onClick={onLogoTap} className="text-xs text-muted-foreground/60">·</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-8 sm:px-12">
      <LiquidBackground />

      {offline && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-destructive/90 py-2 text-sm font-semibold text-destructive-foreground">
          <WifiOff className="h-4 w-4" />Connexion Internet indisponible — paiement temporairement impossible
        </div>
      )}

      {needRefresh && !offline && (
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-primary/80 py-1.5 text-xs font-medium text-primary-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          {busy ? "Mise à jour en attente (appliquée à la fin de l'opération)" : "Mise à jour en cours…"}
        </div>
      )}

      {showDiag && (
        <KioskDiagnostics
          stationId={stationId}
          lockedStation={lockedStation}
          lastSync={station?.last_sync_at ?? null}
          net={net}
          chargenowConfigured={configured}
          stationOnline={station?.online ?? null}
          swUrl={swUrl}
          needRefresh={needRefresh}
          onApplyUpdate={applyUpdate}
          onClose={() => setShowDiag(false)}
        />
      )}

      {showHelp && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8 text-left">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">Besoin d'aide ?</h2>
              <button onClick={() => setShowHelp(false)} aria-label="Fermer l'aide" className="rounded-full p-2 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ol className="space-y-3 text-muted-foreground">
              <li>1. Touchez « Louer une batterie ».</li>
              <li>2. Scannez le QR code avec votre téléphone et payez.</li>
              <li>3. Une batterie se libère automatiquement.</li>
              <li>4. Rendez-la dans n'importe quelle borne du réseau.</li>
            </ol>
            <p className="mt-5 text-sm text-muted-foreground">
              Un problème ? Contactez <span className="text-foreground">support@chargeurs.ch</span>
            </p>
            <Button onClick={() => setShowHelp(false)} className="mt-6 w-full rounded-full bg-gradient-primary py-5 text-lg font-bold">
              J'ai compris
            </Button>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between gap-3">
        <button onClick={onLogoTap} aria-label="Chargeurs.ch" className="cursor-default">
          <BrandLogo size="md" />
        </button>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowHelp(true)}
            variant="ghost"
            className="gap-2 rounded-full border border-border px-5 py-5 text-base"
            aria-label="Aide"
          >
            <HelpCircle className="h-5 w-5" />Aide
          </Button>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto flex min-h-[80vh] max-w-5xl flex-col items-center justify-center text-center">
        <AnimatePresence mode="wait">
          {phase === "loading" && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-xl text-muted-foreground">Chargement…</p>
            </motion.div>
          )}

          {phase === "idle" && station && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-8">
              <StatusBadge online={!!station.online} configured={!!configured} />
              <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-tight sm:text-7xl">
                Batterie nomade, à emporter
              </h1>
              <p className="max-w-2xl text-xl text-muted-foreground sm:text-2xl">
                Rechargez votre téléphone partout. Payez avec votre mobile.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <div className="glass liquid-border flex items-center gap-3 rounded-2xl px-6 py-4">
                  <BatteryCharging className="h-8 w-8 text-success" />
                  <div className="text-left">
                    <div className="text-3xl font-bold">{available}</div>
                    <div className="text-sm text-muted-foreground">disponibles</div>
                  </div>
                </div>
              </div>
              {canRent ? (
                <Button onClick={() => { goFullscreen(); setPhase("pricing"); }} className="h-auto rounded-full bg-gradient-primary px-12 py-6 text-2xl font-bold shadow-glow transition-transform hover:scale-105 active:scale-95">
                  Louer une batterie
                </Button>
              ) : (
                <div className="glass rounded-2xl px-8 py-5 text-lg text-warning">
                  {offline ? "Connexion indisponible" : !configured ? "API non configurée" : !station.online ? "Borne hors ligne" : "Aucune batterie disponible"}
                </div>
              )}
            </motion.div>
          )}

          {phase === "pricing" && quote && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-strong liquid-border flex w-full max-w-xl flex-col items-center gap-6 rounded-3xl p-8">
              <Clock className="h-12 w-12 text-primary" />
              <h2 className="font-display text-3xl font-bold">Tarif de location</h2>
              <div className="text-5xl font-extrabold">{fmtAmount(quote.amount, quote.currency)}</div>
              <p className="text-muted-foreground">Caution sécurisée. Le montant final est calculé au retour.</p>
              <div className="flex w-full gap-3">
                <Button variant="outline" onClick={() => setPhase("idle")} className="flex-1 rounded-full py-6 text-lg">Retour</Button>
                <Button onClick={startRental} className="flex-1 rounded-full bg-gradient-primary py-6 text-lg font-bold">Continuer</Button>
              </div>
            </motion.div>
          )}

          {phase === "pricing" && !quote && (
            <motion.div key="pricing-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-strong liquid-border flex max-w-lg flex-col items-center gap-5 rounded-3xl p-8">
              <AlertTriangle className="h-14 w-14 text-warning" />
              <h2 className="font-display text-2xl font-bold">Tarif indisponible</h2>
              <p className="text-muted-foreground">{quoteError ?? "La configuration tarifaire doit être vérifiée."}</p>
              <Button onClick={() => { loadQuote(); setPhase("idle"); }} className="rounded-full px-8">Réessayer</Button>
            </motion.div>
          )}

          {phase === "starting" && (
            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-5">
              <Loader2 className="h-14 w-14 animate-spin text-primary" />
              <h2 className="font-display text-2xl font-bold">Préparation du paiement…</h2>
            </motion.div>
          )}

          {phase === "qr" && checkoutUrl && (
            <motion.div key="qr" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass-strong liquid-border flex w-full max-w-xl flex-col items-center gap-6 rounded-3xl p-8">
              <QRCodeSVG value={checkoutUrl} size={260} includeMargin />
              <h2 className="font-display text-3xl font-bold">Scannez pour payer</h2>
              <p className="text-muted-foreground">Ouvrez l'appareil photo de votre téléphone et scannez ce QR code.</p>
              <div className="font-mono text-3xl font-bold">{mm}:{ss}</div>
              <div className="flex items-center gap-5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><CreditCard className="h-4 w-4" />Carte</span>
                <span className="flex items-center gap-1"><Smartphone className="h-4 w-4" />TWINT</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-4 w-4 text-success" />Stripe</span>
              </div>
              <Button variant="outline" onClick={reset} className="rounded-full px-8">Annuler</Button>
            </motion.div>
          )}

          {phase === "waitpay" && (
            <motion.div key="waitpay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-5">
              <Loader2 className="h-14 w-14 animate-spin text-primary" />
              <h2 className="font-display text-3xl font-bold">{statusMsg?.title ?? "Paiement en cours"}</h2>
              <p className="text-muted-foreground">{statusMsg?.sub ?? "Nous attendons la confirmation sécurisée."}</p>
            </motion.div>
          )}

          {phase === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6">
              <div className="grid h-28 w-28 place-items-center rounded-full bg-gradient-success shadow-glow-success"><CheckCircle2 className="h-16 w-16 text-success-foreground" /></div>
              <h2 className="font-display text-4xl font-extrabold">Batterie disponible</h2>
              <p className="text-xl text-muted-foreground">{slotNum ? `Retirez la batterie du compartiment ${slotNum}.` : "Retirez la batterie qui vient de se libérer."}</p>
            </motion.div>
          )}

          {(phase === "error" || phase === "support" || phase === "expired") && (
            <motion.div key={phase} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-strong liquid-border flex max-w-lg flex-col items-center gap-5 rounded-3xl p-8">
              <AlertTriangle className={`h-14 w-14 ${phase === "support" ? "text-warning" : "text-destructive"}`} />
              <h2 className="font-display text-3xl font-bold">{statusMsg?.title ?? (phase === "expired" ? "QR code expiré" : "Une erreur est survenue")}</h2>
              <p className="text-muted-foreground">{statusMsg?.sub ?? "Veuillez réessayer ou contacter le support."}</p>
              <Button onClick={reset} className="rounded-full px-8">Revenir à l'accueil</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StatusBadge({ online, configured }: { online: boolean; configured: boolean }) {
  const ok = online && configured;
  return (
    <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${ok ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
      {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {ok ? "Borne prête" : "Borne indisponible"}
    </div>
  );
}
