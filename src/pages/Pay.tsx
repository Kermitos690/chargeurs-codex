import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, ExternalLink, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";
import { isServerCancelledPayment, isServerConfirmedPayment, isServerReleasePending } from "@/lib/paymentPresentation";

export default function Pay() {
  const { rentalSessionId } = useParams();
  const search = window.location.search;
  const sessionCode = new URLSearchParams(search).get("c") ?? "";
  const { t } = useI18n();
  const [state, setState] = useState<string>("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!rentalSessionId || !sessionCode) return;
    const load = async () => {
      // Scoped accessor — requires both the session UUID and its public code
      // (bearer secret). A guessable/shared UUID alone is not sufficient.
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: rentalSessionId, p_code: sessionCode });
      const r = data as { state?: string; checkout_url?: string | null } | null;
      setState(r?.state ?? "unknown");
      setCheckoutUrl(r?.checkout_url ?? null);
    };
    load();
    const i = setInterval(load, 2500);
    return () => clearInterval(i);
  }, [rentalSessionId, sessionCode]);

  // The URL may be the Stripe success_url or cancel_url, but it is never proof
  // of payment. Only the scoped server projection (fed by a verified webhook)
  // may switch this page to a confirmed state.
  const paid = isServerConfirmedPayment(state);
  const releasePending = isServerReleasePending(state);
  const cancelled = isServerCancelledPayment(state);

  return (
    <div className="relative flex min-h-screen flex-col px-5 py-6">
      <LiquidBackground />
      <header className="flex items-center justify-between">
        <BrandLogo size="sm" />
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center text-center">
        {paid ? (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-5">
            <div className="grid h-28 w-28 place-items-center rounded-full bg-gradient-success shadow-glow-success">
              <CheckCircle2 className="h-16 w-16 text-success-foreground" />
            </div>
            <h1 className="font-display text-3xl font-extrabold">{t("success.title")}</h1>
            <p className="text-muted-foreground">{t("pay.return")}</p>
          </motion.div>
        ) : releasePending ? (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass-strong liquid-border flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl p-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <h1 className="font-display text-2xl font-bold">{t("pay.release_pending.title")}</h1>
            <p className="text-muted-foreground">{t("pay.release_pending")}</p>
            <div className="flex items-center gap-2 text-success"><ShieldCheck className="h-4 w-4" />{t("qr.secured")}</div>
          </motion.div>
        ) : cancelled ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-5">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-destructive/20">
              <XCircle className="h-14 w-14 text-destructive" />
            </div>
            <h1 className="font-display text-2xl font-bold">{t("qr.cancel")}</h1>
            <p className="max-w-sm text-muted-foreground">{t("error.generic")}</p>
            {checkoutUrl && (
              <Button asChild className="rounded-full bg-gradient-primary px-8 py-5 text-lg font-bold">
                <a href={checkoutUrl}>{t("pay.open")}</a>
              </Button>
            )}
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-strong liquid-border flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl p-8">
            <h1 className="font-display text-2xl font-bold">{t("pay.title")}</h1>
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("pay.pending")}</p>
            {checkoutUrl && (
              <Button asChild className="w-full gap-2 rounded-full bg-gradient-primary py-6 text-lg font-bold shadow-glow">
                <a href={checkoutUrl}><ExternalLink className="h-5 w-5" />{t("pay.open")}</a>
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
