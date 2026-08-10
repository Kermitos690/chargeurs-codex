import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, ExternalLink, ShieldCheck, RotateCcw, AlertTriangle, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { isServerCancelledPayment, isServerConfirmedPayment, isServerReleasePending } from "@/lib/paymentPresentation";
import { kioskPaymentPresentation } from "@/lib/kioskPaymentState";

type PayStatus = {
  state?: string;
  checkout_url?: string | null;
  failure_code?: string | null;
  selected_slot_num?: number | null;
};

const CHECKOUT_OPEN_STATES = new Set(["created", "checkout_created", "payment_pending"]);

export default function Pay() {
  const { rentalSessionId } = useParams();
  const search = window.location.search;
  const sessionCode = new URLSearchParams(search).get("c") ?? "";
  const { t } = useI18n();
  const [status, setStatus] = useState<PayStatus>({ state: "loading", checkout_url: null, failure_code: null, selected_slot_num: null });

  useEffect(() => {
    if (!rentalSessionId || !sessionCode) return;
    let cancelled = false;
    const load = async () => {
      // Scoped accessor — requires both the session UUID and its public code
      // (bearer secret). A guessable/shared UUID alone is not sufficient.
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: rentalSessionId, p_code: sessionCode });
      if (cancelled) return;
      const r = data as PayStatus | null;
      setStatus({
        state: r?.state ?? "unknown",
        checkout_url: r?.checkout_url ?? null,
        failure_code: r?.failure_code ?? null,
        selected_slot_num: r?.selected_slot_num ?? null,
      });
    };
    void load();
    // Once Stripe has redirected back to this page the UI must react to the
    // hardware event quickly. BATTERY_BORROW_OUT now projects the release
    // server-side immediately, so sub-second polling is cheap and avoids the
    // old 2.5 s visual lag without ever sending a hardware command.
    const i = window.setInterval(() => void load(), 800);
    return () => { cancelled = true; window.clearInterval(i); };
  }, [rentalSessionId, sessionCode]);

  // The URL may be the Stripe success_url or cancel_url, but it is never proof
  // of payment. Only the scoped server projection (fed by verified webhooks)
  // may switch this page to a confirmed state.
  const state = status.state ?? "unknown";
  const paid = isServerConfirmedPayment(state);
  const releasePending = isServerReleasePending(state);
  const cancelled = isServerCancelledPayment(state);
  const refunded = state === "refunded";
  const serverPresentation = kioskPaymentPresentation(state, status.failure_code);
  const releaseProblem = serverPresentation?.phase === "support";
  const checkoutCanOpen = Boolean(status.checkout_url && CHECKOUT_OPEN_STATES.has(state));

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden px-5 py-6">
      <LiquidBackground />
      <header className="relative z-10 flex items-center justify-between">
        <BrandLogo size="sm" />
        <LanguageSwitcher />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center text-center">
        {refunded ? (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass-strong liquid-border flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-8">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-warning/15">
              <RotateCcw className="h-12 w-12 text-warning" />
            </div>
            <h1 className="font-display text-3xl font-extrabold">{t("kiosk.state.refunded.title")}</h1>
            <p className="text-muted-foreground">{t("kiosk.state.refunded.subtitle")}</p>
            <div className="flex items-center gap-2 text-success"><ShieldCheck className="h-4 w-4" />{t("qr.secured")}</div>
          </motion.div>
        ) : releaseProblem && serverPresentation ? (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass-strong liquid-border flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-8">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-warning/15">
              <AlertTriangle className="h-12 w-12 text-warning" />
            </div>
            <h1 className="font-display text-2xl font-bold">{t(serverPresentation.titleKey)}</h1>
            <p className="text-muted-foreground">{t(serverPresentation.subtitleKey)}</p>
            <div className="flex items-center gap-2 text-success"><ShieldCheck className="h-4 w-4" />{t("qr.secured")}</div>
          </motion.div>
        ) : paid ? (
          <motion.div initial={{ opacity: 0, scale: 0.92, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 18 }} className="glass-strong liquid-border relative flex w-full max-w-sm flex-col items-center gap-5 overflow-hidden rounded-[2rem] p-8 shadow-[0_30px_90px_rgba(0,0,0,.34),0_0_55px_rgba(34,211,238,.14)]">
            <motion.div aria-hidden className="absolute -top-20 h-44 w-44 rounded-full bg-cyan-400/20 blur-3xl" animate={{ scale: [1, 1.18, 1], opacity: [.5, .85, .5] }} transition={{ duration: 2.6, repeat: Infinity }} />
            <motion.div initial={{ scale: 0, rotate: -16 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 210, damping: 15 }} className="relative grid h-28 w-28 place-items-center rounded-full bg-gradient-success shadow-glow-success">
              <CheckCircle2 className="h-16 w-16 text-success-foreground" />
            </motion.div>
            <h1 className="relative font-display text-3xl font-extrabold">{t("kiosk.success.title")}</h1>
            {status.selected_slot_num ? (
              <div className="relative w-full rounded-2xl border border-cyan-200/20 bg-slate-950/20 px-5 py-4">
                <p className="text-sm font-semibold uppercase tracking-[.18em] text-cyan-100/70">{t("kiosk.slot.label", { slot: status.selected_slot_num })}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{t("kiosk.success.slot", { slot: status.selected_slot_num })}</p>
              </div>
            ) : <p className="relative text-muted-foreground">{t("kiosk.success.generic")}</p>}
            <div className="relative flex items-center gap-2 text-success"><ShieldCheck className="h-4 w-4" />{t("qr.secured")}</div>
          </motion.div>
        ) : releasePending ? (
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="glass-strong liquid-border relative flex w-full max-w-sm flex-col items-center gap-6 overflow-hidden rounded-[2rem] p-8">
            <motion.div aria-hidden className="absolute -top-24 h-52 w-52 rounded-full bg-blue-500/20 blur-3xl" animate={{ scale: [1, 1.2, 1], opacity: [.45, .8, .45] }} transition={{ duration: 2.2, repeat: Infinity }} />
            <motion.div className="relative grid h-24 w-24 place-items-center rounded-full border border-cyan-200/30 bg-cyan-300/10 shadow-[0_0_40px_rgba(34,211,238,.18)]" animate={{ boxShadow: ["0 0 18px rgba(34,211,238,.12)", "0 0 48px rgba(34,211,238,.32)", "0 0 18px rgba(34,211,238,.12)"] }} transition={{ duration: 1.5, repeat: Infinity }}>
              <CheckCircle2 className="h-12 w-12 text-cyan-100" />
              <motion.div aria-hidden className="absolute inset-[-8px] rounded-full border border-cyan-200/20" animate={{ scale: [1, 1.22], opacity: [.65, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />
            </motion.div>
            <div className="relative flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-300/[.07] px-4 py-2 text-sm font-bold text-cyan-100">
              <Zap className="h-4 w-4" />{t("kiosk.state.payment_succeeded.title")}
            </div>
            <h1 className="relative font-display text-2xl font-bold">{t("pay.release_pending.title")}</h1>
            <p className="relative text-muted-foreground">{t("pay.release_pending")}</p>
            {status.selected_slot_num && <p className="relative text-sm font-semibold text-cyan-100">{t("kiosk.slot.label", { slot: status.selected_slot_num })}</p>}
            <div className="relative flex items-center gap-2 text-success"><ShieldCheck className="h-4 w-4" />{t("qr.secured")}</div>
          </motion.div>
        ) : cancelled ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-5">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-destructive/20">
              <XCircle className="h-14 w-14 text-destructive" />
            </div>
            <h1 className="font-display text-2xl font-bold">{serverPresentation ? t(serverPresentation.titleKey) : t("kiosk.state.cancelled.title")}</h1>
            <p className="max-w-sm text-muted-foreground">{serverPresentation ? t(serverPresentation.subtitleKey) : t("kiosk.state.cancelled.subtitle")}</p>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-strong liquid-border flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl p-8">
            <h1 className="font-display text-2xl font-bold">{t("pay.title")}</h1>
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("pay.pending")}</p>
            {checkoutCanOpen && (
              <Button asChild className="w-full gap-2 rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
                <a href={status.checkout_url!}><ExternalLink className="h-5 w-5" />{t("pay.open")}</a>
              </Button>
            )}
            <p className="text-sm text-muted-foreground">{t("pay.methods")}</p>
            <div className="flex items-center gap-2 text-success"><ShieldCheck className="h-4 w-4" />{t("qr.secured")}</div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
