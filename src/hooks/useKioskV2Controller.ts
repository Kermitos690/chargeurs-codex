import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readKioskToken } from "@/lib/kioskFetch";
import { getLockedStation, isValidStationId, lockStationIfUnset } from "@/lib/kioskLock";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useKioskPwa } from "@/pwa/useKioskPwa";

export type KioskV2Phase = "loading" | "idle" | "pricing" | "starting" | "qr" | "waitpay" | "success" | "error" | "support" | "expired";

export type KioskV2Station = {
  station_id: string;
  name: string;
  location_name: string | null;
  online: boolean;
  rentable_count: number;
  returnable_count?: number;
  total_count?: number;
  price_per_period: number;
  currency: string;
  last_sync_at: string | null;
};

export type KioskV2Quote = {
  amount: number;
  currency: string;
  profile_name: string;
  final_cents: number;
  profile_id: string;
  source: string;
  deposit_cents: number;
  period_minutes: number;
  price_per_period_cents: number;
  daily_cap_cents: number;
  unreturned_fee_cents: number;
};

type StatusMessage = { title: string; sub: string };

const STATE_MESSAGES: Record<string, { phase: KioskV2Phase; message: StatusMessage }> = {
  payment_succeeded: { phase: "waitpay", message: { title: "Paiement reçu", sub: "Préparation sécurisée de votre batterie…" } },
  ejecting: { phase: "waitpay", message: { title: "Libération en cours", sub: "Le compartiment est en cours d'ouverture." } },
  payment_failed: { phase: "error", message: { title: "Paiement non abouti", sub: "Aucun débit ne sera effectué automatiquement." } },
  chargenow_failed: { phase: "support", message: { title: "Vérification en cours", sub: "Votre paiement est sécurisé et notre équipe contrôle la borne." } },
  eject_failed: { phase: "support", message: { title: "Intervention requise", sub: "Le compartiment n'a pas répondu. Votre paiement reste protégé." } },
  needs_support: { phase: "support", message: { title: "Assistance déclenchée", sub: "Une vérification est en cours. Votre paiement est sécurisé." } },
  manual_review: { phase: "support", message: { title: "Contrôle manuel", sub: "Votre demande est prise en charge." } },
  refunded: { phase: "error", message: { title: "Remboursement confirmé", sub: "Cette location a été remboursée." } },
  payment_expired: { phase: "expired", message: { title: "QR code expiré", sub: "Générez un nouveau paiement pour continuer." } },
  payment_cancelled: { phase: "error", message: { title: "Paiement annulé", sub: "La demande de location a été annulée." } },
  cancelled: { phase: "error", message: { title: "Location annulée", sub: "La demande de location a été annulée." } },
};

export function useKioskV2Controller(stationId: string | undefined, lang: string) {
  const [station, setStation] = useState<KioskV2Station | null>(null);
  const [quote, setQuote] = useState<KioskV2Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<KioskV2Phase>("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [slotNum, setSlotNum] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
  const [lockedStation, setLockedStation] = useState<string | null>(null);
  const [stationLoadError, setStationLoadError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const tapRef = useRef({ count: 0, lastTap: 0 });
  const idempotencyRef = useRef<string | null>(null);

  const net = useOnlineStatus();
  const offline = net === "offline";
  const { needRefresh, swUrl, applyUpdate } = useKioskPwa();
  const busy = ["pricing", "starting", "qr", "waitpay"].includes(phase);

  const onLogoTap = useCallback(() => {
    const timestamp = Date.now();
    const taps = tapRef.current;
    taps.count = timestamp - taps.lastTap < 650 ? taps.count + 1 : 1;
    taps.lastTap = timestamp;
    if (taps.count >= 5) {
      taps.count = 0;
      setShowDiag(true);
    }
  }, []);

  const loadStation = useCallback(async () => {
    if (!stationId || !isValidStationId(stationId)) {
      setStationLoadError("INVALID_STATION_ID");
      setStation(null);
      setPhase((current) => current === "loading" ? "idle" : current);
      return;
    }
    const { data, error } = await supabase
      .from("stations")
      .select("station_id,name,location_name,online,rentable_count,returnable_count,total_count,currency,price_per_period,last_sync_at")
      .eq("station_id", stationId)
      .maybeSingle();
    if (error || !data) {
      setStationLoadError(error?.message || "STATION_NOT_FOUND");
      setStation(null);
    } else {
      setStationLoadError(null);
      setStation(data as KioskV2Station);
    }
    setPhase((current) => current === "loading" ? "idle" : current);
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
    const result = data as Record<string, unknown> | null;
    if (error || !result || result.error || !result.final_cents) {
      setQuote(null);
      setQuoteError((result?.error as string) || error?.message || "PRICING_NOT_CONFIGURED");
      return;
    }
    setQuoteError(null);
    setQuote({
      amount: Number(result.amount),
      currency: String(result.currency),
      profile_name: String(result.profile_name || "Tarif standard"),
      final_cents: Number(result.final_cents),
      profile_id: String(result.profile_id || ""),
      source: String(result.source || ""),
      deposit_cents: Number(result.deposit_cents),
      period_minutes: Number(result.period_minutes),
      price_per_period_cents: Number(result.price_per_period_cents || result.duration_cents),
      daily_cap_cents: Number(result.daily_cap_cents),
      unreturned_fee_cents: Number(result.unreturned_fee_cents),
    });
  }, [stationId]);

  useEffect(() => {
    if (!stationId || !isValidStationId(stationId)) {
      setMismatch(false);
      setLockedStation(getLockedStation());
      return;
    }
    const locked = lockStationIfUnset(stationId);
    setLockedStation(locked);
    setMismatch(Boolean(locked && locked !== stationId));
  }, [stationId]);

  useEffect(() => {
    document.documentElement.classList.add("kiosk-mode");
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("contextmenu", prevent);
    return () => {
      document.documentElement.classList.remove("kiosk-mode");
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("contextmenu", prevent);
    };
  }, []);

  useEffect(() => {
    loadStation();
    loadQuote();
    if (stationId) {
      supabase.functions.invoke("sync-cabinet-status", { body: { stationId } })
        .then(({ data }) => {
          setConfigured((data as { configured?: boolean } | null)?.configured ?? false);
          loadStation();
        })
        .catch(() => setConfigured(false));
    }
    const interval = window.setInterval(loadStation, 15000);
    return () => window.clearInterval(interval);
  }, [stationId, loadStation, loadQuote]);

  useEffect(() => {
    if (phase !== "qr") return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase === "qr" && expiresAt && now >= expiresAt) setPhase("expired");
  }, [phase, expiresAt, now]);

  const reset = useCallback(() => {
    idempotencyRef.current = null;
    setPhase("idle");
    setCheckoutUrl(null);
    setSessionId(null);
    setPublicCode(null);
    setExpiresAt(null);
    setSlotNum(null);
    setStatusMsg(null);
    loadStation();
    loadQuote();
  }, [loadStation, loadQuote]);

  useEffect(() => {
    if (phase !== "success") return;
    const timeout = window.setTimeout(reset, 12000);
    return () => window.clearTimeout(timeout);
  }, [phase, reset]);

  useEffect(() => {
    if (needRefresh && !busy && ["idle", "loading"].includes(phase)) {
      const timeout = window.setTimeout(applyUpdate, 4000);
      return () => window.clearTimeout(timeout);
    }
  }, [needRefresh, busy, phase, applyUpdate]);

  const applyState = useCallback((state: string, slot: number | null) => {
    if (["ejected", "active_rental", "battery_taken"].includes(state)) {
      setSlotNum(slot);
      setPhase("success");
      return;
    }
    const mapped = STATE_MESSAGES[state];
    if (mapped) {
      setStatusMsg(mapped.message);
      setPhase(mapped.phase);
    }
  }, []);

  useEffect(() => {
    if (!sessionId || !publicCode || !["qr", "waitpay", "starting"].includes(phase)) return;
    const interval = window.setInterval(async () => {
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: sessionId, p_code: publicCode });
      const result = data as { state?: string; selected_slot_num?: number | null } | null;
      if (result?.state) applyState(result.state, result.selected_slot_num ?? null);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [sessionId, publicCode, phase, applyState]);

  const startRental = useCallback(async () => {
    if (offline) {
      setStatusMsg({ title: "Connexion indisponible", sub: "La borne doit retrouver Internet avant le paiement." });
      setPhase("error");
      return;
    }
    setPhase("starting");
    try {
      const kioskToken = readKioskToken();
      if (!kioskToken) {
        setStatusMsg({ title: "Borne non activée", sub: "Cette tablette doit être activée par l'exploitant." });
        setPhase("error");
        return;
      }
      if (!idempotencyRef.current) idempotencyRef.current = crypto.randomUUID();
      const { data: sessionResponse } = await supabase.functions.invoke("create-rental-session", {
        body: { stationId, language: lang },
        headers: { "X-Kiosk-Token": kioskToken, "X-Idempotency-Key": idempotencyRef.current },
      });
      const sessionResult = sessionResponse as { ok?: boolean; session?: { id: string }; error?: string } | null;
      if (!sessionResult?.ok || !sessionResult.session?.id) throw new Error(sessionResult?.error || "SESSION_FAILED");
      setSessionId(sessionResult.session.id);
      const { data: checkoutResponse } = await supabase.functions.invoke("create-stripe-checkout", {
        body: { rentalSessionId: sessionResult.session.id, origin: window.location.origin },
      });
      const checkout = checkoutResponse as { ok?: boolean; checkout_url?: string; public_session_code?: string; expires_at?: string; error?: string } | null;
      if (!checkout?.ok || !checkout.checkout_url) throw new Error(checkout?.error || "CHECKOUT_FAILED");
      setCheckoutUrl(checkout.checkout_url);
      setPublicCode(checkout.public_session_code || null);
      setExpiresAt(checkout.expires_at ? new Date(checkout.expires_at).getTime() : null);
      setPhase("qr");
    } catch {
      setStatusMsg({ title: "Service momentanément indisponible", sub: "Aucun paiement n'a été lancé. Réessayez dans quelques instants." });
      setPhase("error");
    }
  }, [offline, stationId, lang]);

  const goFullscreen = useCallback(() => {
    const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) (element.requestFullscreen?.() ?? element.webkitRequestFullscreen?.())?.catch(() => undefined);
  }, []);

  const available = station?.rentable_count ?? 0;
  const inventoryReadable = Boolean(station?.online && configured && !offline);
  const canRent = Boolean(station?.online && available > 0 && configured && !offline);
  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const countdown = `${String(Math.floor(remainingMs / 60000)).padStart(2, "0")}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")}`;

  return {
    station, quote, quoteError, configured, phase, setPhase, checkoutUrl, publicCode,
    slotNum, statusMsg, lockedStation, stationLoadError, mismatch, showDiag, setShowDiag,
    showHelp, setShowHelp, net, offline, needRefresh, swUrl, applyUpdate, busy,
    available, inventoryReadable, canRent, countdown, onLogoTap, loadStation,
    startRental, reset, goFullscreen,
  };
}
