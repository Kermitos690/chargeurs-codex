import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle, X,
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
import { acceptsKioskStateVersion } from "@/lib/kioskStateVersion";
import { hourlyRateCents } from "@/lib/kioskPricing";
import { preferredKioskSlot } from "@/lib/kioskSlotSelection";
import { KioskHolographicFloor, PowerbankScene, SlotReleaseScene } from "@/components/kiosk/PowerbankScene";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";

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
  tiered?: boolean; tiers?: Array<{ upper_minutes: number; total_cents: number }>;
};
type KioskSlot = {
  slot_num: number;
  charge_percent: number | null;
  rentable: boolean;
  confidence: "high" | "medium" | "low";
  status: "ready" | "recommended" | "charging" | "checking" | "unavailable" | "return_available" | "technical_issue" | "maintenance";
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

const RELEASE_STATUS_POLL_MS = 700;
const RELEASE_FALLBACK_RECONCILE_MS = 2500;
const SUCCESS_HOME_DELAY_MS = 9500;

export default function Kiosk() {
  const { stationId } = useParams();
  const { lang, t } = useI18n();
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
  const [inactivitySeconds, setInactivitySeconds] = useState<number | null>(null);
  const [cancellingCheckout, setCancellingCheckout] = useState(false);
  const [cancelCheckoutError, setCancelCheckoutError] = useState<string | null>(null);
  const tapRef = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  const idemRef = useRef<string | null>(null);
  const seenStateVersionRef = useRef<number>(-1);
  const pollInFlightRef = useRef(false);
  const releaseFallbackAtRef = useRef(0);

  const net = useOnlineStatus();
  const offline = kioskTransportUnavailable(net, backendReachable);
  const { needRefresh, swUrl, applyUpdate } = useKioskPwa();
  const busy = ["starting", "qr", "waitpay", "success", "support"].includes(phase);

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
    const { data, error } = await supabase
      .from("stations")
      .select("id, station_id, name, location_name, status, online, rentable_count, returnable_count, total_count, currency, price_per_period, last_sync_at, created_at, updated_at, shop_id")
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
      tiered: Boolean(snap.tiered),
      tiers: Array.isArray(snap.tiers) ? snap.tiers.map((tier) => ({
        upper_minutes: Number((tier as Record<string, unknown>).upper_minutes),
        total_cents: Number((tier as Record<string, unknown>).total_cents),
      })) : [],
    });
  }, [stationId]);

  const loadSlots = useCallback(async () => {
    const token = readKioskToken();
    if (!stationId || !token) { setSnapshotError("KIOSK_AUTH_REQUIRED"); return; }
    const { data, transportError } = await invokeKioskEdgeProxy<KioskFunctionResponse & { slots?: KioskSlot[] }>(
      "/api/kiosk/cabinet-snapshot",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (transportError || !data?.ok || !Array.isArray(data.slots)) {
      setSnapshotError(data?.error ?? "SNAPSHOT_UNAVAILABLE");
      return;
    }
    const normalized = data.slots.slice(0, 4).sort((a, b) => a.slot_num - b.slot_num);
    setSlots(normalized);
    setSnapshotError(null);
    setConfigured(true);
    setBackendReachable(true);
    if (phase === "idle" || phase === "loading") {
      const suggestedSlotNum = preferredKioskSlot(normalized);
      setSlotNum((selected) => normalized.some((slot) => slot.slot_num === selected && slot.rentable) ? selected : suggestedSlotNum);
    }
  }, [stationId, phase]);

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
    seenStateVersionRef.current = -1;
    releaseFallbackAtRef.current = 0;
    setPhase("idle"); setCheckoutUrl(null); setSessionId(null);
    setPublicCode(null); setExpiresAt(null); setSlotNum(null); setStatusMsg(null); setFlowFailure(null);
    void refreshKioskData();
  }, [refreshKioskData]);

  const cancelCheckout = useCallback(async () => {
    if (phase !== "qr" || !sessionId || !stationId || cancellingCheckout) return;
    const token = readKioskToken();
    if (!token) {
      setCancelCheckoutError("KIOSK_AUTH_REQUIRED");
      return;
    }
    setCancellingCheckout(true);
    setCancelCheckoutError(null);
    const { data, transportError } = await invokeKioskEdgeProxy<KioskFunctionResponse>(
      "/api/kiosk/cancel-checkout",
      { rentalSessionId: sessionId },
      { "X-Kiosk-Token": token },
    );
    if (transportError || !data?.ok) {
      setCancelCheckoutError(data?.error ?? "CHECKOUT_CANCEL_FAILED");
      setCancellingCheckout(false);
      return;
    }
    setCancellingCheckout(false);
    window.dispatchEvent(new CustomEvent("chargeurs:kiosk-return-home"));
  }, [phase, sessionId, stationId, cancellingCheckout]);

  useEffect(() => {
    if (phase !== "idle") return;
    const interval = window.setInterval(() => void refreshKioskData(), 20_000);
    return () => window.clearInterval(interval);
  }, [phase, refreshKioskData]);

  useEffect(() => {
    const protectedFlow = ["starting", "qr", "waitpay", "success", "support"].includes(phase);
    if (phase === "idle" || phase === "loading" || protectedFlow) {
      setInactivitySeconds(null);
      return;
    }
    const deadline = Date.now() + 35_000;
    const refreshCountdown = () => setInactivitySeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    refreshCountdown();
    const interval = window.setInterval(refreshCountdown, 250);
    const timeout = window.setTimeout(reset, 35_000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [phase, reset]);

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
      const timer = setTimeout(() => { applyUpdate(); }, 4000);
      return () => clearTimeout(timer);
    }
  }, [needRefresh, busy, phase, applyUpdate]);

  useEffect(() => {
    if (phase !== "loading" && phase !== "idle") return;
    void refreshKioskData();
  }, [stationId, phase, refreshKioskData]);

  useEffect(() => {
    if (phase === "loading") return;
    try { (window as NativeKioskWindow).ChargeursNative?.kioskUiReady?.(); } catch { /* browser kiosk */ }
  }, [phase]);

  useEffect(() => {
    if (phase !== "qr") return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase === "qr" && expiresAt && now >= expiresAt) setPhase("expired");
  }, [phase, expiresAt, now]);

  useEffect(() => {
    if (phase !== "success") return;
    const timer = setTimeout(() => reset(), SUCCESS_HOME_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, reset]);

  const goFullscreen = useCallback(() => {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch(() => {});
  }, []);

  const applyState = useCallback((s: string, slot: number | null, failureCode?: string | null, stateVersion?: number | null) => {
    if (typeof stateVersion === "number") {
      if (!acceptsKioskStateVersion(seenStateVersionRef.current, stateVersion)) return;
      seenStateVersionRef.current = stateVersion;
    }
    if (s === "ejected" || s === "active_rental" || s === "battery_taken") {
      setSlotNum(slot);
      setStatusMsg(null);
      setPhase("success");
      return;
    }
    const presentation = kioskPaymentPresentation(s, failureCode);
    if (presentation) {
      setStatusMsg({ title: t(presentation.titleKey), sub: t(presentation.subtitleKey) });
      setPhase(presentation.phase);
    }
  }, [t]);

  // The normal fast path is now the exact ChargeNow BATTERY_BORROW_OUT push,
  // projected server-side into the rental state machine. The kiosk only reads
  // that scoped state every 700 ms. The old four-endpoint cabinet reconciliation
  // remains a throttled safety fallback; it never sends a second release.
  useEffect(() => {
    if (!sessionId || !publicCode || !["qr", "waitpay", "starting"].includes(phase)) return;
    let cancelled = false;
    const poll = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const { data } = await supabase.rpc("kiosk_session_status", { p_id: sessionId, p_code: publicCode });
        const rental = data as {
          state?: string; selected_slot_num?: number | null; failure_code?: string | null;
          state_version?: number | null;
        } | null;
        if (!cancelled && rental?.state) {
          applyState(rental.state, rental.selected_slot_num ?? null, rental.failure_code, rental.state_version);
        }

        if (
          !cancelled && phase === "waitpay" && rental?.state === "ejecting" &&
          Date.now() - releaseFallbackAtRef.current >= RELEASE_FALLBACK_RECONCILE_MS
        ) {
          releaseFallbackAtRef.current = Date.now();
          const kioskToken = readKioskToken();
          if (kioskToken) {
            void invokeKioskEdgeProxy("/api/kiosk/reconcile-pending-ejection", {
              stationId, rentalSessionId: sessionId, publicCode,
            }, { "X-Kiosk-Token": kioskToken });
          }
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), RELEASE_STATUS_POLL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [sessionId, publicCode, phase, stationId, applyState]);

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
    setPhase("starting");
    try {
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
      seenStateVersionRef.current = -1;
      releaseFallbackAtRef.current = 0;
      setSessionId(rentalSessionId);
      await requestCheckout(rentalSessionId);
    } catch {
      failFlow({ code: "RENTAL_SESSION_NETWORK_FAILURE", step: "create_rental_session", sessionId: sessionId ?? undefined });
    }
  };

  const available = slots.filter((slot) => slot.rentable).length || station?.rentable_count || 0;
  const canRent = available > 0 && configured && slotNum !== null;
  const connection = stationConnectionState(station ?? { status: null, online: null });
  const fmtAmount = (a: number, c: string) => `${Number(a).toFixed(2)} ${c}`;
  const fmtCents = (cents: number, currency = "CHF") => fmtAmount(cents / 100, currency);
  const hourlyCents = quote && !quote.tiered ? hourlyRateCents(quote.price_per_period_cents, quote.period_minutes) : null;
  const tierDuration = (minutes: number) => minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  const tierSummary = quote?.tiered ? (quote.tiers ?? []).map((tier) => `${tierDuration(tier.upper_minutes)} ${fmtCents(tier.total_cents, quote.currency)}`).join(" · ") : null;
  const pricingHeadline = quote?.tiered && quote.tiers?.[0]
    ? `Dès ${fmtCents(quote.tiers[0].total_cents, quote.currency)} / ${tierDuration(quote.tiers[0].upper_minutes)}`
    : hourlyCents != null ? `${fmtCents(hourlyCents, quote?.currency)} / ${t("kiosk.hour")}` : "—";
  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");

  const releaseCopy = {
    fr: {
      preparingEyebrow: "PAIEMENT CONFIRMÉ",
      preparingTitle: "Libération en cours",
      preparingSubtitle: slotNum ? `Le slot ${slotNum} s’ouvre maintenant.` : "Votre batterie est en cours de libération.",
      preparingNote: "Gardez les yeux sur le compartiment éclairé.",
      readyEyebrow: "BATTERIE PRÊTE",
      readyTitle: "Prenez votre batterie",
      readySubtitle: slotNum ? `Elle vous attend dans le slot ${slotNum}.` : "Prenez la batterie dans le compartiment éclairé.",
      marketing: "Vous êtes prêt. Restez chargé, où que vous alliez.",
      active: "Location active",
      home: "Retour à l’accueil automatique",
    },
    en: {
      preparingEyebrow: "PAYMENT CONFIRMED",
      preparingTitle: "Releasing now",
      preparingSubtitle: slotNum ? `Slot ${slotNum} is opening now.` : "Your powerbank is being released.",
      preparingNote: "Watch the illuminated compartment.",
      readyEyebrow: "POWERBANK READY",
      readyTitle: "Take your powerbank",
      readySubtitle: slotNum ? `It is waiting in slot ${slotNum}.` : "Take the powerbank from the illuminated compartment.",
      marketing: "You’re ready. Stay charged wherever you go.",
      active: "Rental active",
      home: "Returning to home automatically",
    },
    de: {
      preparingEyebrow: "ZAHLUNG BESTÄTIGT",
      preparingTitle: "Ausgabe läuft",
      preparingSubtitle: slotNum ? `Fach ${slotNum} öffnet sich jetzt.` : "Deine Powerbank wird ausgegeben.",
      preparingNote: "Achte auf das beleuchtete Fach.",
      readyEyebrow: "POWERBANK BEREIT",
      readyTitle: "Nimm deine Powerbank",
      readySubtitle: slotNum ? `Sie wartet in Fach ${slotNum}.` : "Nimm die Powerbank aus dem beleuchteten Fach.",
      marketing: "Bereit. Bleib geladen, wohin du auch gehst.",
      active: "Miete aktiv",
      home: "Automatische Rückkehr zum Start",
    },
  }[lang];

  if (mismatch && lockedStation) {
    return (
      <div className="relative grid min-h-screen place-items-center px-6 text-center">
        <LiquidBackground />
        <div className="glass-strong liquid-border flex max-w-md flex-col items-center gap-5 rounded-3xl p-8">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-warning/20"><Lock className="h-10 w-10 text-warning" /></div>
          <h1 className="font-display text-2xl font-bold">{t("kiosk.locked_title")}</h1>
          <p className="text-muted-foreground">{t("kiosk.locked_detail", { locked: lockedStation, requested: stationId ?? "—" })}</p>
          <Button onClick={() => { window.location.href = `/kiosk/${lockedStation}`; }} className="rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold">
            {t("kiosk.locked_return", { station: lockedStation })}
          </Button>
          <button onClick={onLogoTap} className="text-xs text-muted-foreground/60">·</button>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-root relative min-h-screen overflow-hidden px-5 py-4 sm:px-10 sm:py-5">
      <LiquidBackground />

      {offline && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-destructive/90 py-2 text-sm font-semibold text-destructive-foreground">
          <WifiOff className="h-4 w-4" />{t("kiosk.network_unavailable")}
        </div>
      )}

      {needRefresh && !offline && (
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-primary/80 py-1.5 text-xs font-medium text-primary-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          {busy ? t("kiosk.update_pending") : t("kiosk.update_running")}
        </div>
      )}

      {inactivitySeconds !== null && (
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="kiosk-inactivity-control fixed left-5 top-[4.7rem] z-50 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-2 text-sm font-bold shadow-lg backdrop-blur-xl sm:left-8 sm:top-[5.2rem]" aria-live="polite">
          <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>{t("kiosk.inactivity.return_in", { seconds: inactivitySeconds })}</span>
          <button type="button" onClick={reset} aria-label={t("kiosk.inactivity.close")} title={t("kiosk.inactivity.close")} className="ml-1 grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95">
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {showDiag && (
        <KioskDiagnostics stationId={stationId} lockedStation={lockedStation} lastSync={station?.last_sync_at ?? null} net={net} chargenowConfigured={configured} stationOnline={station?.online ?? null} stationStatus={station?.status ?? null} swUrl={swUrl} needRefresh={needRefresh} lastFailure={flowFailure} onApplyUpdate={applyUpdate} onClose={() => setShowDiag(false)} />
      )}

      {showHelp && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="glass-strong liquid-border w-full max-w-md rounded-3xl p-8 text-left">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">{t("kiosk.help.title")}</h2>
              <button onClick={() => setShowHelp(false)} aria-label={t("kiosk.help.close")} className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <ol className="space-y-3 text-muted-foreground">
              <li>1. {t("kiosk.help.step1")}</li><li>2. {t("kiosk.help.step2")}</li><li>3. {t("kiosk.help.step3")}</li><li>4. {t("kiosk.help.step4")}</li>
            </ol>
            <p className="mt-5 text-sm text-muted-foreground">{t("kiosk.help.contact", { email: BRAND.supportEmail })}</p>
            <Button onClick={() => setShowHelp(false)} className="mt-6 w-full rounded-full bg-gradient-primary py-5 text-lg font-bold">{t("kiosk.help.confirm")}</Button>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between gap-3">
        <button onClick={onLogoTap} aria-label="Chargeurs.ch" className="cursor-default"><BrandLogo size="md" /></button>
        <div className="flex items-center gap-2">
          <Button onClick={() => { void refreshKioskData(); }} variant="ghost" disabled={refreshing} className="gap-2 rounded-full border border-border px-4 py-5 text-base" aria-label={t("kiosk.refresh")} title={t("kiosk.refresh")}>
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} /><span>{t("kiosk.refresh")}</span>
          </Button>
          <Button onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))} variant="ghost" className="gap-2 rounded-full border border-border px-5 py-5 text-base" aria-label={t("kiosk.help")}>
            <HelpCircle className="h-5 w-5" />{t("kiosk.help")}
          </Button>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[100rem] flex-col items-center justify-center text-center">
        <AnimatePresence mode="wait">
          {phase === "loading" && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="text-xl text-muted-foreground">{t("kiosk.loading")}</p>
            </motion.div>
          )}

          {phase === "idle" && !station && (
            <motion.div key="idle-nostation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex max-w-xl flex-col items-center gap-5 text-center">
              <div className="grid h-24 w-24 place-items-center rounded-full bg-warning/20"><AlertTriangle className="h-12 w-12 text-warning" /></div>
              <h1 className="font-display text-3xl font-bold">{stationLoadError === "INVALID_STATION_ID" ? t("kiosk.invalid_station") : t("kiosk.unknown_station")}</h1>
              <p className="text-muted-foreground">{stationLoadError === "INVALID_STATION_ID" ? t("kiosk.invalid_station_detail") : t("kiosk.unknown_station_detail")}</p>
              {stationId && <p className="font-mono text-sm text-foreground">{t("kiosk.requested_station", { station: stationId })}</p>}
              <Button onClick={() => { setPhase("loading"); loadStation(); }} className="gap-2 rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold"><RefreshCw className="h-5 w-5" />{t("kiosk.retry")}</Button>
              <button onClick={onLogoTap} className="text-xs text-muted-foreground/60">·</button>
            </motion.div>
          )}

          {phase === "idle" && station && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`w-full ${splitLayoutPreview ? "grid max-w-[96rem] gap-4 lg:grid-cols-[1.35fr_.85fr] lg:items-stretch" : "flex max-w-[96rem] flex-col items-center gap-4"}`}>
              <section className={`kiosk-idle-stage relative isolate flex flex-col items-center overflow-hidden ${splitLayoutPreview ? "gap-3 rounded-[2rem] glass-strong liquid-border p-4" : "gap-3"}`}>
                <KioskHolographicFloor />
                <div className="kiosk-idle-hero relative z-10 flex flex-col items-center gap-3">
                  <h1 className={`font-display font-black leading-[.95] tracking-tight ${splitLayoutPreview ? "text-4xl" : "text-5xl sm:text-7xl"}`}>{t("kiosk.choose.title")}</h1>
                  <p className={`${splitLayoutPreview ? "text-lg" : "text-xl sm:text-2xl"} max-w-4xl font-medium text-muted-foreground`}>{t("kiosk.choose.subtitle")}</p>
                  {lastDataRefresh && <p className="text-sm text-muted-foreground">{t("kiosk.updated")}</p>}
                  {quote && <div className={`${splitLayoutPreview ? "text-2xl" : "text-3xl"} font-bold text-gradient-cyan`}>{pricingHeadline}</div>}
                </div>
                <div className="kiosk-slot-grid relative z-10 grid w-full max-w-5xl grid-cols-2 gap-5">
                  {([1, 3, 2, 4] as const).map((physicalSlotNum) => slots.find((slot) => slot.slot_num === physicalSlotNum) ?? {
                    slot_num: physicalSlotNum, charge_percent: null, rentable: false, confidence: "low" as const, status: "checking" as const, recommended: false,
                  }).map((slot, index) => {
                    const selected = slot.slot_num === slotNum;
                    return <motion.button key={slot.slot_num} type="button" disabled={!slot.rentable} onClick={() => { idemRef.current = null; setSlotNum(slot.slot_num); }} initial={{ opacity: 0, y: 18 }} animate={selected ? { opacity: 1, y: 0, scale: [1, 1.025, 1], boxShadow: ["0 0 0 rgba(59,130,246,0)", "0 0 34px rgba(34,211,238,.56)", "0 0 0 rgba(59,130,246,0)"] } : { opacity: 1, y: 0, scale: 1 }} transition={selected ? { duration: .65, ease: "easeOut" } : { delay: index * .05, duration: .3 }} whileTap={slot.rentable ? { scale: .96 } : undefined} className={`kiosk-slot-card glass liquid-border relative min-h-52 rounded-3xl p-5 text-left transition ${slot.rentable ? "hover:scale-[1.02]" : slot.status === "return_available" ? "cursor-default opacity-85" : "cursor-not-allowed opacity-60"} ${selected ? "ring-4 ring-primary shadow-glow" : ""}`}>
                      {slot.recommended && <span className="absolute right-3 top-3 rounded-full bg-success px-2 py-1 text-xs font-bold text-success-foreground">{t("kiosk.slot.recommended")}</span>}
                      {selected && <span className="absolute bottom-3 right-3 rounded-full bg-primary/20 px-2 py-1 text-xs font-bold text-primary">{t("kiosk.slot.selected")}</span>}
                      <div className="text-xl font-black text-foreground/90">{t("kiosk.slot.label", { slot: slot.slot_num })}</div>
                      <PowerbankScene charge={slot.charge_percent} selected={selected} recommended={slot.recommended} rentable={slot.rentable} returnAvailable={slot.status === "return_available"} />
                      {slot.status === "return_available" ? <><div className="mt-3 text-base font-bold text-cyan-100">{t("kiosk.slot.return_available")}</div><div className="mt-4 h-3 rounded-full bg-cyan-300/15" aria-hidden="true" /></> : slot.charge_percent == null ? <><div className="mt-3 text-base font-bold text-muted-foreground">{t("kiosk.slot.charge_unknown")}</div><div className="mt-4 h-3 rounded-full bg-muted/80" aria-hidden="true" /></> : <><div className="mt-2 text-5xl font-black tracking-tight">{`${Math.round(slot.charge_percent)}%`}</div><div className="mt-2 h-3 overflow-hidden rounded-full border border-white/10 bg-slate-950/45"><motion.div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-blue-500 to-violet-400 shadow-[0_0_18px_rgba(34,211,238,.85)]" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, slot.charge_percent))}%` }} transition={{ duration: .55, ease: "easeOut" }} /></div></>}
                      <div className="mt-3 text-base font-bold">{t(`kiosk.slot.${slot.status}`)}</div>
                    </motion.button>;
                  })}
                </div>
                {canRent ? (
                  <div className="kiosk-idle-cta relative z-10 flex flex-col items-center gap-2">
                    <Button onClick={() => { goFullscreen(); setPhase("pricing"); }} className="h-auto rounded-full bg-gradient-primary px-10 py-5 text-xl font-bold shadow-glow transition-transform hover:scale-105 active:scale-95">{t("kiosk.rent_selected")}</Button>
                    {quote && <span className="text-lg text-muted-foreground">{pricingHeadline}</span>}
                  </div>
                ) : (
                  <div className="relative z-10 glass rounded-2xl px-8 py-5 text-lg text-warning">{offline ? t("kiosk.connection_unavailable") : snapshotError ? t("kiosk.slot.unavailable") : !configured ? t("kiosk.api_not_configured") : !station.online ? t("kiosk.station_unverified") : slots.some((slot) => slot.status === "checking") ? t("kiosk.inventory_verifying") : t("kiosk.no_battery")}</div>
                )}
              </section>
              {splitLayoutPreview && <KioskAdvertisingPreview t={t} />}
            </motion.div>
          )}

          {phase === "pricing" && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="kiosk-pricing-stage flex w-full max-w-[82rem] flex-col items-center gap-7 px-4">
              <h2 className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">{t("kiosk.pricing.title")}</h2>
              {quote ? (
                <div className="kiosk-pricing-card glass liquid-border grid w-full max-w-6xl grid-cols-[.8fr_1.2fr] items-center gap-8 rounded-[2.25rem] p-8 text-center sm:p-10">
                  <div className="flex flex-col items-center gap-4 border-r border-white/15 pr-8"><div className="text-xl font-bold text-muted-foreground">{t("kiosk.slot.label", { slot: slotNum ?? "—" })}</div><div className="grid h-28 w-28 place-items-center rounded-[2rem] border border-primary/40 bg-primary/10 shadow-glow"><span className="font-display text-7xl font-extrabold text-gradient-cyan">{slotNum ?? "—"}</span></div></div>
                  <div><div className="font-display text-5xl font-extrabold leading-none text-gradient-cyan sm:text-6xl">{pricingHeadline}</div><p className="mt-5 text-xl font-semibold text-muted-foreground">{tierSummary ?? `${fmtCents(quote.price_per_period_cents, quote.currency)} / ${quote.period_minutes} ${t("kiosk.minutes")}`}</p>{quote.deposit_cents > 0 && <p className="mt-7 text-base text-muted-foreground">{t("kiosk.pricing.guarantee", { amount: fmtCents(quote.deposit_cents, quote.currency) })}</p>}</div>
                </div>
              ) : <p className="text-warning">{quoteError === "KIOSK_AUTH_REQUIRED" || quoteError === "KIOSK_AUTH_INVALID" ? t("kiosk.pricing.auth_error") : quoteError === "PRICING_NOT_CONFIGURED" ? t("kiosk.pricing.error") : quoteError ? t("kiosk.error.pricing.title") : t("kiosk.pricing.loading")}</p>}
              <div className="flex gap-5"><Button variant="ghost" onClick={reset} className="h-16 px-8 text-xl">{t("kiosk.back")}</Button><Button onClick={startRental} disabled={!quote || slotNum === null} className="h-16 rounded-full bg-gradient-primary px-14 text-2xl font-bold shadow-glow">{t("kiosk.rent_selected")}</Button></div>
            </motion.div>
          )}

          {phase === "starting" && (
            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6"><Loader2 className="h-20 w-20 animate-spin text-primary" /><p className="text-3xl font-bold text-muted-foreground">{t("kiosk.starting")}</p></motion.div>
          )}

          {phase === "qr" && checkoutUrl && (
            <motion.div key="qr" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="kiosk-qr-stage grid w-full max-w-[88rem] items-center gap-8 px-4 lg:grid-cols-[.85fr_1.15fr] lg:px-8">
              <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
                {quote && <div className="font-display text-5xl font-extrabold text-gradient-cyan sm:text-6xl">{pricingHeadline}</div>}
                <h2 className="mt-6 font-display text-5xl font-extrabold tracking-tight sm:text-6xl">{t("kiosk.qr.title")}</h2><p className="mt-4 text-2xl font-medium text-muted-foreground">{t("kiosk.qr.phone")}</p>
                <div className="mt-9 w-full rounded-[2rem] border border-white/15 bg-slate-950/20 p-6 text-left"><div className="flex items-center gap-3 text-xl font-bold"><Smartphone className="h-7 w-7 text-primary" />{t("kiosk.qr.methods")}</div><div className="mt-5"><KioskPaymentMarks cardLabel={t("kiosk.qr.card")} /></div><p className="mt-5 text-base text-muted-foreground">{t("kiosk.qr.eligibility")}</p></div>
              </div>
              <div className="flex flex-col items-center">
                <div className="relative"><span className="absolute -inset-7 rounded-[3rem] bg-primary/35 blur-3xl animate-pulse-ring" /><div className="glass-strong liquid-border relative rounded-[2.5rem] bg-white p-7 shadow-[0_0_55px_rgba(34,211,238,.42)]"><QRCodeSVG value={checkoutUrl} size={380} bgColor={BRAND.colors.qrBackground} fgColor={BRAND.colors.qrForeground} level="M" marginSize={2} /></div></div>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-lg"><span className="inline-flex items-center gap-2 font-semibold text-success"><ShieldCheck className="h-5 w-5" />{t("kiosk.qr.stripe")}</span><span className="inline-flex items-center gap-2 font-semibold text-primary"><Clock className="h-5 w-5" />{t("kiosk.qr.expires", { time: `${mm}:${ss}` })}</span></div>
                <div className="mt-4 flex items-center gap-2 text-lg text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />{t("kiosk.qr.waiting")}</div>
                <div className="mt-4 flex flex-col items-center gap-2">
                  <div className="flex items-center gap-4">{publicCode && <span className="font-mono text-xs text-muted-foreground">{publicCode}</span>}<Button variant="ghost" onClick={() => void cancelCheckout()} disabled={cancellingCheckout} className="h-12 gap-2 rounded-full px-6 text-lg">{cancellingCheckout ? <Loader2 className="h-5 w-5 animate-spin" /> : <X className="h-5 w-5" />}{cancellingCheckout ? (lang === "fr" ? "Annulation…" : lang === "de" ? "Abbruch…" : "Cancelling…") : t("kiosk.cancel")}</Button></div>
                  {cancelCheckoutError && <span className="text-sm font-semibold text-warning">{lang === "fr" ? "Annulation impossible pour le moment. Réessayez." : lang === "de" ? "Abbruch derzeit nicht möglich. Bitte erneut versuchen." : "Unable to cancel right now. Please try again."}</span>}
                </div>
              </div>
            </motion.div>
          )}

          {phase === "waitpay" && (
            <motion.div key="waitpay" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .985 }} className="kiosk-release-stage grid w-full max-w-[92rem] items-center gap-8 px-4 lg:grid-cols-[1.15fr_.85fr] lg:px-8">
              <SlotReleaseScene slotNum={slotNum} />
              <div className="relative flex min-h-[28rem] flex-col justify-center overflow-hidden rounded-[2.4rem] border border-cyan-200/15 bg-slate-950/20 p-9 text-left shadow-[0_30px_90px_rgba(0,0,0,.28),0_0_60px_rgba(34,211,238,.08)]">
                <motion.div aria-hidden className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" animate={{ scale: [1, 1.18, 1], opacity: [.4, .72, .4] }} transition={{ duration: 2.4, repeat: Infinity }} />
                <div className="relative inline-flex w-fit items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/[.07] px-4 py-2 text-sm font-black tracking-[.16em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{releaseCopy.preparingEyebrow}</div>
                <h2 className="relative mt-7 font-display text-5xl font-black leading-[.94] tracking-tight xl:text-6xl">{statusMsg?.title ?? releaseCopy.preparingTitle}</h2>
                <p className="relative mt-5 max-w-xl text-2xl font-medium leading-snug text-slate-200/80">{statusMsg?.sub ?? releaseCopy.preparingSubtitle}</p>
                <div className="relative mt-8 flex items-center gap-4">
                  <motion.div className="grid h-16 w-16 place-items-center rounded-2xl border border-cyan-200/25 bg-cyan-300/10" animate={{ boxShadow: ["0 0 12px rgba(34,211,238,.08)", "0 0 38px rgba(34,211,238,.3)", "0 0 12px rgba(34,211,238,.08)"] }} transition={{ duration: 1.3, repeat: Infinity }}><Zap className="h-8 w-8 text-cyan-100" /></motion.div>
                  <div><p className="text-base font-bold text-cyan-100">{slotNum ? t("kiosk.slot.label", { slot: slotNum }) : releaseCopy.preparingTitle}</p><p className="mt-1 text-base text-muted-foreground">{releaseCopy.preparingNote}</p></div>
                </div>
                <div className="relative mt-9 h-1.5 overflow-hidden rounded-full bg-white/8"><motion.div className="h-full w-[42%] rounded-full bg-gradient-to-r from-cyan-300 via-blue-500 to-violet-400 shadow-[0_0_20px_rgba(34,211,238,.7)]" animate={{ x: ["-110%", "255%"] }} transition={{ duration: 1.25, repeat: Infinity, ease: "easeInOut" }} /></div>
              </div>
            </motion.div>
          )}

          {phase === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="kiosk-ready-stage grid w-full max-w-[92rem] items-center gap-8 px-4 lg:grid-cols-[1.08fr_.92fr] lg:px-8">
              <div className="relative">
                <motion.div aria-hidden className="absolute left-1/2 top-1/2 h-[86%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/14 blur-[80px]" animate={{ scale: [.9, 1.12, .9], opacity: [.35, .72, .35] }} transition={{ duration: 2.4, repeat: Infinity }} />
                <SlotReleaseScene slotNum={slotNum} />
                <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 190, damping: 15 }} className="absolute -bottom-4 left-1/2 grid h-24 w-24 -translate-x-1/2 place-items-center rounded-full border-4 border-slate-950 bg-gradient-success shadow-[0_0_48px_rgba(74,222,128,.55)]"><CheckCircle2 className="h-14 w-14 text-success-foreground" /></motion.div>
              </div>
              <div className="relative overflow-hidden rounded-[2.5rem] border border-emerald-200/15 bg-slate-950/25 p-9 text-left shadow-[0_32px_100px_rgba(0,0,0,.32),0_0_65px_rgba(74,222,128,.08)]">
                <motion.div aria-hidden className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-400/18 blur-3xl" animate={{ scale: [1, 1.14, 1], opacity: [.42, .72, .42] }} transition={{ duration: 2.8, repeat: Infinity }} />
                <div className="relative inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-300/[.08] px-4 py-2 text-sm font-black tracking-[.16em] text-emerald-200"><Zap className="h-4 w-4" />{releaseCopy.readyEyebrow}</div>
                <h2 className="relative mt-7 font-display text-5xl font-black leading-[.92] tracking-tight xl:text-6xl">{releaseCopy.readyTitle}</h2>
                <p className="relative mt-5 text-2xl font-semibold text-slate-200/85">{releaseCopy.readySubtitle}</p>
                {slotNum && (
                  <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .12 }} className="relative mt-7 flex items-center gap-5 rounded-[1.8rem] border border-cyan-200/20 bg-cyan-300/[.06] p-5">
                    <span className="grid h-24 w-24 shrink-0 place-items-center rounded-[1.5rem] border border-cyan-100/35 bg-cyan-300/10 font-display text-6xl font-black text-cyan-100 shadow-[0_0_34px_rgba(34,211,238,.18)]">{slotNum}</span>
                    <div><p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-100/60">{t("kiosk.slot.label", { slot: slotNum })}</p><p className="mt-1 text-xl font-bold text-white">{releaseCopy.marketing}</p></div>
                  </motion.div>
                )}
                <div className="relative mt-7 flex items-center justify-between gap-4"><span className="inline-flex items-center gap-2 font-bold text-emerald-300"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.9)]" />{releaseCopy.active}</span><span className="text-sm text-muted-foreground">{releaseCopy.home}</span></div>
              </div>
            </motion.div>
          )}

          {phase === "expired" && (
            <motion.div key="expired" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6"><div className="grid h-28 w-28 place-items-center rounded-full bg-warning/20"><Clock className="h-14 w-14 text-warning" /></div><h2 className="font-display text-3xl font-bold">{t("kiosk.expired.title")}</h2><p className="max-w-xl text-lg text-muted-foreground">{t("kiosk.expired.detail")}</p><Button onClick={() => setPhase("pricing")} className="gap-2 rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold"><RefreshCw className="h-5 w-5" />{t("kiosk.expired.restart")}</Button></motion.div>
          )}

          {(phase === "error" || phase === "support") && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
              <div className={`grid h-32 w-32 place-items-center rounded-full ${phase === "support" ? "bg-warning/20" : "bg-destructive/20"}`}><AlertTriangle className={`h-16 w-16 ${phase === "support" ? "text-warning" : "text-destructive"}`} /></div>
              <h2 className="font-display text-2xl font-bold">{statusMsg?.title ?? t("kiosk.error.generic.title")}</h2><p className="max-w-xl text-lg text-muted-foreground">{statusMsg?.sub ?? t("kiosk.error.generic.subtitle")}</p>
              {flowFailure?.correlationId && <p className="font-mono text-xs text-muted-foreground">{t("kiosk.error.reference", { id: flowFailure.correlationId })}</p>}
              {flowFailure && <p className="text-xs text-muted-foreground">{t("kiosk.error.step", { step: flowFailure.step })}</p>}
              <Button onClick={() => { if (flowFailure?.step === "create_stripe_checkout" && flowFailure.sessionId) void requestCheckout(flowFailure.sessionId); else reset(); }} className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold">{flowFailure?.step === "create_stripe_checkout" ? t("kiosk.retry") : t("kiosk.restart")}</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StatusBadge({ connection, configured, t }: { connection: ReturnType<typeof stationConnectionState>; configured: boolean; t: (key: string) => string }) {
  if (!configured) return <div className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-warning"><WifiOff className="h-4 w-4" />{t("kiosk.api_not_configured")}</div>;
  return <div className={`glass inline-flex items-center gap-2 rounded-full px-4 py-2 ${connection === "online" ? "text-success" : connection === "unknown" ? "text-warning" : "text-muted-foreground"}`}>{connection === "online" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{connection === "online" ? t("kiosk.online") : connection === "unknown" ? t("kiosk.status_unknown") : t("kiosk.offline")}</div>;
}

function KioskAdvertisingPreview({ t }: { t: (key: string) => string }) {
  return (
    <aside className="relative min-h-[22rem] overflow-hidden rounded-[2rem] glass-strong liquid-border p-7 text-left">
      <motion.div aria-hidden className="absolute -right-16 -top-12 h-52 w-52 rounded-full bg-primary/40 blur-3xl" animate={{ x: [0, -25, 8, 0], y: [0, 22, -10, 0], scale: [1, 1.18, .92, 1] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div aria-hidden className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-accent/30 blur-3xl" animate={{ x: [0, 35, 0], y: [0, -20, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }} />
      <div className="relative flex h-full flex-col justify-between gap-8"><span className="w-fit rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{t("kiosk.ad.preview")}</span><div><motion.div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-primary shadow-glow" animate={{ rotate: [0, -4, 4, 0], scale: [1, 1.06, 1] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}><Zap className="h-8 w-8 text-primary-foreground" /></motion.div><h2 className="font-display text-4xl font-extrabold leading-tight">{t("kiosk.ad.title")}</h2><p className="mt-3 text-lg text-muted-foreground">{t("kiosk.ad.subtitle")}</p></div><div className="flex items-center gap-2 text-sm font-semibold text-primary"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success" />{t("kiosk.ad.footer")}</div></div>
    </aside>
  );
}
