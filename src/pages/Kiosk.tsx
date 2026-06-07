import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import { BatteryCharging, Wifi, WifiOff, Loader2, CheckCircle2, AlertTriangle, X, ShieldCheck } from "lucide-react";
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

type Phase = "loading" | "idle" | "starting" | "qr" | "success" | "error" | "support";

export default function Kiosk() {
  const { stationId } = useParams();
  const { t, lang } = useI18n();
  const [station, setStation] = useState<Station | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const loadStation = useCallback(async () => {
    if (!stationId) return;
    const { data } = await supabase.from("stations").select("*").eq("station_id", stationId).maybeSingle();
    setStation(data as Station | null);
    setPhase((p) => (p === "loading" ? "idle" : p));
  }, [stationId]);

  useEffect(() => {
    loadStation();
    // Trigger a real sync against ChargeNow on mount.
    supabase.functions.invoke("sync-cabinet-status", { body: { stationId } })
      .then(({ data }) => { setConfigured((data as any)?.configured ?? false); loadStation(); })
      .catch(() => setConfigured(false));
    const i = setInterval(loadStation, 15000);
    return () => clearInterval(i);
  }, [stationId, loadStation]);

  // Poll rental session state while a checkout is active.
  useEffect(() => {
    if (!sessionId || (phase !== "qr" && phase !== "starting")) return;
    const i = setInterval(async () => {
      const { data } = await supabase.from("rental_sessions").select("state").eq("id", sessionId).maybeSingle();
      const s = (data as any)?.state;
      if (s === "ejected" || s === "battery_taken" || s === "active_rental") setPhase("success");
      else if (s === "eject_failed" || s === "needs_support") setPhase("support");
      else if (s === "payment_expired" || s === "payment_cancelled") setPhase("error");
    }, 2000);
    return () => clearInterval(i);
  }, [sessionId, phase]);

  const startRental = async () => {
    setPhase("starting");
    try {
      const { data: sess } = await supabase.functions.invoke("create-rental-session", { body: { stationId, language: lang } });
      if (!(sess as any)?.ok) { setPhase("error"); return; }
      const rentalSessionId = (sess as any).session.id;
      setSessionId(rentalSessionId);
      const { data: co } = await supabase.functions.invoke("create-stripe-checkout", {
        body: { rentalSessionId, origin: window.location.origin },
      });
      if (!(co as any)?.ok || !(co as any)?.checkout_url) { setPhase("error"); return; }
      setCheckoutUrl((co as any).checkout_url);
      setPhase("qr");
    } catch { setPhase("error"); }
  };

  const reset = () => { setPhase("idle"); setCheckoutUrl(null); setSessionId(null); loadStation(); };

  const price = station ? `${Number(station.price_per_period).toFixed(2)} ${station.currency}` : "—";
  const available = station?.rentable_count ?? 0;
  const canRent = station?.online && available > 0 && configured;

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
              <p className="text-xl text-muted-foreground">{t("kiosk.loading")}</p>
            </motion.div>
          )}

          {phase === "idle" && station && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-8">
              <StatusBadge online={!!station.online} configured={!!configured} t={t} />
              <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-tight sm:text-7xl">
                {t("kiosk.hero")}
              </h1>
              <p className="max-w-2xl text-xl text-muted-foreground sm:text-2xl">{t("kiosk.subtitle")}</p>

              <div className="flex flex-wrap items-center justify-center gap-4">
                <div className="glass liquid-border flex items-center gap-3 rounded-2xl px-6 py-4">
                  <BatteryCharging className="h-8 w-8 text-success" />
                  <div className="text-left">
                    <div className="text-3xl font-bold">{available}</div>
                    <div className="text-sm text-muted-foreground">{t("kiosk.available")}</div>
                  </div>
                </div>
                <div className="glass liquid-border flex items-center gap-3 rounded-2xl px-6 py-4">
                  <div className="text-left">
                    <div className="text-3xl font-bold text-gradient-cyan">{price}</div>
                    <div className="text-sm text-muted-foreground">{t("kiosk.price")}</div>
                  </div>
                </div>
              </div>

              {canRent ? (
                <Button onClick={startRental} className="h-auto rounded-full bg-gradient-primary px-12 py-6 text-2xl font-bold shadow-glow transition-transform hover:scale-105 active:scale-95">
                  {t("kiosk.cta")}
                </Button>
              ) : (
                <div className="glass rounded-2xl px-8 py-5 text-lg text-warning">
                  {!configured ? t("kiosk.notconfigured") : !station.online ? t("kiosk.offline") : t("kiosk.unavailable")}
                </div>
              )}
            </motion.div>
          )}

          {phase === "starting" && (
            <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-xl text-muted-foreground">{t("qr.waiting")}</p>
            </motion.div>
          )}

          {phase === "qr" && checkoutUrl && (
            <motion.div key="qr" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("qr.title")}</h2>
              <div className="relative">
                <span className="absolute -inset-4 rounded-[2rem] bg-primary/30 blur-2xl animate-pulse-ring" />
                <div className="glass-strong liquid-border relative rounded-[2rem] bg-white p-6">
                  <QRCodeSVG value={checkoutUrl} size={280} bgColor="#ffffff" fgColor="#0a1024" level="M" />
                </div>
              </div>
              <div className="flex items-center gap-2 text-success">
                <ShieldCheck className="h-5 w-5" /><span className="font-semibold">{t("qr.secured")}</span>
              </div>
              <p className="text-muted-foreground">{t("qr.methods")}</p>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />{t("qr.waiting")}
              </div>
              <Button variant="ghost" onClick={reset} className="gap-2"><X className="h-4 w-4" />{t("qr.cancel")}</Button>
            </motion.div>
          )}

          {phase === "success" && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}
                className="grid h-40 w-40 place-items-center rounded-full bg-gradient-success shadow-glow-success">
                <CheckCircle2 className="h-24 w-24 text-success-foreground" />
              </motion.div>
              <h2 className="font-display text-4xl font-extrabold">{t("success.title")}</h2>
              <p className="text-xl text-muted-foreground">{t("success.sub")}</p>
              <Button onClick={reset} variant="ghost" className="mt-4">↺</Button>
            </motion.div>
          )}

          {(phase === "error" || phase === "support") && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
              <div className="grid h-32 w-32 place-items-center rounded-full bg-destructive/20">
                <AlertTriangle className="h-16 w-16 text-destructive" />
              </div>
              <p className="max-w-xl text-xl text-muted-foreground">{t("error.generic")}</p>
              {phase === "support" && <p className="text-warning">{t("error.support")}</p>}
              <Button onClick={reset} className="rounded-full bg-gradient-primary px-10 py-5 text-lg font-bold">{t("error.retry")}</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StatusBadge({ online, configured, t }: { online: boolean; configured: boolean; t: (k: string) => string }) {
  if (!configured) return (
    <div className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-warning">
      <WifiOff className="h-4 w-4" />{t("kiosk.notconfigured")}
    </div>
  );
  return (
    <div className={`glass inline-flex items-center gap-2 rounded-full px-4 py-2 ${online ? "text-success" : "text-muted-foreground"}`}>
      {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {online ? t("kiosk.online") : t("kiosk.offline")}
    </div>
  );
}
