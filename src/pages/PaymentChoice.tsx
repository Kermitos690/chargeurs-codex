import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CreditCard, Loader2, ShieldCheck, Smartphone, WalletCards } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const TERMS_VERSION = "terms-2026-08-10-v1";
const PRIVACY_VERSION = "privacy-2026-08-10-v1";

const PROGRESS_STATES = new Set([
  "payment_succeeded", "ejecting", "ejected", "active_rental", "battery_taken", "battery_returned", "completed",
]);
const TERMINAL_STATUS_STATES = new Set([
  "refunded", "eject_failed", "chargenow_failed", "needs_support", "manual_review",
  "payment_failed", "payment_expired", "payment_cancelled", "cancelled",
]);

type Lang = "fr" | "de" | "en";
type Status = {
  state?: string;
  currency?: string;
  deposit_amount_cents?: number | null;
  pricing?: {
    period_minutes?: number | null;
    price_per_period_cents?: number | null;
    daily_cap_cents?: number | null;
    unreturned_fee_cents?: number | null;
  } | null;
};

const COPY = {
  fr: {
    title: "Choisissez votre garantie de location",
    subtitle: "Le tarif de location est identique. Seul le fonctionnement de la garantie de 30 CHF change selon le moyen de paiement.",
    cardTitle: "Carte, Apple Pay ou Google Pay",
    cardBadge: "Recommandé",
    cardText: "30 CHF sont temporairement réservés auprès de votre banque. Ils ne sont pas encaissés au départ. Au retour, seul le prix réel de la location est capturé et le reste de l’autorisation est libéré.",
    cardSaved: "La carte est enregistrée de manière sécurisée par Stripe afin de pouvoir régler un montant contractuellement dû dépassant la garantie ou un non-retour, conformément aux conditions acceptées. Une authentification supplémentaire peut rester nécessaire.",
    twintTitle: "TWINT",
    twintText: "30 CHF sont débités au début de la location. Au retour, Chargeurs.ch calcule le prix réel et rembourse automatiquement la différence si le montant final est inférieur à 30 CHF.",
    legal: "En continuant, j’accepte les Conditions d’utilisation et reconnais avoir lu la Politique de confidentialité.",
    price: "Tarif",
    guarantee: "Garantie",
    dailyCap: "Plafond journalier",
    nonReturn: "Non-retour",
    continueCard: "Continuer avec carte / wallet",
    continueTwint: "Continuer avec TWINT",
    secure: "Paiement sécurisé par Stripe",
    loading: "Chargement de votre location…",
    invalid: "Cette session de location n’est plus disponible.",
    error: "Le paiement n’a pas pu être préparé. Réessayez.",
  },
  de: {
    title: "Mietgarantie auswählen",
    subtitle: "Der Miettarif bleibt gleich. Nur die Abwicklung der CHF-30-Garantie hängt von der Zahlungsart ab.",
    cardTitle: "Karte, Apple Pay oder Google Pay",
    cardBadge: "Empfohlen",
    cardText: "CHF 30 werden vorübergehend bei Ihrer Bank reserviert und zu Beginn nicht eingezogen. Bei Rückgabe wird nur der tatsächliche Mietpreis belastet und der Rest der Autorisierung freigegeben.",
    cardSaved: "Die Karte wird von Stripe sicher gespeichert, damit vertraglich geschuldete Beträge über der Garantie oder bei Nichtrückgabe beglichen werden können. Eine zusätzliche Authentifizierung kann erforderlich bleiben.",
    twintTitle: "TWINT",
    twintText: "CHF 30 werden zu Mietbeginn belastet. Bei Rückgabe berechnet Chargeurs.ch den tatsächlichen Preis und erstattet die Differenz automatisch, wenn der Endbetrag unter CHF 30 liegt.",
    legal: "Mit dem Fortfahren akzeptiere ich die Nutzungsbedingungen und bestätige, die Datenschutzerklärung gelesen zu haben.",
    price: "Tarif",
    guarantee: "Garantie",
    dailyCap: "Tageslimit",
    nonReturn: "Nichtrückgabe",
    continueCard: "Mit Karte / Wallet fortfahren",
    continueTwint: "Mit TWINT fortfahren",
    secure: "Sichere Zahlung mit Stripe",
    loading: "Miete wird geladen…",
    invalid: "Diese Mietsitzung ist nicht mehr verfügbar.",
    error: "Die Zahlung konnte nicht vorbereitet werden. Bitte erneut versuchen.",
  },
  en: {
    title: "Choose your rental guarantee",
    subtitle: "The rental price is identical. Only the CHF 30 guarantee mechanism changes with the payment method.",
    cardTitle: "Card, Apple Pay or Google Pay",
    cardBadge: "Recommended",
    cardText: "CHF 30 is temporarily authorised by your bank and is not captured at the start. On return, only the actual rental price is captured and the rest of the authorisation is released.",
    cardSaved: "The card is securely saved by Stripe so contractually due amounts above the guarantee or non-return charges can be collected if necessary. Additional authentication may still be required.",
    twintTitle: "TWINT",
    twintText: "CHF 30 is charged when the rental starts. On return, Chargeurs.ch calculates the actual price and automatically refunds the difference when the final amount is below CHF 30.",
    legal: "By continuing, I accept the Terms of Use and acknowledge that I have read the Privacy Policy.",
    price: "Rate",
    guarantee: "Guarantee",
    dailyCap: "Daily cap",
    nonReturn: "Non-return",
    continueCard: "Continue with card / wallet",
    continueTwint: "Continue with TWINT",
    secure: "Secure payment by Stripe",
    loading: "Loading your rental…",
    invalid: "This rental session is no longer available.",
    error: "The payment could not be prepared. Please try again.",
  },
} as const;

function cents(value: number | null | undefined, currency = "CHF") {
  return `${(Number(value ?? 0) / 100).toFixed(2)} ${currency}`;
}

export default function PaymentChoice() {
  const { rentalSessionId } = useParams();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const publicCode = params.get("c") ?? "";
  const lang: Lang = params.get("lang") === "de" || params.get("lang") === "en" ? params.get("lang") as Lang : "fr";
  const c = COPY[lang];
  const [status, setStatus] = useState<Status | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState<"card_hold" | "twint_prepaid" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!rentalSessionId || publicCode.length < 4) { setError(c.invalid); return; }
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: rentalSessionId, p_code: publicCode });
      const next = data as Status | null;
      if (cancelled) return;
      if (!next?.state) { setError(c.invalid); return; }
      const suffix = `?c=${encodeURIComponent(publicCode)}&lang=${lang}`;
      if (PROGRESS_STATES.has(next.state)) {
        window.location.replace(`/pay/${rentalSessionId}/progress${suffix}`);
        return;
      }
      if (TERMINAL_STATUS_STATES.has(next.state)) {
        window.location.replace(`/pay/${rentalSessionId}${suffix}`);
        return;
      }
      setStatus(next);
    };
    void load();
    return () => { cancelled = true; };
  }, [rentalSessionId, publicCode, lang, c.invalid]);

  const start = async (paymentMode: "card_hold" | "twint_prepaid") => {
    if (!accepted || !rentalSessionId) return;
    setLoading(paymentMode); setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("public-stripe-checkout", {
      body: { rentalSessionId, publicCode, paymentMode, accepted: true, language: lang, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
    });
    const result = data as { ok?: boolean; checkoutUrl?: string; progressUrl?: string; error?: string } | null;
    if (invokeError || !result?.ok) {
      setError(c.error); setLoading(null); return;
    }
    const target = result.checkoutUrl ?? result.progressUrl;
    if (!target) { setError(c.error); setLoading(null); return; }
    window.location.href = target;
  };

  const currency = status?.currency ?? "CHF";
  const pricing = status?.pricing;
  const period = Number(pricing?.period_minutes ?? 30);
  const perPeriod = Number(pricing?.price_per_period_cents ?? 0);
  const hourly = period > 0 ? Math.round(perPeriod * 60 / period) : 0;

  return (
    <div className="relative min-h-screen overflow-hidden px-5 py-8 text-foreground">
      <LiquidBackground />
      <main className="relative z-10 mx-auto w-full max-w-3xl">
        <div className="mb-7 flex items-center justify-between"><BrandLogo /><span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold">{lang.toUpperCase()}</span></div>
        {!status && !error ? <div className="grid min-h-[60vh] place-items-center"><div className="flex items-center gap-3 text-lg"><Loader2 className="h-6 w-6 animate-spin text-primary" />{c.loading}</div></div> : error && !status ? <div className="glass-strong liquid-border rounded-3xl p-8 text-center"><p className="text-lg text-destructive">{error}</p></div> : status && <>
          <section className="text-center">
            <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{c.title}</h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{c.subtitle}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
              <span className="glass rounded-full px-4 py-2"><strong>{c.price}:</strong> {cents(hourly, currency)} / h</span>
              <span className="glass rounded-full px-4 py-2"><strong>{c.guarantee}:</strong> {cents(status.deposit_amount_cents, currency)}</span>
              <span className="glass rounded-full px-4 py-2"><strong>{c.dailyCap}:</strong> {cents(pricing?.daily_cap_cents, currency)}</span>
              <span className="glass rounded-full px-4 py-2"><strong>{c.nonReturn}:</strong> {cents(pricing?.unreturned_fee_cents, currency)}</span>
            </div>
          </section>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <motion.section whileHover={{ y: -3 }} className="glass-strong liquid-border relative rounded-[2rem] p-6 text-left">
              <span className="absolute right-5 top-5 rounded-full bg-success/15 px-3 py-1 text-xs font-bold text-success">{c.cardBadge}</span>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15"><WalletCards className="h-6 w-6 text-primary" /></div>
              <h2 className="mt-5 pr-20 font-display text-2xl font-bold">{c.cardTitle}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.cardText}</p>
              <p className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-3 text-xs leading-relaxed text-muted-foreground">{c.cardSaved}</p>
              <Button disabled={!accepted || loading !== null} onClick={() => void start("card_hold")} className="mt-5 w-full rounded-full bg-gradient-primary py-6 text-base font-bold">
                {loading === "card_hold" ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CreditCard className="mr-2 h-5 w-5" />{c.continueCard}</>}
              </Button>
            </motion.section>

            <motion.section whileHover={{ y: -3 }} className="glass-strong liquid-border rounded-[2rem] p-6 text-left">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-400/15"><Smartphone className="h-6 w-6 text-cyan-200" /></div>
              <h2 className="mt-5 font-display text-2xl font-bold">{c.twintTitle}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.twintText}</p>
              <Button disabled={!accepted || loading !== null} onClick={() => void start("twint_prepaid")} variant="outline" className="mt-5 w-full rounded-full py-6 text-base font-bold">
                {loading === "twint_prepaid" ? <Loader2 className="h-5 w-5 animate-spin" /> : <>{c.continueTwint}</>}
              </Button>
            </motion.section>
          </div>

          <label className="glass mt-6 flex cursor-pointer items-start gap-3 rounded-2xl p-4 text-sm text-muted-foreground">
            <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} />
            <span>{c.legal} <a href="/legal/terms" target="_blank" rel="noreferrer" className="font-semibold text-primary underline">Conditions</a> · <a href="/legal/privacy" target="_blank" rel="noreferrer" className="font-semibold text-primary underline">Privacy</a></span>
          </label>
          {error && <p className="mt-4 text-center text-sm font-semibold text-destructive">{error}</p>}
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-success" />{c.secure}</div>
        </>}
      </main>
    </div>
  );
}
