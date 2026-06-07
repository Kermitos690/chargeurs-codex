import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BatteryCharging, Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle, X,
  ShieldCheck, CreditCard, Smartphone, Clock, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";

type Station = {
  station_id: string; name: string; location_name: string | null;
  online: boolean; signal: number | null; rentable_count: number;
  price_per_period: number; currency: string; last_sync_at: string | null;
};
type Quote = {
  amount: number; currency: string; profile_name: string;
  final_cents: number; profile_id: string; source: string; error?: string;
};
type Phase = "loading" | "idle" | "pricing" | "starting" | "qr" | "waitpay" | "success" | "error" | "support" | "expired";

// Human messages per internal rental_session.state (FR — default kiosk lang).
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
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadStation = useCallback(async () => {
    if (!stationId) return;
    const { data } = await supabase.from("stations").select("*").eq("station_id", stationId).maybeSingle();
    setStation(data as Station | null);
    setPhase((p) => (p === "loading" ? "idle" : p));
  }, [stationId]);

  const loadQuote = useCallback(async () => {
    if (!stationId) return;
    // Real kiosk authentication: a provisioned tablet stores its individual
    // token in localStorage. The token is strictly bound to this station's id
    // server-side (kiosk_quote), so a kiosk cannot impersonate another station.
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
    loadStation();
    loadQuote();
    supabase.functions.invoke("sync-cabinet-status", { body: { stationId } })
      .then(({ data }) => { setConfigured((data as { configured?: boolean })?.configured ?? false); loadStation(); })
      .catch(() => setConfigured(false));
    const i = setInterval(loadStation, 15000);
    return () => clearInterval(i);
  }, [stationId, loadStation, loadQuote]);

  // Tick for the countdown.
  useEffect(() => {
    if (phase !== "qr") return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [phase]);

  // Local expiry of the QR.
  useEffect(() => {
    if (phase === "qr" && expiresAt && now >= expiresAt) setPhase("expired");
  }, [phase, expiresAt, now]);

  // Auto return to home after success (kiosk loop).
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => reset(), 12000);
    return () => clearTimeout(t);
  }, [phase]);

  // Best-effort fullscreen on first user interaction (kiosk tablets).
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

  // Poll the rental session status via a safe, scoped RPC (no direct table read:
  // rental_sessions is staff-only and exposes Stripe/financial data).
  useEffect(() => {
    if (!sessionId || !["qr", "waitpay", "starting"].includes(phase)) return;
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: sessionId });
      const r = data as { state?: string; selected_slot_num?: number | null } | null;
      if (r?.state) applyState(r.state, r.selected_slot_num ?? null);
    }, 3000);
    return () => clearInterval(poll);
  }, [sessionId, phase, applyState]);

  const startRental = async () => {
    setPhase("starting");
    try {
      const { data: sess } = await supabase.functions.invoke("create-rental-session", {
        body: { stationId, language: lang },
      });
      if (!(sess as { ok?: boolean })?.ok) { setPhase("error"); return; }
      const rentalSessionId = (sess as { session: { id: string } }).session.id;
      setSessionId(rentalSessionId);
      const { data: co } = await supabase.functions.invoke("create-stripe-checkout", {
        body: { rentalSessionId, origin: window.location.origin },
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
    setPhase("idle"); setCheckoutUrl(null); setSessionId(null);
    setPublicCode(null); setExpiresAt(null); setSlotNum(null); setStatusMsg(null);
    loadStation();
  };

  const available = station?.rentable_count ?? 0;
  const canRent = station?.online && available > 0 && configured;
  const fmtAmount = (a: number, c: string) => `${Number(a).toFixed(2)} ${c}`;
  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-8 sm:px-12">
      <LiquidBackground />
      <header className="flex items-center justify-between">
        <BrandLogo size="md" />
        <LanguageSwitcher />
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
                  {!configured ? "API non configurée" : !station.online ? "Borne hors ligne" : "Aucune batterie disponible"}
                </div>
              )}
            </motion.div>
          )}

          {phase === "pricing" && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-full max-w-md flex-col items-center gap-6">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">Confirmez votre location</h2>
              {quote ? (
                <div className="glass liquid-border w-full rounded-2xl p-8 text-center">
                  <div className="text-lg font-semibold">{quote.profile_name}</div>
                  <div className="mt-3 text-5xl font-bold text-gradient-cyan">{fmtAmount(quote.amount, quote.currency)}</div>
                  <div className="mt-2 text-sm text-muted-foreground">Tarif appliqué automatiquement à cette borne</div>
                </div>
              ) : (
                <p className="text-warning">
                  {quoteError === "KIOSK_AUTH_REQUIRED" || quoteError === "KIOSK_AUTH_INVALID"
                    ? "Borne non authentifiée — contactez l'exploitant."
                    : quoteError ? "Tarif non configuré pour cette borne." : "Chargement du tarif…"}
                </p>
              )}
              <div className="flex gap-3">
                <Button variant="ghost" onClick={reset}>Retour</Button>
                <Button onClick={startRental} disabled={!quote} className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold shadow-glow">
                  Payer {quote ? fmtAmount(quote.amount, quote.currency) : ""}
                </Button>
              </div>
            </motion.div>
          )}

          {phase === "starting" && (
            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-xl text-muted-foreground">Génération du paiement…</p>
            </motion.div>
          )}

          {phase === "qr" && checkoutUrl && (
            <motion.div key="qr" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5">
              {quote && (
                <div className="text-center">
                  <div className="text-lg font-semibold">{quote.profile_name}</div>
                  <div className="text-3xl font-bold text-gradient-cyan">{fmtAmount(quote.amount, quote.currency)}</div>
                </div>
              )}
              <h2 className="font-display text-2xl font-bold sm:text-3xl">Scannez ce QR code avec votre téléphone pour payer</h2>
              <div className="relative">
                <span className="absolute -inset-4 rounded-[2rem] bg-primary/30 blur-2xl animate-pulse-ring" />
                <div className="glass-strong liquid-border relative rounded-[2rem] bg-white p-6">
                  <QRCodeSVG value={checkoutUrl} size={300} bgColor="#ffffff" fgColor="#0a1024" level="M" marginSize={2} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 text-muted-foreground">
                <span className="inline-flex items-center gap-1"><CreditCard className="h-4 w-4" />Carte</span>
                <span className="inline-flex items-center gap-1"><Smartphone className="h-4 w-4" />Apple Pay</span>
                <span className="inline-flex items-center gap-1"><Smartphone className="h-4 w-4" />Google Pay</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4" />TWINT</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1 text-primary"><Clock className="h-4 w-4" />Expire dans {mm}:{ss}</span>
                {publicCode && <span className="font-mono text-muted-foreground">{publicCode}</span>}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />En attente du paiement…
              </div>
              <Button variant="ghost" onClick={reset} className="gap-2"><X className="h-4 w-4" />Annuler</Button>
            </motion.div>
          )}

          {phase === "waitpay" && (
            <motion.div key="waitpay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5">
              <Loader2 className="h-14 w-14 animate-spin text-primary" />
              <h2 className="font-display text-3xl font-bold">{statusMsg?.title ?? "Paiement reçu"}</h2>
              <p className="text-xl text-muted-foreground">{statusMsg?.sub ?? "Préparation de votre batterie…"}</p>
            </motion.div>
          )}

          {phase === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}
                className="grid h-40 w-40 place-items-center rounded-full bg-gradient-success shadow-glow-success">
                <CheckCircle2 className="h-24 w-24 text-success-foreground" />
              </motion.div>
              <h2 className="font-display text-4xl font-extrabold">Batterie libérée !</h2>
              <p className="text-xl text-muted-foreground">
                {slotNum ? `Retirez votre batterie dans le compartiment n° ${slotNum}.` : "Retirez votre batterie dans le compartiment ouvert."}
              </p>
              <Button onClick={reset} variant="ghost" className="mt-4"><RefreshCw className="h-5 w-5" /></Button>
            </motion.div>
          )}

          {phase === "expired" && (
            <motion.div key="expired" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
              <div className="grid h-28 w-28 place-items-center rounded-full bg-warning/20"><Clock className="h-14 w-14 text-warning" /></div>
              <h2 className="font-display text-3xl font-bold">QR code expiré</h2>
              <p className="max-w-xl text-lg text-muted-foreground">Ce QR code a expiré. Vous pouvez générer un nouveau paiement.</p>
              <Button onClick={() => setPhase("pricing")} className="gap-2 rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold">
                <RefreshCw className="h-5 w-5" />Générer un nouveau QR code
              </Button>
            </motion.div>
          )}

          {(phase === "error" || phase === "support") && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
              <div className={`grid h-32 w-32 place-items-center rounded-full ${phase === "support" ? "bg-warning/20" : "bg-destructive/20"}`}>
                <AlertTriangle className={`h-16 w-16 ${phase === "support" ? "text-warning" : "text-destructive"}`} />
              </div>
              <h2 className="font-display text-2xl font-bold">{statusMsg?.title ?? "Une erreur est survenue"}</h2>
              <p className="max-w-xl text-lg text-muted-foreground">{statusMsg?.sub ?? "Veuillez réessayer."}</p>
              <Button onClick={reset} className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold">Recommencer</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StatusBadge({ online, configured }: { online: boolean; configured: boolean }) {
  if (!configured) return (
    <div className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-warning">
      <WifiOff className="h-4 w-4" />API non configurée
    </div>
  );
  return (
    <div className={`glass inline-flex items-center gap-2 rounded-full px-4 py-2 ${online ? "text-success" : "text-muted-foreground"}`}>
      {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {online ? "En ligne" : "Hors ligne"}
    </div>
  );
}
