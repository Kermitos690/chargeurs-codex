import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, ExternalLink, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n/i18n";
import { Button } from "@/components/ui/button";

export default function Pay() {
  const { rentalSessionId } = useParams();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [state, setState] = useState<string>("loading");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const outcome = pathname.endsWith("/success") ? "success" : pathname.endsWith("/cancel") ? "cancel" : null;

  useEffect(() => {
    if (!rentalSessionId) return;
    const load = async () => {
      const { data } = await supabase.from("rental_sessions")
        .select("state, checkout_url").eq("id", rentalSessionId).maybeSingle();
      setState((data as any)?.state ?? "unknown");
      setCheckoutUrl((data as any)?.checkout_url ?? null);
    };
    load();
    const i = setInterval(load, 2500);
    return () => clearInterval(i);
  }, [rentalSessionId]);

  const paid = ["payment_succeeded", "ejecting", "ejected", "battery_taken", "active_rental"].includes(state) || outcome === "success";
  const cancelled = ["payment_cancelled", "payment_expired"].includes(state) || outcome === "cancel";

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
