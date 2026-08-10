import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BatteryCharging,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Loader2,
  MapPin,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";

type Lang = "fr" | "de" | "en";
type Status = {
  state?: string;
  currency?: string;
  public_session_code?: string | null;
  selected_slot_num?: number | null;
  checkout_payment_mode?: "card_hold" | "twint_prepaid" | null;
  settlement_strategy?: string | null;
  settlement_status?: string | null;
  stripe_payment_method_type?: string | null;
  deposit_amount_cents?: number | null;
  final_amount_cents?: number | null;
  captured_amount_cents?: number | null;
  refunded_amount_cents?: number | null;
  supplemental_amount_cents?: number | null;
  started_at?: string | null;
  returned_at?: string | null;
  completed_at?: string | null;
  return_station_id?: string | null;
  returned_slot_num?: number | null;
  failure_code?: string | null;
  pricing?: {
    period_minutes?: number | null;
    price_per_period_cents?: number | null;
    daily_cap_cents?: number | null;
    unreturned_fee_cents?: number | null;
  } | null;
};

const COPY = {
  fr: {
    recovered: "Batterie récupérée !",
    activeSub: "Votre location est en cours.",
    duration: "Durée de location",
    rate: "Tarif en cours",
    current: "Montant actuel estimé",
    final: "Prix final confirmé",
    start: "Début",
    active: "Location active",
    slot: "Slot",
    session: "ID session",
    cap: "Plafond 24 h",
    returnBy: "Retour",
    guarantee: "Dépôt de garantie",
    payment: "Moyen de paiement",
    find: "Trouver une borne pour rendre",
    passHint: "Vous rechargez souvent ?",
    passCta: "Voir mon Pass",
    faqReturn: "Comment rendre ma batterie ?",
    conditions: "Tarifs & conditions",
    help: "Besoin d'aide ?",
    returned: "Retour détecté",
    returnedSub: "Votre batterie est revenue. Le serveur calcule et confirme le montant final.",
    done: "Location terminée",
    doneSub: "Votre retour et votre règlement sont confirmés.",
    captured: "Montant capturé",
    released: "Autorisation libérée",
    refunded: "Remboursement",
    supplemental: "Complément",
    returnStation: "Borne de retour",
    returnSlot: "Slot de retour",
    support: "Vérification nécessaire",
    supportSub: "Votre retour est enregistré. Le règlement nécessite une vérification serveur ; aucun montant non confirmé n'est présenté comme final.",
    secured: "Garantie confirmée",
    release: "La borne prépare votre batterie. Revenez devant l'écran de la borne.",
    waiting: "Mise à jour de la location…",
    card: "Carte / wallet",
    twint: "TWINT",
    estimateNote: "Pendant la location, le montant est une estimation basée sur le tarif figé au départ. Le prix final est confirmé après le retour.",
    legal: "Les montants capturés, libérés ou remboursés ne sont affichés comme définitifs qu'après confirmation serveur.",
  },
  de: {
    recovered: "Powerbank entnommen!",
    activeSub: "Ihre Miete läuft.", duration: "Mietdauer", rate: "Aktueller Tarif", current: "Aktuell geschätzter Betrag", final: "Bestätigter Endpreis", start: "Start", active: "Miete aktiv", slot: "Fach", session: "Sitzungs-ID", cap: "24-h-Limit", returnBy: "Rückgabe", guarantee: "Sicherheitsbetrag", payment: "Zahlungsmittel", find: "Station für die Rückgabe finden", passHint: "Sie laden häufig?", passCta: "Meinen Pass ansehen", faqReturn: "Wie gebe ich die Powerbank zurück?", conditions: "Tarife & Bedingungen", help: "Brauchen Sie Hilfe?", returned: "Rückgabe erkannt", returnedSub: "Die Powerbank ist zurück. Der Server berechnet und bestätigt den Endbetrag.", done: "Miete abgeschlossen", doneSub: "Rückgabe und Abrechnung sind bestätigt.", captured: "Belasteter Betrag", released: "Freigegebene Autorisierung", refunded: "Rückerstattung", supplemental: "Zusatzbetrag", returnStation: "Rückgabestation", returnSlot: "Rückgabefach", support: "Prüfung erforderlich", supportSub: "Ihre Rückgabe ist erfasst. Die Abrechnung benötigt eine Serverprüfung; kein unbestätigter Betrag wird als endgültig angezeigt.", secured: "Garantie bestätigt", release: "Die Station bereitet Ihre Powerbank vor. Kehren Sie zum Stationsbildschirm zurück.", waiting: "Miete wird aktualisiert…", card: "Karte / Wallet", twint: "TWINT", estimateNote: "Während der Miete ist der Betrag eine Schätzung auf Basis des beim Start fixierten Tarifs. Der Endpreis wird nach der Rückgabe bestätigt.", legal: "Belastete, freigegebene oder erstattete Beträge gelten erst nach Serverbestätigung als endgültig.",
  },
  en: {
    recovered: "Powerbank collected!",
    activeSub: "Your rental is in progress.", duration: "Rental duration", rate: "Current rate", current: "Current estimated amount", final: "Confirmed final price", start: "Start", active: "Rental active", slot: "Slot", session: "Session ID", cap: "24 h cap", returnBy: "Return", guarantee: "Security amount", payment: "Payment method", find: "Find a kiosk to return", passHint: "Charge often?", passCta: "View my Pass", faqReturn: "How do I return my powerbank?", conditions: "Pricing & conditions", help: "Need help?", returned: "Return detected", returnedSub: "Your powerbank is back. The server is calculating and confirming the final amount.", done: "Rental completed", doneSub: "Your return and settlement are confirmed.", captured: "Captured amount", released: "Authorisation released", refunded: "Refund", supplemental: "Supplement", returnStation: "Return kiosk", returnSlot: "Return slot", support: "Review required", supportSub: "Your return is recorded. Settlement requires server review; no unconfirmed amount is presented as final.", secured: "Guarantee confirmed", release: "The kiosk is preparing your powerbank. Return to the kiosk screen.", waiting: "Updating your rental…", card: "Card / wallet", twint: "TWINT", estimateNote: "During the rental, the amount is an estimate based on the tariff frozen at the start. The final price is confirmed after return.", legal: "Captured, released or refunded amounts are only shown as final after server confirmation.",
  },
} as const;

function money(value: number | null | undefined, currency = "CHF") {
  return `${(Number(value ?? 0) / 100).toFixed(2)} ${currency}`;
}

function clock(value: string | null | undefined, lang: Lang) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "de" ? "de-CH" : lang === "en" ? "en-CH" : "fr-CH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function durationParts(start: string | null | undefined, endMs: number) {
  const startMs = start ? Date.parse(start) : NaN;
  if (!Number.isFinite(startMs)) return { seconds: 0, text: "00:00:00" };
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return {
    seconds,
    text: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
  };
}

function estimatedAmount(status: Status, endMs: number) {
  if (status.returned_at && status.final_amount_cents != null) return Number(status.final_amount_cents);
  const started = status.started_at ? Date.parse(status.started_at) : NaN;
  if (!Number.isFinite(started)) return null;
  const periodMinutes = Math.max(1, Number(status.pricing?.period_minutes ?? 0));
  const perPeriod = Math.max(0, Number(status.pricing?.price_per_period_cents ?? 0));
  if (!periodMinutes || !perPeriod) return null;
  const elapsedMinutes = Math.max(0, Math.ceil((endMs - started) / 60000));
  const dailyCap = Math.max(0, Number(status.pricing?.daily_cap_cents ?? 0));
  if (!dailyCap) return Math.max(1, Math.ceil(elapsedMinutes / periodMinutes)) * perPeriod;
  if (elapsedMinutes === 0) return Math.min(perPeriod, dailyCap);
  const completeDays = Math.floor(elapsedMinutes / 1440);
  const remainderMinutes = elapsedMinutes % 1440;
  const remainder = remainderMinutes > 0
    ? Math.min(Math.max(1, Math.ceil(remainderMinutes / periodMinutes)) * perPeriod, dailyCap)
    : 0;
  return completeDays * dailyCap + remainder;
}

function hourlyEquivalent(status: Status) {
  const period = Number(status.pricing?.period_minutes ?? 0);
  const cents = Number(status.pricing?.price_per_period_cents ?? 0);
  if (!period || !cents) return null;
  return Math.round((60 / period) * cents);
}

export default function RentalProgress() {
  const { rentalSessionId } = useParams();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const publicCode = params.get("c") ?? "";
  const lang: Lang = params.get("lang") === "de" || params.get("lang") === "en" ? params.get("lang") as Lang : "fr";
  const c = COPY[lang];
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (!rentalSessionId || publicCode.length < 4) return;
      const { data } = await supabase.rpc("kiosk_session_status", { p_id: rentalSessionId, p_code: publicCode });
      if (!cancelled && data) setStatus(data as Status);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [rentalSessionId, publicCode]);

  if (!status) {
    return <MobileShell><div className="grid min-h-[72vh] place-items-center"><div className="flex items-center gap-3 text-sm text-white/55"><Loader2 className="h-5 w-5 animate-spin text-lime-400" />{c.waiting}</div></div></MobileShell>;
  }

  const state = status.state ?? "";
  const completed = state === "completed" && status.settlement_status === "settled";
  const returned = state === "battery_returned";
  const active = ["ejected", "active_rental", "battery_taken"].includes(state);
  const releasing = ["payment_succeeded", "ejecting"].includes(state);
  const support = state === "needs_support" || ["failed", "manual_review", "supplemental_required"].includes(status.settlement_status ?? "");
  const currency = status.currency ?? "CHF";
  const endMs = status.returned_at ? Date.parse(status.returned_at) : now;
  const elapsed = durationParts(status.started_at, Number.isFinite(endMs) ? endMs : now);
  const estimate = estimatedAmount(status, Number.isFinite(endMs) ? endMs : now);
  const hourly = hourlyEquivalent(status);
  const deposit = Number(status.deposit_amount_cents ?? 0);
  const captured = Number(status.captured_amount_cents ?? 0);
  const refunded = Number(status.refunded_amount_cents ?? 0);
  const supplemental = Number(status.supplemental_amount_cents ?? 0);
  const final = Number(status.final_amount_cents ?? 0);
  const released = status.settlement_strategy === "manual_capture" ? Math.max(0, deposit - captured) : 0;
  const paymentMethod = status.checkout_payment_mode === "twint_prepaid" || status.stripe_payment_method_type === "twint" ? c.twint : c.card;

  if (completed) {
    return <MobileShell>
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <StatusHeading icon={<CheckCircle2 className="h-7 w-7" />} title={c.done} subtitle={c.doneSub} />
        <HeroMeter label={c.final} value={money(final, currency)} accent="success" />
        <div className="grid grid-cols-2 gap-2.5">
          <InfoCell label={c.duration} value={elapsed.text} />
          <InfoCell label={c.payment} value={paymentMethod} />
          <InfoCell label={c.captured} value={money(captured, currency)} />
          {status.settlement_strategy === "manual_capture"
            ? <InfoCell label={c.released} value={money(released, currency)} />
            : <InfoCell label={c.refunded} value={money(refunded, currency)} />}
          {supplemental > 0 && <InfoCell label={c.supplemental} value={money(supplemental, currency)} />}
          <InfoCell label={c.returnStation} value={status.return_station_id ?? "—"} />
          <InfoCell label={c.returnSlot} value={status.returned_slot_num ? String(status.returned_slot_num) : "—"} />
          <InfoCell label={c.session} value={status.public_session_code ?? publicCode} mono />
        </div>
        <LegalNote text={c.legal} />
        <ActionLinks c={c} />
      </motion.section>
    </MobileShell>;
  }

  if (support) {
    return <MobileShell><StatePanel icon={<RotateCcw className="h-8 w-8 text-amber-300" />} title={c.support} text={c.supportSub} /><LegalNote text={c.legal} /><ActionLinks c={c} /></MobileShell>;
  }

  if (returned) {
    return <MobileShell><StatePanel icon={<ReceiptText className="h-8 w-8 text-lime-300" />} title={c.returned} text={c.returnedSub} loading /><HeroMeter label={c.current} value={estimate == null ? "—" : money(estimate, currency)} /><LegalNote text={c.estimateNote} /></MobileShell>;
  }

  if (active) {
    return <MobileShell>
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
        <StatusHeading icon={<CheckCircle2 className="h-7 w-7" />} title={c.recovered} subtitle={c.activeSub} />
        <HeroMeter label={c.duration} value={elapsed.text} />

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[1.35rem] border border-lime-300/20 bg-lime-300/10 shadow-[0_0_35px_rgba(163,230,53,.08)]">
          <div className="bg-[#050806]/95 p-4 text-center"><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/38">{c.rate}</div><div className="mt-2 text-lg font-black text-lime-300">{hourly == null ? "—" : money(hourly, currency)} / h</div></div>
          <div className="bg-[#050806]/95 p-4 text-center"><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/38">{c.current}</div><div className="mt-2 text-lg font-black text-lime-300">{estimate == null ? "—" : money(estimate, currency)}</div></div>
        </div>

        <div className="rounded-[1.35rem] border border-lime-300/20 bg-[#060906]/94 p-4 shadow-[inset_0_0_35px_rgba(163,230,53,.035)]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Detail icon={<Clock3 />} label={c.start} value={clock(status.started_at, lang)} />
            <Detail icon={<Zap />} label={c.active} value={c.active} accent />
            <Detail icon={<BatteryCharging />} label={c.slot} value={status.selected_slot_num ? String(status.selected_slot_num) : "—"} />
            <Detail icon={<Smartphone />} label={c.session} value={status.public_session_code ?? publicCode} mono />
            <Detail icon={<ShieldCheck />} label={c.cap} value={status.pricing?.daily_cap_cents ? money(status.pricing.daily_cap_cents, currency) : "—"} />
            <Detail icon={<RotateCcw />} label={c.returnBy} value={c.find} />
            <Detail icon={<ShieldCheck />} label={c.guarantee} value={money(deposit, currency)} />
            <Detail icon={<Smartphone />} label={c.payment} value={paymentMethod} />
          </div>
        </div>

        <Link to="/?section=bornes" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-lime-400 px-5 text-center text-sm font-black uppercase tracking-[.04em] text-black shadow-[0_0_30px_rgba(163,230,53,.22)] transition active:scale-[.98]">
          <MapPin className="h-5 w-5" />{c.find}<ChevronRight className="h-5 w-5" />
        </Link>

        <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-300/5"><Zap className="h-5 w-5 text-lime-300" /></div>
          <div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-[.14em] text-white/35">{c.passHint}</div><div className="mt-1 text-sm font-bold text-white/85">Chargeurs+ Pass</div></div>
          <Link to="/compte/pass" className="rounded-full border border-lime-300/25 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-lime-300">{c.passCta}</Link>
        </div>

        <LegalNote text={c.estimateNote} />
        <ActionLinks c={c} />
      </motion.section>
    </MobileShell>;
  }

  if (releasing) {
    return <MobileShell><StatePanel icon={<Loader2 className="h-8 w-8 animate-spin text-lime-300" />} title={c.secured} text={c.release} loading /></MobileShell>;
  }

  return <MobileShell><StatePanel icon={<Loader2 className="h-8 w-8 animate-spin text-lime-300" />} title={c.secured} text={c.waiting} loading /></MobileShell>;
}

function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020402] px-4 pb-8 pt-5 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_26%,rgba(132,204,22,.075),transparent_31%),radial-gradient(circle_at_12%_62%,rgba(132,204,22,.035),transparent_34%),linear-gradient(180deg,#020402_0%,#050706_45%,#010201_100%)]" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,rgba(132,204,22,.025))]" />
      <main className="relative z-10 mx-auto w-full max-w-[430px]">
        <div className="mb-5 flex items-center justify-center"><BrandLogo size="sm" /></div>
        {children}
        <div className="mt-8 text-center text-[10px] text-white/25">🔒 chargeurs.ch</div>
      </main>
    </div>
  );
}

function StatusHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex items-center gap-3 px-1"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-lime-300/40 bg-lime-300/5 text-lime-300 shadow-[0_0_22px_rgba(163,230,53,.12)]">{icon}</div><div><h1 className="font-display text-xl font-black uppercase tracking-tight">{title}</h1><p className="mt-0.5 text-xs text-white/45">{subtitle}</p></div></div>;
}

function HeroMeter({ label, value, accent = "active" }: { label: string; value: string; accent?: "active" | "success" }) {
  return <div className={`rounded-[1.4rem] border bg-[#070b07]/94 px-5 py-6 text-center shadow-[inset_0_0_55px_rgba(163,230,53,.04),0_0_34px_rgba(163,230,53,.08)] ${accent === "success" ? "border-emerald-300/25" : "border-lime-300/30"}`}><div className="text-[10px] font-bold uppercase tracking-[.18em] text-white/38">{label}</div><div className={`mt-2 font-mono text-[2.55rem] font-black leading-none tracking-tight sm:text-[3rem] ${accent === "success" ? "text-emerald-300" : "text-lime-300"}`}>{value}</div></div>;
}

function Detail({ icon, label, value, mono = false, accent = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; accent?: boolean }) {
  return <div className="min-w-0"><div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-white/30"><span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>{label}</div><div className={`mt-1 truncate text-xs font-semibold ${mono ? "font-mono" : ""} ${accent ? "text-lime-300" : "text-white/75"}`}>{value}</div></div>;
}

function InfoCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-xl border border-white/8 bg-white/[.025] p-3"><div className="text-[9px] uppercase tracking-[.14em] text-white/30">{label}</div><div className={`mt-1.5 break-words text-sm font-bold text-white/80 ${mono ? "font-mono" : ""}`}>{value}</div></div>;
}

function StatePanel({ icon, title, text, loading = false }: { icon: React.ReactNode; title: string; text: string; loading?: boolean }) {
  return <motion.section initial={{ opacity: 0, scale: .985 }} animate={{ opacity: 1, scale: 1 }} className="flex min-h-[58vh] flex-col items-center justify-center rounded-[1.5rem] border border-lime-300/20 bg-[#060906]/90 p-7 text-center shadow-[0_0_40px_rgba(163,230,53,.06)]"><div className="grid h-16 w-16 place-items-center rounded-full border border-lime-300/25 bg-lime-300/5">{icon}</div><h1 className="mt-5 font-display text-2xl font-black uppercase tracking-tight">{title}</h1><p className="mt-3 max-w-sm text-sm leading-relaxed text-white/48">{text}</p>{loading && <div className="mt-7 h-1 w-36 overflow-hidden rounded-full bg-white/8"><motion.div className="h-full w-1/3 rounded-full bg-lime-300" animate={{ x: [-60, 155] }} transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }} /></div>}</motion.section>;
}

function LegalNote({ text }: { text: string }) {
  return <p className="flex items-start gap-2 px-1 text-[10px] leading-relaxed text-white/28"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-300/55" />{text}</p>;
}

function ActionLinks({ c }: { c: typeof COPY[Lang] }) {
  return <div className="divide-y divide-white/7 border-y border-white/7">
    <Link to="/?section=faq" className="flex min-h-11 items-center gap-3 text-xs text-white/58"><RotateCcw className="h-4 w-4 text-lime-300/65" /><span className="flex-1">{c.faqReturn}</span><ChevronRight className="h-4 w-4 text-white/20" /></Link>
    <Link to="/legal/conditions" className="flex min-h-11 items-center gap-3 text-xs text-white/58"><FileText className="h-4 w-4 text-lime-300/65" /><span className="flex-1">{c.conditions}</span><ChevronRight className="h-4 w-4 text-white/20" /></Link>
    <Link to="/support" className="flex min-h-11 items-center gap-3 text-xs text-white/58"><CircleHelp className="h-4 w-4 text-lime-300/65" /><span className="flex-1">{c.help}</span><ChevronRight className="h-4 w-4 text-white/20" /></Link>
  </div>;
}
