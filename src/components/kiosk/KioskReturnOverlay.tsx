import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, ReceiptText, ShieldCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n";

const FINAL_SECONDS = 20;
const SUPPORT_SECONDS = 20;

type Summary = {
  rentalSessionId: string;
  publicCode: string | null;
  currency: string;
  language: string;
  startedAt: string | null;
  returnedAt: string | null;
  completedAt: string | null;
  returnStationId: string | null;
  returnedSlotNum: number | null;
  paymentMode: string | null;
  settlementStrategy: string | null;
  settlementStatus: string | null;
  settlementError?: string | null;
  settlementAttempts?: number;
  pricingReady?: boolean;
  pricingFinalizedAt?: string | null;
  paymentMethod: string;
  depositCents: number;
  finalAmountCents: number;
  capturedCents: number;
  refundedCents: number;
  releasedAuthorizationCents: number;
  supplementalCents: number;
  totalMinutes: number;
  billedPeriods: number;
  periodMinutes: number;
  pricePerPeriodCents: number;
  tieredPricing?: boolean;
  tierUpperMinutes?: number | null;
  dailyCapCents: number;
  failureCode?: string | null;
  failureMessage?: string | null;
};

type Result = {
  ok?: boolean;
  stage?: "none" | "settling" | "completed" | "support";
  summary?: Summary;
  error?: string;
};

const copy = {
  fr: {
    detected: "Retour détecté",
    detectedBody: "La batterie est bien revenue. Calcul du prix exact…",
    calculated: "Prix calculé",
    calculatedBody: "Le retour est confirmé. Le montant ci-dessous est calculé à partir de la durée réelle de location.",
    finalizing: "Finalisation du paiement…",
    support: "Prix calculé — règlement à vérifier",
    supportBody: "Votre retour est bien enregistré. Le calcul est terminé, mais le règlement financier nécessite une vérification serveur.",
    supportSafe: "Vous pouvez quitter cet écran : le suivi financier continue côté serveur.",
    done: "Location terminée",
    finalPrice: "Prix final confirmé",
    calculatedPrice: "Prix calculé",
    receipt: "Reçu de location",
    tierApplied: "Palier appliqué",
    upToMinutes: "Jusqu’à {{minutes}} min",
    tieredRate: "Tarif par paliers",
    kioskRecord: "Récapitulatif borne — conservez cette référence pour le support.",
    duration: "Durée",
    periods: "Périodes",
    rate: "Tarif",
    start: "Départ",
    return: "Retour",
    initialSecurity: "Garantie initiale",
    captured: "Montant capturé",
    authorizationReleased: "Autorisation libérée",
    refund: "Remboursement",
    method: "Moyen",
    returnStation: "Borne de retour",
    slot: "Slot",
    supplemental: "Complément",
    reference: "Référence",
    serverConfirmed: "Les montants capturés ou libérés ne sont affichés qu’après confirmation serveur.",
    homeIn: "Accueil dans {{seconds}} s",
    finishNow: "Terminer maintenant",
    backHome: "Retour à l’accueil",
    finish: "Terminer",
  },
  en: {
    detected: "Return detected",
    detectedBody: "Your powerbank has been returned. Calculating the exact price…",
    calculated: "Price calculated",
    calculatedBody: "The return is confirmed. The amount below is calculated from the actual rental duration.",
    finalizing: "Finalising payment…",
    support: "Price calculated — payment under review",
    supportBody: "Your return is safely recorded. Pricing is complete, but the financial settlement requires server verification.",
    supportSafe: "You can leave this screen: financial reconciliation continues on the server.",
    done: "Rental complete",
    finalPrice: "Final price confirmed",
    calculatedPrice: "Calculated price",
    receipt: "Rental receipt",
    tierApplied: "Applied tier",
    upToMinutes: "Up to {{minutes}} min",
    tieredRate: "Tiered pricing",
    kioskRecord: "Kiosk summary — keep this reference for support.",
    duration: "Duration",
    periods: "Periods",
    rate: "Rate",
    start: "Start",
    return: "Return",
    initialSecurity: "Initial security amount",
    captured: "Captured amount",
    authorizationReleased: "Authorization released",
    refund: "Refund",
    method: "Method",
    returnStation: "Return station",
    slot: "Slot",
    supplemental: "Additional charge",
    reference: "Reference",
    serverConfirmed: "Captured or released amounts are shown only after server confirmation.",
    homeIn: "Home in {{seconds}} s",
    finishNow: "Finish now",
    backHome: "Back to home",
    finish: "Finish",
  },
  de: {
    detected: "Rückgabe erkannt",
    detectedBody: "Die Powerbank wurde zurückgegeben. Der genaue Preis wird berechnet…",
    calculated: "Preis berechnet",
    calculatedBody: "Die Rückgabe ist bestätigt. Der Betrag wird anhand der tatsächlichen Mietdauer berechnet.",
    finalizing: "Zahlung wird abgeschlossen…",
    support: "Preis berechnet — Zahlung wird geprüft",
    supportBody: "Ihre Rückgabe ist sicher erfasst. Die Preisberechnung ist abgeschlossen, die finanzielle Abrechnung wird serverseitig geprüft.",
    supportSafe: "Sie können diese Ansicht verlassen: Die finanzielle Prüfung läuft serverseitig weiter.",
    done: "Miete beendet",
    finalPrice: "Endpreis bestätigt",
    calculatedPrice: "Berechneter Preis",
    receipt: "Mietbeleg",
    tierApplied: "Angewendete Stufe",
    upToMinutes: "Bis zu {{minutes}} Min.",
    tieredRate: "Staffeltarif",
    kioskRecord: "Kiosk-Zusammenfassung — diese Referenz für den Support aufbewahren.",
    duration: "Dauer",
    periods: "Perioden",
    rate: "Tarif",
    start: "Beginn",
    return: "Rückgabe",
    initialSecurity: "Anfänglicher Sicherheitsbetrag",
    captured: "Belasteter Betrag",
    authorizationReleased: "Autorisierung freigegeben",
    refund: "Rückerstattung",
    method: "Zahlungsart",
    returnStation: "Rückgabestation",
    slot: "Fach",
    supplemental: "Zusatzbetrag",
    reference: "Referenz",
    serverConfirmed: "Belastete oder freigegebene Beträge erscheinen erst nach Serverbestätigung.",
    homeIn: "Startseite in {{seconds}} s",
    finishNow: "Jetzt beenden",
    backHome: "Zur Startseite",
    finish: "Beenden",
  },
} as const;

type ReturnCopy = (typeof copy)[keyof typeof copy];

const locales = { fr: "fr-CH", en: "en-CH", de: "de-CH" } as const;

function stationFromPath() {
  const match = window.location.pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1] ?? null;
}

function money(cents: number | null | undefined, currency = "CHF") {
  return `${(Number(cents ?? 0) / 100).toFixed(2)} ${currency}`;
}

function when(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function duration(summary: Summary) {
  const mins = summary.totalMinutes || ((summary.startedAt && summary.returnedAt)
    ? Math.max(0, Math.ceil((Date.parse(summary.returnedAt) - Date.parse(summary.startedAt)) / 60000))
    : 0);
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return hours ? `${hours} h ${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

function interpolate(value: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (out, [key, replacement]) => out.replace(`{{${key}}}`, String(replacement)),
    value,
  );
}

function supportDismissKey(rentalId: string) {
  return `chargeurs:return-support-dismissed:${rentalId}`;
}

function rateLabel(summary: Summary, c: ReturnCopy, currency: string) {
  if (summary.tieredPricing) {
    return summary.tierUpperMinutes && summary.tierUpperMinutes > 0
      ? interpolate(c.upToMinutes, { minutes: summary.tierUpperMinutes })
      : c.tieredRate;
  }
  return `${money(summary.pricePerPeriodCents, currency)} / ${summary.periodMinutes || 30} min`;
}

export function KioskReturnOverlay() {
  const { lang } = useI18n();
  const c = copy[lang];
  const locale = locales[lang];
  const stationId = stationFromPath();
  const [result, setResult] = useState<Result | null>(null);
  const [seconds, setSeconds] = useState(FINAL_SECONDS);
  const shownRental = useRef<string | null>(null);

  const fetchSummary = useCallback(async () => {
    const token = readKioskToken();
    if (!stationId || !token) return;
    const { data } = await invokeKioskEdgeProxy<Result>(
      "/api/kiosk/return-summary",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (!data?.ok) return;

    const rentalId = data.summary?.rentalSessionId;
    if (
      data.stage === "support" &&
      rentalId &&
      window.sessionStorage.getItem(supportDismissKey(rentalId))
    ) {
      setResult({ ok: true, stage: "none" });
      return;
    }

    if (data.stage === "completed" && rentalId) {
      window.sessionStorage.removeItem(supportDismissKey(rentalId));
    }
    setResult(data);
  }, [stationId]);

  useEffect(() => {
    if (!stationId) return;
    const token = readKioskToken();
    if (!token) return;
    let stopped = false;
    const tick = async () => {
      await invokeKioskEdgeProxy(
        "/api/kiosk/cabinet-snapshot",
        { stationId },
        { "X-Kiosk-Token": token },
      );
      if (!stopped) await fetchSummary();
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [stationId, fetchSummary]);

  const finishCompleted = useCallback(async () => {
    const token = readKioskToken();
    const id = result?.summary?.rentalSessionId;
    if (!stationId || !token || !id) return;
    await invokeKioskEdgeProxy(
      "/api/kiosk/return-summary",
      { stationId, ackRentalSessionId: id },
      { "X-Kiosk-Token": token },
    );
    setResult({ ok: true, stage: "none" });
    window.dispatchEvent(new CustomEvent("chargeurs:kiosk-flow-complete"));
    window.location.replace(`/kiosk/${stationId}`);
  }, [result, stationId]);

  const dismissSupport = useCallback(() => {
    const id = result?.summary?.rentalSessionId;
    if (!stationId || !id) return;
    window.sessionStorage.setItem(supportDismissKey(id), new Date().toISOString());
    setResult({ ok: true, stage: "none" });
    window.dispatchEvent(new CustomEvent("chargeurs:kiosk-flow-complete"));
    window.location.replace(`/kiosk/${stationId}`);
  }, [result, stationId]);

  useEffect(() => {
    const summary = result?.summary;
    if (!summary || (result?.stage !== "completed" && result?.stage !== "support")) return;
    if (shownRental.current !== `${summary.rentalSessionId}:${result.stage}`) {
      shownRental.current = `${summary.rentalSessionId}:${result.stage}`;
      setSeconds(result.stage === "support" ? SUPPORT_SECONDS : FINAL_SECONDS);
    }
    const id = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, [result]);

  useEffect(() => {
    if (seconds !== 0) return;
    if (result?.stage === "completed") void finishCompleted();
    if (result?.stage === "support") dismissSupport();
  }, [seconds, result, finishCompleted, dismissSupport]);

  if (!stationId || !result?.stage || result.stage === "none" || !result.summary) return null;
  const summary = result.summary;
  const currency = summary.currency || "CHF";
  const pricingReady = Boolean(summary.pricingReady || summary.totalMinutes || summary.finalAmountCents);
  const periods = summary.billedPeriods > 0
    ? `${summary.billedPeriods} × ${summary.periodMinutes || 30} min`
    : `0 × ${summary.periodMinutes || 30} min`;
  const appliedRate = rateLabel(summary, c, currency);

  return (
    <AnimatePresence>
      <motion.div
        key={`${summary.rentalSessionId}:${result.stage}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] grid place-items-center overflow-hidden bg-slate-950/95 p-5 backdrop-blur-2xl"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(34,211,238,.2),transparent_38%),radial-gradient(circle_at_20%_90%,rgba(99,102,241,.18),transparent_42%)]" />

        {result.stage === "settling" && !pricingReady ? (
          <motion.section
            initial={{ scale: .97, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            className="glass-strong liquid-border relative flex w-full max-w-3xl flex-col items-center rounded-[2.5rem] p-10 text-center shadow-[0_0_80px_rgba(34,211,238,.2)]"
          >
            <div className="grid h-28 w-28 place-items-center rounded-full bg-primary/15">
              <ReceiptText className="h-14 w-14 text-primary" />
            </div>
            <h1 className="mt-7 font-display text-5xl font-extrabold">{c.detected}</h1>
            <p className="mt-4 max-w-2xl text-2xl text-muted-foreground">{c.detectedBody}</p>
            <Loader2 className="mt-8 h-12 w-12 animate-spin text-primary" />
          </motion.section>
        ) : result.stage === "settling" ? (
          <motion.section
            initial={{ scale: .96, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            className="glass-strong liquid-border relative w-full max-w-5xl rounded-[2.5rem] p-8 shadow-[0_0_90px_rgba(34,211,238,.24)]"
          >
            <div className="flex flex-col items-center text-center">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-primary/15">
                <ReceiptText className="h-11 w-11 text-primary" />
              </div>
              <h1 className="mt-4 font-display text-5xl font-extrabold">{c.calculated}</h1>
              <div className="mt-3 font-display text-7xl font-extrabold text-gradient-cyan">
                {money(summary.finalAmountCents, currency)}
              </div>
              <p className="mt-2 max-w-3xl text-xl text-muted-foreground">{c.calculatedBody}</p>
            </div>
            <PricingGrid summary={summary} locale={locale} currency={currency} copy={c} periods={periods} appliedRate={appliedRate} />
            <div className="mt-6 flex items-center justify-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-lg font-bold">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              {c.finalizing}
            </div>
          </motion.section>
        ) : result.stage === "support" ? (
          <motion.section
            initial={{ scale: .97, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            className="glass-strong liquid-border relative w-full max-w-5xl rounded-[2.5rem] p-8 shadow-[0_0_90px_rgba(245,158,11,.12)]"
          >
            <button
              onClick={dismissSupport}
              className="absolute right-5 top-5 grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/5"
              aria-label={c.backHome}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex flex-col items-center text-center">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-warning/15">
                <ShieldCheck className="h-11 w-11 text-warning" />
              </div>
              <h1 className="mt-4 font-display text-4xl font-extrabold">{c.support}</h1>
              {pricingReady && (
                <div className="mt-3 font-display text-7xl font-extrabold text-gradient-cyan">
                  {money(summary.finalAmountCents, currency)}
                </div>
              )}
              <p className="mx-auto mt-3 max-w-3xl text-xl text-muted-foreground">{c.supportBody}</p>
            </div>
            {pricingReady && (
              <PricingGrid summary={summary} locale={locale} currency={currency} copy={c} periods={periods} appliedRate={appliedRate} />
            )}
            <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-2xl border border-warning/20 bg-warning/5 p-4 sm:flex-row">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-5 w-5 text-warning" />
                {c.supportSafe}
              </p>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <Clock className="h-4 w-4" />
                  {interpolate(c.homeIn, { seconds })}
                </span>
                <Button onClick={dismissSupport} className="rounded-full px-7">
                  {c.backHome}
                </Button>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.section
            initial={{ scale: .96, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="glass-strong liquid-border relative w-full max-w-5xl rounded-[2.5rem] p-7 shadow-[0_0_90px_rgba(34,211,238,.24)] sm:p-10"
          >
            <button
              onClick={() => void finishCompleted()}
              className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/5"
              aria-label={c.finish}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex flex-col items-center text-center">
              <div className="grid h-24 w-24 place-items-center rounded-full bg-success/20 shadow-[0_0_40px_rgba(34,197,94,.2)]">
                <CheckCircle2 className="h-14 w-14 text-success" />
              </div>
              <p className="mt-4 font-mono text-sm font-bold tracking-[.2em] text-cyan-100">{c.receipt}</p>
              <h1 className="mt-2 font-display text-5xl font-extrabold">{c.done}</h1>
              <div className="mt-4 font-display text-7xl font-extrabold text-gradient-cyan">
                {money(summary.finalAmountCents, currency)}
              </div>
              <p className="mt-2 text-lg font-semibold text-muted-foreground">{c.finalPrice}</p>
            </div>
            <section className="mx-auto mt-7 w-full max-w-4xl overflow-hidden rounded-3xl border border-cyan-100/20 bg-slate-950/35 shadow-inner">
              <div className="flex items-center justify-between border-b border-dashed border-cyan-100/25 px-6 py-4 font-mono text-sm text-cyan-100">
                <span>{c.reference}</span><strong>{summary.publicCode ?? "—"}</strong>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y divide-dashed divide-cyan-100/15 sm:grid-cols-3">
                <ReceiptLine label={c.duration} value={duration(summary)} />
                <ReceiptLine label={summary.tieredPricing ? c.tierApplied : c.periods} value={summary.tieredPricing ? appliedRate : periods} />
                <ReceiptLine label={c.rate} value={summary.tieredPricing ? c.tieredRate : appliedRate} />
                <ReceiptLine label={c.start} value={when(summary.startedAt, locale)} />
                <ReceiptLine label={c.return} value={when(summary.returnedAt, locale)} />
                <ReceiptLine label={c.method} value={summary.paymentMethod} />
                <ReceiptLine label={c.initialSecurity} value={money(summary.depositCents, currency)} />
                <ReceiptLine label={c.captured} value={money(summary.capturedCents, currency)} emphasis />
                {summary.settlementStrategy === "manual_capture"
                  ? <ReceiptLine label={c.authorizationReleased} value={money(summary.releasedAuthorizationCents, currency)} />
                  : <ReceiptLine label={c.refund} value={money(summary.refundedCents, currency)} />}
                <ReceiptLine label={c.returnStation} value={summary.returnStationId ?? "—"} />
                <ReceiptLine label={c.slot} value={summary.returnedSlotNum ? String(summary.returnedSlotNum) : "—"} />
                {summary.supplementalCents > 0 && <ReceiptLine label={c.supplemental} value={money(summary.supplementalCents, currency)} />}
              </div>
            </section>
            <div className="mt-7 flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:flex-row">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-5 w-5 text-success" />
                {c.kioskRecord}
              </p>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <Clock className="h-4 w-4" />
                  {interpolate(c.homeIn, { seconds })}
                </span>
                <Button onClick={() => void finishCompleted()} className="rounded-full bg-gradient-primary px-7">
                  {c.finishNow}
                </Button>
              </div>
            </div>
          </motion.section>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function PricingGrid({
  summary,
  locale,
  currency,
  copy,
  periods,
  appliedRate,
}: {
  summary: Summary;
  locale: string;
  currency: string;
  copy: ReturnCopy;
  periods: string;
  appliedRate: string;
}) {
  return (
    <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Cell label={copy.duration} value={duration(summary)} />
      {summary.tieredPricing
        ? <Cell label={copy.tierApplied} value={appliedRate} />
        : <Cell label={copy.periods} value={periods} />}
      <Cell label={copy.rate} value={summary.tieredPricing ? copy.tieredRate : appliedRate} />
      <Cell label={copy.initialSecurity} value={money(summary.depositCents, currency)} />
      <Cell label={copy.start} value={when(summary.startedAt, locale)} />
      <Cell label={copy.return} value={when(summary.returnedAt, locale)} />
      <Cell label={copy.returnStation} value={summary.returnStationId ?? "—"} />
      <Cell label={copy.slot} value={summary.returnedSlotNum ? String(summary.returnedSlotNum) : "—"} />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 break-words text-lg font-extrabold">{value}</div>
    </div>
  );
}

function ReceiptLine({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-h-24 px-5 py-4 text-left">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-2 break-words text-lg font-extrabold ${emphasis ? "text-cyan-100" : ""}`}>{value}</div>
    </div>
  );
}
