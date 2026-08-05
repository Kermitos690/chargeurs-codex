import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BatteryCharging, Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle, X,
  ShieldCheck, Smartphone, Clock, RefreshCw, Lock, HelpCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { readKioskToken } from "@/lib/kioskFetch";
import { LiquidBackground } from "@/components/LiquidBackground";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useKioskPwa } from "@/pwa/useKioskPwa";
import { getLockedStation, lockStationIfUnset, isValidStationId } from "@/lib/kioskLock";
import { KioskDiagnostics } from "@/components/kiosk/KioskDiagnostics";
import { stationConnectionState } from "@/lib/stationConnection";
import { BRAND } from "@/config/brand";
import { kioskTransportUnavailable } from "@/lib/kioskConnectivity";

type Station = {
  station_id: string; name: string; location_name: string | null;
  status: string | null; online: boolean; rentable_count: number;
  price_per_period: number; currency: string; last_sync_at: string | null;
};
type Quote = {
  amount: number; currency: string; profile_name: string;
  final_cents: number; profile_id: string; source: string; error?: string;
  deposit_cents: number; period_minutes: number; price_per_period_cents: number;
  daily_cap_cents: number; unreturned_fee_cents: number;
};
type Phase = "loading" | "idle" | "pricing" | "starting" | "qr" | "waitpay" | "success" | "error" | "support" | "expired";
type NativeKioskWindow = Window & {
  ChargeursNative?: { kioskUiReady?: () => void };
};

type KioskFailure = {
  code: string;
  correlationId?: string;
  sessionId?: string;
  step: "create_rental_session" | "create_stripe_checkout" | "network";
};

type KioskFunctionResponse = {
  ok?: boolean;
  error?: string;
  correlationId?: string;
  correlation_id?: string;
};

const STATE_KEY: Record<string, { phase: Phase; key: string }> = {
  payment_succeeded: { phase: "waitpay", key: "kiosk.state.payment_succeeded" },
  ejecting: { phase: "waitpay", key: "kiosk.state.ejecting" },
  payment_failed: { phase: "error", key: "kiosk.state.payment_failed" },
  chargenow_failed: { phase: "support", key: "kiosk.state.chargenow_failed" },
  eject_failed: { phase: "support", key: "kiosk.state.eject_failed" },
  needs_support: { phase: "support", key: "kiosk.state.needs_support" },
  manual_review: { phase: "support", key: "kiosk.state.manual_review" },
  refunded: { phase: "error", key: "kiosk.state.refunded" },
  payment_expired: { phase: "expired", key: "kiosk.state.payment_expired" },
  payment_cancelled: { phase: "error", key: "kiosk.state.payment_cancelled" },
  cancelled: { phase: "error", key: "kiosk.state.cancelled" },
};

export default function Kiosk() {
  const { stationId } = useParams();
  const { lang, t } = useI18n();
  const [station, setStation] = useState<Station | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [slotNum, setSlotNum] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ title: string; sub: string } | null>(null);
  const [flowFailure, setFlowFailure] = useState<KioskFailure | null>(null);
  const [lockedStation, setLockedStation] = useState<string | null>(null);
  const [stationLoadError, setStationLoadError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const tapRef = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  // Stable idempotency key for ONE rental intent. Reused across network retries
  // so a double-tap / reconnection never creates duplicate sessions. Cleared on
  // reset (new intent gets a fresh key).
  const idemRef = useRef<string | null>(null);

  const net = useOnlineStatus();
  // A successful server health request wins over Android WebView's unreliable
  // navigator.onLine hint. The next sensitive request is still server-side
  // authenticated and fails closed if transport is actually unavailable.
  const offline = kioskTransportUnavailable(net, backendReachable);
  const { needRefresh, swUrl, applyUpdate } = useKioskPwa();

  // A payment / rental is in progress — block reloads, back navigation and
  // disruptive auto-updates during these phases.
  const busy = ["pricing", "starting", "qr", "waitpay"].includes(phase);

  // Hidden diagnostics trigger: 5 quick taps on the logo.
  const onLogoTap = useCallback(() => {
    const nowMs = Date.now();
    const r = tapRef.current;
    r.n = nowMs - r.t < 600 ? r.n + 1 : 1;
    r.t = nowMs;
    if (r.n >= 5) { r.n = 0; setShowDiag(true); }
  }, []);


  

  const loadStation = useCallback(async () => {
    if (!stationId || !isValidStationId(stationId)) {
      setStationLoadError("INVALID_STATION_ID");
      setPhase((p) => (p === "loading" ? "idle" : p));
      return;
    }
    // Anonymous kiosk clients can only read operational columns (raw_data is
    // restricted to the back-office), so we select explicit non-sensitive fields.
    const { data, error } = await supabase
      .from("stations")
      .select(
        "id, station_id, name, location_name, status, online, rentable_count, returnable_count, total_count, currency, price_per_period, last_sync_at, created_at, updated_at, shop_id",
      )
      .eq("station_id", stationId)
      .maybeSingle();
    if (error) {
      setBackendReachable(false);
      setStationLoadError(error.message || "STATION_QUERY_FAILED");
      setStation(null);
    } else if (!data) {
      setBackendReachable(true);
      setStationLoadError("STATION_NOT_FOUND");
      setStation(null);
    } else {
      setBackendReachable(true);
      setStationLoadError(null);
      setStation(data as Station);
    }
    setPhase((p) => (p === "loading" ? "idle" : p));
  }, [stationId]);

  const loadQuote = useCallback(async () => {
    if (!stationId) return;
    // The native wrapper supplies the individual token for this WebView
    // session. Browser-only maintenance keeps the explicit legacy fallback.
    // The server still binds the token to exactly one station.
    const token = readKioskToken();
    if (!token) {
      setQuote(null);
      setQuoteError("KIOSK_AUTH_REQUIRED");
      return;
    }
    const { data, error } = await supabase.rpc("kiosk_quote", { p_token: token, p_station: stationId });
    if (!error) setBackendReachable(true);
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
      deposit_cents: Number(snap.deposit_cents),
      period_minutes: Number(snap.period_minutes),
      price_per_period_cents: Number(snap.price_per_period_cents ?? snap.duration_cents),
      daily_cap_cents: Number(snap.daily_cap_cents),
      unreturned_fee_cents: Number(snap.unreturned_fee_cents),
    });
  }, [stationId]);

  const reset = useCallback(() => {
    idemRef.current = null;
    setPhase("idle"); setCheckoutUrl(null); setSessionId(null);
    setPublicCode(null); setExpiresAt(null); setSlotNum(null); setStatusMsg(null); setFlowFailure(null);
    void loadStation();
  }, [loadStation]);

  // Cabinet lock: bind this tablet to the cabinet on first open; afterwards a
  // different cabinet id in the URL is treated as a mismatch (no silent switch).
  useEffect(() => {
    if (!isValidStationId(stationId)) { setMismatch(false); setLockedStation(getLockedStation()); return; }
    const effective = lockStationIfUnset(stationId);
    setLockedStation(effective);
    setMismatch(!!effective && effective !== stationId);
  }, [stationId]);

  // Enable kiosk-mode (no zoom / select / pull-to-refresh) on the document.
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

  // Prevent accidental back / reload during an active payment or rental.
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

  // Auto-apply a pending app update only when idle (no rental / payment).
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
      .then(({ data, error }) => {
        setBackendReachable(!error);
        setConfigured((data as { configured?: boolean })?.configured ?? false);
        loadStation();
      })
      .catch(() => {
        setBackendReachable(false);
        setConfigured(false);
      });
    const i = setInterval(loadStation, 15000);
    return () => clearInterval(i);
  }, [stationId, loadStation, loadQuote]);

  // Tell the native host that React has rendered a usable kiosk state. This
  // avoids leaving an operator with a bare native background when an old or
  // disabled System WebView cannot execute the bundle.
  useEffect(() => {
    if (phase === "loading") return;
    try {
      (window as NativeKioskWindow).ChargeursNative?.kioskUiReady?.();
    } catch {
      // Browser kiosks intentionally have no native bridge.
    }
  }, [phase]);

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
  }, [phase, reset]);

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
    const m = STATE_KEY[s];
    if (m) { setStatusMsg({ title: t(`${m.key}.title`), sub: t(`${m.key}.subtitle`) }); setPhase(m.phase); }
  }, [t]);

  // Poll the rental session status via a safe, scoped RPC (no direct table read:
  // rental_sessions is staff-only and exposes Stripe/financial data).
  useEffect(() => {
    if (!sessionId || !publicCode || !["qr", "waitpay", "starting"].includes(phase)) return;
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: sessionId, p_code: publicCode });
      const r = data as { state?: string; selected_slot_num?: number | null } | null;
      if (r?.state) applyState(r.state, r.selected_slot_num ?? null);
    }, 3000);
    return () => clearInterval(poll);
  }, [sessionId, publicCode, phase, applyState]);

  const failFlow = useCallback((failure: KioskFailure) => {
    setFlowFailure(failure);
    const code = failure.code;
    const messageKey = code.startsWith("KIOSK_AUTH") || code === "KIOSK_STATION_MISMATCH"
      ? "kiosk.error.auth"
      : code.startsWith("PRICING") || code.startsWith("BETA_") || code === "CURRENCY_MISMATCH"
        ? "kiosk.error.pricing"
        : code.startsWith("STATION_")
          ? "kiosk.error.station"
          : code.startsWith("STRIPE_") || code.startsWith("SESSION_") || code.startsWith("SNAPSHOT_") || code.startsWith("PUBLIC_APP_URL")
            ? "kiosk.error.stripe"
            : failure.step === "network"
              ? "kiosk.error.network"
              : "kiosk.error.generic";
    setStatusMsg({ title: t(`${messageKey}.title`), sub: t(`${messageKey}.subtitle`) });
    setPhase("error");
  }, [t]);

  const requestCheckout = useCallback(async (rentalSessionId: string) => {
    const kioskToken = readKioskToken();
    if (!kioskToken) {
      failFlow({ code: "KIOSK_AUTH_REQUIRED", sessionId: rentalSessionId, step: "create_stripe_checkout" });
      return;
    }
    setPhase("starting");
    const { data: co, error: checkoutError } = await supabase.functions.invoke("create-stripe-checkout", {
      body: { rentalSessionId, origin: window.location.origin, language: lang },
      headers: { "X-Kiosk-Token": kioskToken },
    });
    const c = co as (KioskFunctionResponse & { checkout_url?: string; public_session_code?: string; expires_at?: string }) | null;
    if (checkoutError || !c?.ok || !c.checkout_url) {
      failFlow({
        code: c?.error ?? "STRIPE_CHECKOUT_REQUEST_FAILED",
        correlationId: c?.correlationId ?? c?.correlation_id,
        sessionId: rentalSessionId,
        step: "create_stripe_checkout",
      });
      return;
    }
    setFlowFailure(null);
    setCheckoutUrl(c.checkout_url);
    setPublicCode(c.public_session_code ?? null);
    setExpiresAt(c.expires_at ? new Date(c.expires_at).getTime() : null);
    setPhase("qr");
  }, [failFlow, lang]);

  const startRental = async () => {
    // Never create a rental/payment without a confirmed connection.
    if (offline) { failFlow({ code: "NETWORK_OFFLINE", step: "network" }); return; }
    setPhase("starting");
    try {
      // Kiosk credential: provisioned per-tablet token, sent ONLY in a header
      // (never in the URL). The server hashes it and binds it to this station.
      const kioskToken = readKioskToken();
      if (!kioskToken) {
        failFlow({ code: "KIOSK_AUTH_REQUIRED", step: "create_rental_session" });
        return;
      }
      if (!idemRef.current) idemRef.current = crypto.randomUUID();
      const { data: sess, error: sessionError } = await supabase.functions.invoke("create-rental-session", {
        body: { stationId, language: lang },
        headers: { "X-Kiosk-Token": kioskToken, "X-Idempotency-Key": idemRef.current },
      });
      const sessionResponse = sess as (KioskFunctionResponse & { session?: { id?: string } }) | null;
      if (sessionError || !sessionResponse?.ok || !sessionResponse.session?.id) {
        failFlow({
          code: sessionResponse?.error ?? "RENTAL_SESSION_REQUEST_FAILED",
          correlationId: sessionResponse?.correlationId ?? sessionResponse?.correlation_id,
          step: "create_rental_session",
        });
        return;
      }
      const rentalSessionId = sessionResponse.session.id;
      setSessionId(rentalSessionId);
      await requestCheckout(rentalSessionId);
    } catch {
      failFlow({ code: "NETWORK_OR_REQUEST_BLOCKED", step: "network", sessionId: sessionId ?? undefined });
    }
  };

  const available = station?.rentable_count ?? 0;
  const canRent = station?.online && available > 0 && configured && !offline;
  const inventoryReadable = Boolean(station?.online && configured && !offline);
  const connection = stationConnectionState(station ?? { status: null, online: null });
  const fmtAmount = (a: number, c: string) => `${Number(a).toFixed(2)} ${c}`;
  const fmtCents = (cents: number, currency = "CHF") => fmtAmount(cents / 100, currency);
  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");

  // Cabinet mismatch: this tablet is locked to another borne. Refuse to operate
  // and offer to return to the locked cabinet (no silent cross-borne switch).
  if (mismatch && lockedStation) {
    return (
      <div className="relative grid min-h-screen place-items-center px-6 text-center">
        <LiquidBackground />
        <div className="glass-strong liquid-border flex max-w-md flex-col items-center gap-5 rounded-3xl p-8">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-warning/20"><Lock className="h-10 w-10 text-warning" /></div>
          <h1 className="font-display text-2xl font-bold">{t("kiosk.locked_title")}</h1>
          <p className="text-muted-foreground">
            {t("kiosk.locked_detail", { locked: lockedStation, requested: stationId ?? "—" })}
          </p>
          <Button onClick={() => { window.location.href = `/kiosk/${lockedStation}`; }} className="rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold">
            {t("kiosk.locked_return", { station: lockedStation })}
          </Button>
          <button onClick={onLogoTap} className="text-xs text-muted-foreground/60">·</button>
        </div>
      </div>
    );
  }


  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-8 sm:px-12">
      <LiquidBackground />

      {/* Connectivity banner — blocks confidence in payment when offline. */}
      {offline && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-destructive/90 py-2 text-sm font-semibold text-destructive-foreground">
          <WifiOff className="h-4 w-4" />{t("kiosk.network_unavailable")}
        </div>
      )}

      {/* Discreet update status: only auto-applies when idle. */}
      {needRefresh && !offline && (
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-primary/80 py-1.5 text-xs font-medium text-primary-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          {busy ? t("kiosk.update_pending") : t("kiosk.update_running")}
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
          stationStatus={station?.status ?? null}
          swUrl={swUrl}
          needRefresh={needRefresh}
          lastFailure={flowFailure}
          onApplyUpdate={applyUpdate}
          onClose={() => setShowDiag(false)}
        />
      )}

      {/* Controlled kiosk help overlay (no free navigation menu). */}
      {showHelp && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8 text-left">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">{t("kiosk.help.title")}</h2>
              <button onClick={() => setShowHelp(false)} aria-label={t("kiosk.help.close")} className="rounded-full p-2 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ol className="space-y-3 text-muted-foreground">
              <li>1. {t("kiosk.help.step1")}</li>
              <li>2. {t("kiosk.help.step2")}</li>
              <li>3. {t("kiosk.help.step3")}</li>
              <li>4. {t("kiosk.help.step4")}</li>
            </ol>
            <p className="mt-5 text-sm text-muted-foreground">
              {t("kiosk.help.contact", { email: BRAND.supportEmail })}
            </p>
            <Button onClick={() => setShowHelp(false)} className="mt-6 w-full rounded-full bg-gradient-primary py-5 text-lg font-bold">
              {t("kiosk.help.confirm")}
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
            aria-label={t("kiosk.help")}
          >
            <HelpCircle className="h-5 w-5" />{t("kiosk.help")}
          </Button>
          <LanguageSwitcher />
        </div>
      </header>


      <main className="mx-auto flex min-h-[80vh] max-w-5xl flex-col items-center justify-center text-center">
        <AnimatePresence mode="wait">
          {phase === "loading" && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-xl text-muted-foreground">{t("kiosk.loading")}</p>
            </motion.div>
          )}

          {phase === "idle" && !station && (
            <motion.div key="idle-nostation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex max-w-xl flex-col items-center gap-5 text-center">
              <div className="grid h-24 w-24 place-items-center rounded-full bg-warning/20">
                <AlertTriangle className="h-12 w-12 text-warning" />
              </div>
              <h1 className="font-display text-3xl font-bold">
                {stationLoadError === "INVALID_STATION_ID" ? t("kiosk.invalid_station") : t("kiosk.unknown_station")}
              </h1>
              <p className="text-muted-foreground">
                {stationLoadError === "INVALID_STATION_ID"
                  ? t("kiosk.invalid_station_detail")
                  : t("kiosk.unknown_station_detail")}
              </p>
              {stationId && <p className="font-mono text-sm text-foreground">{t("kiosk.requested_station", { station: stationId })}</p>}
              <Button onClick={() => { setPhase("loading"); loadStation(); }} className="gap-2 rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold">
                <RefreshCw className="h-5 w-5" />{t("kiosk.retry")}
              </Button>
              <button onClick={onLogoTap} className="text-xs text-muted-foreground/60">·</button>
            </motion.div>
          )}


          {phase === "idle" && station && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-8">
              <StatusBadge connection={connection} configured={!!configured} t={t} />
              <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-tight sm:text-7xl">
                {t("kiosk.hero")}
              </h1>
              <p className="max-w-2xl text-xl text-muted-foreground sm:text-2xl">
                {t("kiosk.subtitle")}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <div className="glass liquid-border flex items-center gap-3 rounded-2xl px-6 py-4">
                  <BatteryCharging className="h-8 w-8 text-success" />
                  <div className="text-left">
                    <div className="text-3xl font-bold">{inventoryReadable ? available : "—"}</div>
                    <div className="text-sm text-muted-foreground">{inventoryReadable ? t("kiosk.available") : t("kiosk.inventory_unavailable")}</div>
                  </div>
                </div>
              </div>
              {canRent ? (
                <Button onClick={() => { goFullscreen(); setPhase("pricing"); }} className="h-auto rounded-full bg-gradient-primary px-12 py-6 text-2xl font-bold shadow-glow transition-transform hover:scale-105 active:scale-95">
                  {t("kiosk.cta")}
                </Button>
              ) : (
                <div className="glass rounded-2xl px-8 py-5 text-lg text-warning">
                  {offline ? t("kiosk.connection_unavailable") : !configured ? t("kiosk.api_not_configured") : !station.online ? t("kiosk.station_unverified") : t("kiosk.no_battery")}
                </div>
              )}
            </motion.div>
          )}

          {phase === "pricing" && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-full max-w-md flex-col items-center gap-6">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("kiosk.pricing.title")}</h2>
              {quote ? (
                <div className="glass liquid-border w-full rounded-2xl p-8 text-center">
                  <div className="text-lg font-semibold">{quote.profile_name}</div>
                  <div className="mt-3 text-5xl font-bold text-gradient-cyan">
                    {fmtCents(quote.price_per_period_cents, quote.currency)} / {quote.period_minutes} min
                  </div>
                  <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                    <p>{t("kiosk.pricing.guarantee", { amount: fmtCents(quote.deposit_cents, quote.currency) })}</p>
                    <p>{t("kiosk.pricing.daily_cap", { amount: fmtCents(quote.daily_cap_cents, quote.currency) })} · {t("kiosk.pricing.non_return", { amount: fmtCents(quote.unreturned_fee_cents, quote.currency) })}</p>
                    <p>{t("kiosk.pricing.settlement")}</p>
                  </div>
                </div>
              ) : (
                <p className="text-warning">
                  {quoteError === "KIOSK_AUTH_REQUIRED" || quoteError === "KIOSK_AUTH_INVALID"
                    ? t("kiosk.pricing.auth_error")
                    : quoteError ? t("kiosk.pricing.error") : t("kiosk.pricing.loading")}
                </p>
              )}
              <div className="flex gap-3">
                <Button variant="ghost" onClick={reset}>{t("kiosk.back")}</Button>
                <Button onClick={startRental} disabled={!quote} className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold shadow-glow">
                  {t("kiosk.continue", { amount: quote ? fmtCents(quote.deposit_cents, quote.currency) : "" })}
                </Button>
              </div>
            </motion.div>
          )}

          {phase === "starting" && (
            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-xl text-muted-foreground">{t("kiosk.starting")}</p>
            </motion.div>
          )}

          {phase === "qr" && checkoutUrl && (
            <motion.div key="qr" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5">
              {quote && (
                <div className="text-center">
                  <div className="text-lg font-semibold">{quote.profile_name}</div>
                  <div className="text-3xl font-bold text-gradient-cyan">{t("kiosk.pricing.guarantee", { amount: fmtCents(quote.deposit_cents, quote.currency) })}</div>
                  <div className="text-sm text-muted-foreground">{fmtCents(quote.price_per_period_cents, quote.currency)} / {quote.period_minutes} min</div>
                </div>
              )}
              <h2 className="font-display text-2xl font-bold sm:text-3xl">{t("kiosk.qr.title")}</h2>
              <p className="text-lg text-muted-foreground">{t("kiosk.qr.subtitle")}</p>
              <div className="relative">
                <span className="absolute -inset-4 rounded-[2rem] bg-primary/30 blur-2xl animate-pulse-ring" />
                <div className="glass-strong liquid-border relative rounded-[2rem] bg-white p-6">
                  <QRCodeSVG value={checkoutUrl} size={300} bgColor={BRAND.colors.qrBackground} fgColor={BRAND.colors.qrForeground} level="M" marginSize={2} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Smartphone className="h-4 w-4" />{t("kiosk.qr.methods")}</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4" />{t("kiosk.qr.stripe")}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1 text-primary"><Clock className="h-4 w-4" />{t("kiosk.qr.expires", { time: `${mm}:${ss}` })}</span>
                {publicCode && <span className="font-mono text-muted-foreground">{publicCode}</span>}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />{t("kiosk.qr.waiting")}
              </div>
              <Button variant="ghost" onClick={reset} className="gap-2"><X className="h-4 w-4" />{t("kiosk.cancel")}</Button>
            </motion.div>
          )}

          {phase === "waitpay" && (
            <motion.div key="waitpay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5">
              <Loader2 className="h-14 w-14 animate-spin text-primary" />
              <h2 className="font-display text-3xl font-bold">{statusMsg?.title ?? t("kiosk.state.payment_succeeded.title")}</h2>
              <p className="text-xl text-muted-foreground">{statusMsg?.sub ?? t("kiosk.state.payment_succeeded.subtitle")}</p>
            </motion.div>
          )}

          {phase === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}
                className="grid h-40 w-40 place-items-center rounded-full bg-gradient-success shadow-glow-success">
                <CheckCircle2 className="h-24 w-24 text-success-foreground" />
              </motion.div>
              <h2 className="font-display text-4xl font-extrabold">{t("kiosk.success.title")}</h2>
              <p className="text-xl text-muted-foreground">
                {slotNum ? t("kiosk.success.slot", { slot: slotNum }) : t("kiosk.success.generic")}
              </p>
              <Button onClick={reset} variant="ghost" className="mt-4"><RefreshCw className="h-5 w-5" /></Button>
            </motion.div>
          )}

          {phase === "expired" && (
            <motion.div key="expired" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
              <div className="grid h-28 w-28 place-items-center rounded-full bg-warning/20"><Clock className="h-14 w-14 text-warning" /></div>
              <h2 className="font-display text-3xl font-bold">{t("kiosk.expired.title")}</h2>
              <p className="max-w-xl text-lg text-muted-foreground">{t("kiosk.expired.detail")}</p>
              <Button onClick={() => setPhase("pricing")} className="gap-2 rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold">
                <RefreshCw className="h-5 w-5" />{t("kiosk.expired.restart")}
              </Button>
            </motion.div>
          )}

          {(phase === "error" || phase === "support") && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
              <div className={`grid h-32 w-32 place-items-center rounded-full ${phase === "support" ? "bg-warning/20" : "bg-destructive/20"}`}>
                <AlertTriangle className={`h-16 w-16 ${phase === "support" ? "text-warning" : "text-destructive"}`} />
              </div>
              <h2 className="font-display text-2xl font-bold">{statusMsg?.title ?? t("kiosk.error.generic.title")}</h2>
              <p className="max-w-xl text-lg text-muted-foreground">{statusMsg?.sub ?? t("kiosk.error.generic.subtitle")}</p>
              {flowFailure?.correlationId && <p className="font-mono text-xs text-muted-foreground">{t("kiosk.error.reference", { id: flowFailure.correlationId })}</p>}
              {flowFailure && <p className="text-xs text-muted-foreground">{t("kiosk.error.step", { step: flowFailure.step })}</p>}
              <Button
                onClick={() => {
                  if (flowFailure?.step === "create_stripe_checkout" && flowFailure.sessionId) {
                    void requestCheckout(flowFailure.sessionId);
                  } else {
                    reset();
                  }
                }}
                className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold"
              >
                {flowFailure?.step === "create_stripe_checkout" ? t("kiosk.retry") : t("kiosk.restart")}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StatusBadge({ connection, configured, t }: { connection: ReturnType<typeof stationConnectionState>; configured: boolean; t: (key: string) => string }) {
  if (!configured) return (
    <div className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-warning">
      <WifiOff className="h-4 w-4" />{t("kiosk.api_not_configured")}
    </div>
  );
  return (
    <div className={`glass inline-flex items-center gap-2 rounded-full px-4 py-2 ${connection === "online" ? "text-success" : connection === "unknown" ? "text-warning" : "text-muted-foreground"}`}>
      {connection === "online" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {connection === "online" ? t("kiosk.online") : connection === "unknown" ? t("kiosk.status_unknown") : t("kiosk.offline")}
    </div>
  );
}
