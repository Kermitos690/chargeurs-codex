import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BatteryCharging, Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle, X,
  ShieldCheck, Smartphone, Clock, RefreshCw, Lock, HelpCircle,
  Zap,
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
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import { createKioskIdempotencyKey } from "@/lib/kioskIdempotency";
import { kioskPaymentPresentation } from "@/lib/kioskPaymentState";
import { hourlyRateCents } from "@/lib/kioskPricing";

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
type KioskSlot = {
  slot_num: number;
  charge_percent: number | null;
  rentable: boolean;
  confidence: "high" | "medium" | "low";
  status: "ready" | "recommended" | "charging" | "checking" | "unavailable" | "maintenance";
  recommended: boolean;
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

export default function Kiosk() {
  const { stationId } = useParams();
  const { lang, t } = useI18n();
  // This is deliberately an opt-in staging preview. A real campaign feed will
  // replace the demo panel only after operator-managed media is available.
  const splitLayoutPreview = new URLSearchParams(window.location.search).get("layout") === "split";
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
  const [slots, setSlots] = useState<KioskSlot[]>([]);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ title: string; sub: string } | null>(null);
  const [flowFailure, setFlowFailure] = useState<KioskFailure | null>(null);
  const [lockedStation, setLockedStation] = useState<string | null>(null);
  const [stationLoadError, setStationLoadError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDataRefresh, setLastDataRefresh] = useState<number | null>(null);
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

  // The kiosk never infers a rentable battery from a single stale count. This
  // server-side, station-bound snapshot merges the documented C4/C7/C8 reads.
  const loadSlots = useCallback(async () => {
    const token = readKioskToken();
    if (!stationId || !token) { setSnapshotError("KIOSK_AUTH_REQUIRED"); return; }
    const { data, transportError } = await invokeKioskEdgeProxy<KioskFunctionResponse & {
      slots?: KioskSlot[];
    }>("/api/kiosk/cabinet-snapshot", { stationId }, { "X-Kiosk-Token": token });
    if (transportError || !data?.ok || !Array.isArray(data.slots)) {
      setSnapshotError(data?.error ?? "SNAPSHOT_UNAVAILABLE");
      return;
    }
    const normalized = data.slots.slice(0, 4).sort((a, b) => a.slot_num - b.slot_num);
    setSlots(normalized);
    setSnapshotError(null);
    setConfigured(true);
    setBackendReachable(true);
    const suggested = normalized.find((slot) => slot.recommended && slot.rentable) ?? normalized.find((slot) => slot.rentable);
    setSlotNum((selected) => normalized.some((slot) => slot.slot_num === selected && slot.rentable) ? selected : suggested?.slot_num ?? null);
  }, [stationId]);

  // A visible refresh must never reload the WebView or reset a Checkout QR.
  // It performs only authenticated, read-only refreshes; payment/ejection state
  // continues to be owned by the existing server polling loop.
  const refreshKioskData = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadStation(), loadQuote(), loadSlots()]);
      setLastDataRefresh(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [loadStation, loadQuote, loadSlots]);

  const reset = useCallback(() => {
    idemRef.current = null;
    setPhase("idle"); setCheckoutUrl(null); setSessionId(null);
    setPublicCode(null); setExpiresAt(null); setSlotNum(null); setStatusMsg(null); setFlowFailure(null);
    void refreshKioskData();
  }, [refreshKioskData]);

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

    void refreshKioskData();
    const i = setInterval(() => { void refreshKioskData(); }, 15000);
    return () => clearInterval(i);
  }, [stationId, refreshKioskData]);

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

  const applyState = useCallback((s: string, slot: number | null, failureCode?: string | null) => {
    if (s === "ejected" || s === "active_rental" || s === "battery_taken") {
      setSlotNum(slot); setPhase("success"); return;
    }
    const presentation = kioskPaymentPresentation(s, failureCode);
    if (presentation) {
      setStatusMsg({ title: t(presentation.titleKey), sub: t(presentation.subtitleKey) });
      setPhase(presentation.phase);
    }
  }, [t]);

  // Poll the rental session status via a safe, scoped RPC (no direct table read:
  // rental_sessions is staff-only and exposes Stripe/financial data).
  useEffect(() => {
    if (!sessionId || !publicCode || !["qr", "waitpay", "starting"].includes(phase)) return;
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: sessionId, p_code: publicCode });
      const r = data as { state?: string; selected_slot_num?: number | null; failure_code?: string | null } | null;
      if (r?.state) applyState(r.state, r.selected_slot_num ?? null, r.failure_code);
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
    const { data: co, transportError: checkoutTransportError } = await invokeKioskEdgeProxy<KioskFunctionResponse & {
      checkout_url?: string; public_session_code?: string; expires_at?: string;
    }>("/api/kiosk/create-stripe-checkout", {
      rentalSessionId, origin: window.location.origin, language: lang,
    }, { "X-Kiosk-Token": kioskToken });
    const c = co as (KioskFunctionResponse & { checkout_url?: string; public_session_code?: string; expires_at?: string }) | null;
    if (checkoutTransportError || !c?.ok || !c.checkout_url) {
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
    // Do not make the rental decision from `navigator.onLine`. Android System
    // WebView can report false while HTTPS calls still work through the kiosk
    // modem/VPN. The authenticated Edge Function is the authoritative, fail-
    // closed connectivity check: it either creates one idempotent session or
    // returns a safe correlated refusal. No payment or hardware command is
    // possible before that server-side check succeeds.
    setPhase("starting");
    try {
      // Kiosk credential: provisioned per-tablet token, sent ONLY in a header
      // (never in the URL). The server hashes it and binds it to this station.
      const kioskToken = readKioskToken();
      if (!kioskToken) {
        failFlow({ code: "KIOSK_AUTH_REQUIRED", step: "create_rental_session" });
        return;
      }
      if (!idemRef.current) idemRef.current = createKioskIdempotencyKey();
      const { data: sess, transportError: sessionTransportError } = await invokeKioskEdgeProxy<KioskFunctionResponse & {
        session?: { id?: string };
      }>("/api/kiosk/create-rental-session", { stationId, language: lang, selectedSlotNum: slotNum }, {
        "X-Kiosk-Token": kioskToken,
        "X-Idempotency-Key": idemRef.current,
      });
      const sessionResponse = sess as (KioskFunctionResponse & { session?: { id?: string } }) | null;
      if (sessionTransportError || !sessionResponse?.ok || !sessionResponse.session?.id) {
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
      // Keep the failure tied to the request that failed. This must never be
      // presented as a generic browser-offline state: operators need to know
      // that the rental-session request itself did not reach the backend.
      failFlow({ code: "RENTAL_SESSION_NETWORK_FAILURE", step: "create_rental_session", sessionId: sessionId ?? undefined });
    }
  };

  const available = slots.filter((slot) => slot.rentable).length || station?.rentable_count || 0;
  // Availability comes from the authenticated backend snapshot. A WebView
  // browser hint is never allowed to hide rentable batteries or pre-empt the
  // server-side availability check.
  const canRent = available > 0 && configured && slotNum !== null;
  const inventoryReadable = Boolean(configured && slots.length);
  const connection = stationConnectionState(station ?? { status: null, online: null });
  const fmtAmount = (a: number, c: string) => `${Number(a).toFixed(2)} ${c}`;
  const fmtCents = (cents: number, currency = "CHF") => fmtAmount(cents / 100, currency);
  const hourlyCents = quote ? hourlyRateCents(quote.price_per_period_cents, quote.period_minutes) : null;
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
            onClick={() => { void refreshKioskData(); }}
            variant="ghost"
            disabled={refreshing}
            className="gap-2 rounded-full border border-border px-4 py-5 text-base"
            aria-label={t("kiosk.refresh")}
            title={t("kiosk.refresh")}
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{t("kiosk.refresh")}</span>
          </Button>
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
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`w-full ${splitLayoutPreview ? "grid max-w-6xl gap-6 lg:grid-cols-[1.35fr_.85fr] lg:items-stretch" : "flex max-w-4xl flex-col items-center gap-6"}`}>
              <section className={`flex flex-col items-center ${splitLayoutPreview ? "gap-4 rounded-[2rem] glass-strong liquid-border p-5" : "gap-6"}`}>
                <h1 className={`font-display font-extrabold leading-tight ${splitLayoutPreview ? "text-3xl" : "text-4xl sm:text-6xl"}`}>{t("kiosk.choose.title")}</h1>
                <p className={`${splitLayoutPreview ? "text-lg" : "text-xl sm:text-2xl"} text-muted-foreground`}>{t("kiosk.choose.subtitle")}</p>
                {lastDataRefresh && <p className="text-sm text-muted-foreground">{t("kiosk.updated")}</p>}
                {hourlyCents != null && <div className={`${splitLayoutPreview ? "text-2xl" : "text-3xl sm:text-4xl"} font-bold text-gradient-cyan`}>{fmtCents(hourlyCents, quote?.currency)} / {t("kiosk.hour")}</div>}
              <div className={`grid w-full grid-cols-2 gap-4 ${splitLayoutPreview ? "" : "sm:grid-cols-4"}`}>
                {Array.from({ length: 4 }, (_, index) => slots.find((slot) => slot.slot_num === index + 1) ?? {
                  slot_num: index + 1, charge_percent: null, rentable: false, confidence: "low" as const, status: "checking" as const, recommended: false,
                }).map((slot, index) => {
                  const selected = slot.slot_num === slotNum;
                  return <motion.button key={slot.slot_num} type="button" disabled={!slot.rentable}
                    onClick={() => { idemRef.current = null; setSlotNum(slot.slot_num); }}
                    initial={{ opacity: 0, y: 18 }}
                    animate={selected
                      ? { opacity: 1, y: 0, scale: [1, 1.025, 1], boxShadow: ["0 0 0 rgba(59,130,246,0)", "0 0 34px rgba(34,211,238,.56)", "0 0 0 rgba(59,130,246,0)"] }
                      : { opacity: 1, y: 0, scale: 1 }}
                    transition={selected ? { duration: .65, ease: "easeOut" } : { delay: index * .05, duration: .3 }}
                    whileTap={slot.rentable ? { scale: .96 } : undefined}
                    className={`glass liquid-border relative min-h-52 rounded-3xl p-5 text-left transition ${slot.rentable ? "hover:scale-[1.02]" : "cursor-not-allowed opacity-60"} ${selected ? "ring-4 ring-primary shadow-glow" : ""}`}>
                    {slot.recommended && <span className="absolute right-3 top-3 rounded-full bg-success px-2 py-1 text-xs font-bold text-success-foreground">{t("kiosk.slot.recommended")}</span>}
                    {selected && <span className="absolute bottom-3 right-3 rounded-full bg-primary/20 px-2 py-1 text-xs font-bold text-primary">{t("kiosk.slot.selected")}</span>}
                    <div className="text-sm font-semibold text-muted-foreground">{t("kiosk.slot.label", { slot: slot.slot_num })}</div>
                    <motion.div animate={slot.rentable ? { y: [0, -2, 0] } : undefined} transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}>
                      <BatteryCharging className={`mt-4 h-10 w-10 ${slot.rentable ? "text-success" : "text-muted-foreground"}`} />
                    </motion.div>
                    {slot.charge_percent == null ? <>
                      <div className="mt-3 text-base font-bold text-muted-foreground">{t("kiosk.slot.charge_unknown")}</div>
                      <div className="mt-4 h-3 rounded-full bg-muted/80" aria-hidden="true" />
                    </> : <>
                      <div className="mt-3 text-4xl font-extrabold">{`${Math.round(slot.charge_percent)}%`}</div>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-gradient-primary" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, slot.charge_percent))}%` }} transition={{ duration: .55, ease: "easeOut" }} /></div>
                    </>}
                    <div className="mt-3 text-sm font-semibold">{t(`kiosk.slot.${slot.status}`)}</div>
                  </motion.button>;
                })}
              </div>
              {canRent ? (
                <div className="flex flex-col items-center gap-2">
                  <Button onClick={() => { goFullscreen(); setPhase("pricing"); }} className="h-auto rounded-full bg-gradient-primary px-12 py-6 text-2xl font-bold shadow-glow transition-transform hover:scale-105 active:scale-95">
                    {t("kiosk.rent_selected")}
                  </Button>
                  {hourlyCents != null && <span className="text-lg text-muted-foreground">{fmtCents(hourlyCents, quote?.currency)} / {t("kiosk.hour")}</span>}
                </div>
              ) : (
                <div className="glass rounded-2xl px-8 py-5 text-lg text-warning">
                  {offline ? t("kiosk.connection_unavailable") : snapshotError ? t("kiosk.slot.unavailable") : !configured ? t("kiosk.api_not_configured") : !station.online ? t("kiosk.station_unverified") : slots.some((slot) => slot.status === "checking") ? t("kiosk.inventory_verifying") : t("kiosk.no_battery")}
                </div>
              )}
              </section>
              {splitLayoutPreview && <KioskAdvertisingPreview t={t} />}
            </motion.div>
          )}

          {phase === "pricing" && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-full max-w-md flex-col items-center gap-6">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("kiosk.pricing.title")}</h2>
              {quote ? (
                <div className="glass liquid-border w-full rounded-2xl p-8 text-center">
                  <div className="text-lg font-semibold">{t("kiosk.slot.label", { slot: slotNum ?? "—" })}</div>
                  <div className="mt-3 text-5xl font-bold text-gradient-cyan">{hourlyCents != null ? `${fmtCents(hourlyCents, quote.currency)} / ${t("kiosk.hour")}` : "—"}</div>
                  <p className="mt-3 text-sm text-muted-foreground">{fmtCents(quote.price_per_period_cents, quote.currency)} / {quote.period_minutes} {t("kiosk.minutes")}</p>
                  <p className="mt-5 text-sm text-muted-foreground">{t("kiosk.pricing.guarantee", { amount: fmtCents(quote.deposit_cents, quote.currency) })}</p>
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
                <Button onClick={startRental} disabled={!quote || slotNum === null} className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold shadow-glow">
                  {t("kiosk.rent_selected")}
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
                <div className="text-center"><div className="text-4xl font-bold text-gradient-cyan">{hourlyCents != null ? `${fmtCents(hourlyCents, quote.currency)} / ${t("kiosk.hour")}` : "—"}</div></div>
              )}
              <h2 className="font-display text-2xl font-bold sm:text-3xl">{t("kiosk.qr.title")}</h2>
              <p className="text-lg text-muted-foreground">{t("kiosk.qr.phone")}</p>
              <div className="relative">
                <span className="absolute -inset-4 rounded-[2rem] bg-primary/30 blur-2xl animate-pulse-ring" />
                <div className="glass-strong liquid-border relative rounded-[2rem] bg-white p-6">
                  <QRCodeSVG value={checkoutUrl} size={300} bgColor={BRAND.colors.qrBackground} fgColor={BRAND.colors.qrForeground} level="M" marginSize={2} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 text-muted-foreground">
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
              {slotNum ? <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass liquid-border rounded-[2rem] px-14 py-7 text-center shadow-glow">
                <p className="text-xl text-muted-foreground">{t("kiosk.success.slot", { slot: slotNum })}</p>
                <motion.p animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} className="mt-2 font-display text-7xl font-extrabold text-gradient-cyan">{slotNum}</motion.p>
              </motion.div> : <p className="text-xl text-muted-foreground">{t("kiosk.success.generic")}</p>}
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

/**
 * Staging-only visual proof for the future advertising area. It has no remote
 * media URL, analytics or provider-side advertisement mutation: the kiosk can
 * therefore be tested safely before a partner campaign is configured.
 */
function KioskAdvertisingPreview({ t }: { t: (key: string) => string }) {
  return (
    <aside className="relative min-h-[22rem] overflow-hidden rounded-[2rem] glass-strong liquid-border p-7 text-left">
      <motion.div aria-hidden className="absolute -right-16 -top-12 h-52 w-52 rounded-full bg-primary/40 blur-3xl"
        animate={{ x: [0, -25, 8, 0], y: [0, 22, -10, 0], scale: [1, 1.18, .92, 1] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div aria-hidden className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-accent/30 blur-3xl"
        animate={{ x: [0, 35, 0], y: [0, -20, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }} />
      <div className="relative flex h-full flex-col justify-between gap-8">
        <span className="w-fit rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{t("kiosk.ad.preview")}</span>
        <div>
          <motion.div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-primary shadow-glow"
            animate={{ rotate: [0, -4, 4, 0], scale: [1, 1.06, 1] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}>
            <Zap className="h-8 w-8 text-primary-foreground" />
          </motion.div>
          <h2 className="font-display text-4xl font-extrabold leading-tight">{t("kiosk.ad.title")}</h2>
          <p className="mt-3 text-lg text-muted-foreground">{t("kiosk.ad.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success" />{t("kiosk.ad.footer")}</div>
      </div>
    </aside>
  );
}
