import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { BadgePercent, Check, Crown, Loader2, ShieldCheck, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useI18n } from "@/i18n/i18n";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1];
}

type Segment = { currency: string; hourly_cents: number | null; daily_cap_cents: number };
type MembershipPlan = {
  id: string;
  code: string;
  name: string;
  currency: string;
  annual_fee_cents: number;
  renewal_credit_cents: number;
  hourly_cents: number;
  daily_cap_cents: number;
  valid_from: string;
  valid_to: string | null;
};
type OfferData = { ok?: boolean; guest?: Segment; member?: Segment | null; memberAvailable?: boolean; membershipPlan?: MembershipPlan | null };

const money = (cents: number | null | undefined, currency = "CHF") =>
  cents == null ? "—" : `${(Number(cents) / 100).toFixed(2)} ${currency}`;

export function KioskOffersLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const stationId = stationFromPath(location.pathname);
  const [open, setOpen] = useState(false);
  const [mainJourneyMounted, setMainJourneyMounted] = useState(false);
  const [premiumJourneyMounted, setPremiumJourneyMounted] = useState(false);
  const [offer, setOffer] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stationId) return;
    const detect = () => {
      setMainJourneyMounted(Boolean(document.querySelector(".kiosk-root > header")));
      setPremiumJourneyMounted(Boolean(document.querySelector(".ck2-loading, .ck2-home, .ck2-member, .ck2-connected")));
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stationId]);

  useEffect(() => {
    const openOffers = () => setOpen(true);
    window.addEventListener("chargeurs:open-kiosk-offers", openOffers);
    return () => window.removeEventListener("chargeurs:open-kiosk-offers", openOffers);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open || !stationId) return;
    const token = readKioskToken();
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    void invokeKioskEdgeProxy<OfferData>(
      "/api/kiosk/customer-options",
      { stationId },
      { "X-Kiosk-Token": token },
    ).then(({ data }) => {
      if (!cancelled && data?.ok) setOffer(data);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, stationId]);

  const signupUrl = useMemo(() => {
    if (!stationId) return "";
    const url = new URL("/compte/login", window.location.origin);
    url.searchParams.set("intent", "client-chargeurs");
    url.searchParams.set("station", stationId);
    return url.toString();
  }, [stationId]);

  if (!stationId || mainJourneyMounted) return null;

  const fr = lang === "fr";
  const de = lang === "de";
  const label = de ? "Angebote" : fr ? "Offres" : "Offers";
  const title = de ? "Mehr Freiheit. Weniger bezahlen." : fr ? "Plus de liberté. Moins cher." : "More freedom. Pay less.";
  const scan = de ? "Scannen, um beizutreten" : fr ? "Scannez pour adhérer" : "Scan to join";
  const plan = offer?.membershipPlan ?? null;
  const currency = plan?.currency ?? offer?.member?.currency ?? offer?.guest?.currency ?? "CHF";
  const annual = plan?.annual_fee_cents ?? null;
  const credit = plan?.renewal_credit_cents ?? null;
  const memberHourly = plan?.hourly_cents ?? offer?.member?.hourly_cents ?? null;
  const memberCap = plan?.daily_cap_cents ?? offer?.member?.daily_cap_cents ?? null;
  const guestHourly = offer?.guest?.hourly_cents ?? null;
  const savingPct = guestHourly && memberHourly != null && guestHourly > 0
    ? Math.max(0, Math.round((1 - memberHourly / guestHourly) * 100))
    : null;
  const breakEvenHours = annual != null && credit != null && guestHourly != null && memberHourly != null && guestHourly > memberHourly
    ? Math.max(0, (annual - credit) / (guestHourly - memberHourly))
    : null;

  const subtitle = savingPct != null
    ? (de ? `${savingPct} % günstiger auf Mieten.` : fr ? `–${savingPct} % sur vos locations.` : `Save ${savingPct}% on rentals.`)
    : (de ? "Der Kundentarif für regelmäßige Nutzer." : fr ? "Le tarif membre pour les utilisateurs réguliers." : "The member rate for frequent users.");

  return (
    <>
      {!open && !premiumJourneyMounted && (
        <button type="button" onClick={() => setOpen(true)} className="kiosk-offers-launcher-button fixed right-[27.5rem] top-4 z-[121] inline-flex h-12 items-center gap-2 rounded-full border border-violet-300/45 bg-violet-600/80 px-5 text-lg font-black text-white shadow-[0_0_30px_rgba(139,92,246,.28)] backdrop-blur-xl transition active:scale-95">
          <BadgePercent className="h-6 w-6 text-violet-100" /> {label}
        </button>
      )}
      {open && (
        <div className="kiosk-offers-modal fixed inset-0 z-[180] grid place-items-center overflow-hidden bg-[#010207]/95 p-8 text-white backdrop-blur-2xl">
          <div className="pointer-events-none absolute -left-[10vw] bottom-[-8vh] h-[48vh] w-[48vw] rounded-full bg-violet-700/20 blur-[80px]" />
          <div className="pointer-events-none absolute right-[-12vw] top-[8vh] h-[46vh] w-[42vw] rounded-full bg-blue-700/15 blur-[90px]" />
          <button onClick={() => setOpen(false)} className="absolute right-8 top-7 z-10 grid h-16 w-16 place-items-center rounded-2xl border border-white/15 bg-white/5" aria-label="Close"><X className="h-8 w-8" /></button>

          <div className="relative grid w-full max-w-[1320px] grid-cols-[1.15fr_.85fr] gap-10 rounded-[2.2rem] border border-violet-300/20 bg-[#050711]/90 p-10 shadow-[0_40px_100px_rgba(0,0,0,.58),0_0_70px_rgba(139,92,246,.12)]">
            <section>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/30 bg-violet-400/10 px-4 py-2 text-sm font-black uppercase tracking-[.16em] text-violet-200"><Crown className="h-5 w-5" /> {plan?.name ?? "Client Chargeurs"}</div>
              <h1 className="max-w-3xl text-6xl font-black leading-[.92] tracking-[-.06em]">{title}</h1>
              <p className="mt-5 text-3xl font-black text-violet-300">{subtitle}</p>

              {loading && !plan ? (
                <div className="mt-10 flex items-center gap-3 text-xl text-white/60"><Loader2 className="h-7 w-7 animate-spin" /> Chargement de l’offre…</div>
              ) : (
                <>
                  <div className="mt-8 flex items-end gap-3">
                    <strong className="text-7xl font-black">{money(annual, currency)}</strong>
                    <span className="pb-2 text-xl text-white/60">{de ? "/ Jahr" : fr ? "/ an" : "/ year"}</span>
                  </div>
                  {credit != null && credit > 0 && <p className="mt-2 text-lg text-white/55">{de ? `${money(credit, currency)} Guthaben bei Mitgliedschaft / Verlängerung` : fr ? `${money(credit, currency)} de crédit à l’adhésion / au renouvellement` : `${money(credit, currency)} credit on joining / renewal`}</p>}

                  <div className="mt-8 grid grid-cols-2 gap-4 text-lg font-bold">
                    {memberHourly != null && <Benefit>{money(memberHourly, currency)} / {de ? "Stunde" : fr ? "heure" : "hour"}</Benefit>}
                    {memberCap != null && memberCap > 0 && <Benefit>{de ? "Tageslimit" : fr ? "Plafond journalier" : "Daily cap"} {money(memberCap, currency)}</Benefit>}
                    <Benefit>{de ? "Persönliches Konto & Verlauf" : fr ? "Compte personnel & historique" : "Personal account & history"}</Benefit>
                    <Benefit>{de ? "Vorteile und Treueprogramm" : fr ? "Avantages & fidélité" : "Benefits & loyalty"}</Benefit>
                  </div>

                  {breakEvenHours != null && Number.isFinite(breakEvenHours) && (
                    <div className="mt-8 rounded-2xl border border-violet-300/15 bg-violet-950/20 p-5 text-lg text-white/70">
                      <strong className="text-white">{de ? `Rentabel ab ca. ${breakEvenHours.toFixed(0)} Std./Jahr` : fr ? `Rentable dès ~${breakEvenHours.toFixed(0)} h/an` : `Pays off from ~${breakEvenHours.toFixed(0)} h/year`}</strong><br />
                      {fr ? "Estimation calculée à partir des tarifs et du crédit actuellement configurés." : de ? "Berechnet aus den aktuell konfigurierten Tarifen und dem Guthaben." : "Calculated from the currently configured rates and credit."}
                    </div>
                  )}
                </>
              )}

              <div className="mt-7 flex items-center gap-3 text-sm text-white/50"><ShieldCheck className="h-5 w-5 text-violet-300" />{fr ? "Les conditions affichées proviennent du backend Chargeurs.ch." : de ? "Die angezeigten Konditionen stammen aus dem Chargeurs.ch-Backend." : "Displayed terms come from the Chargeurs.ch backend."}</div>
            </section>

            <aside className="flex flex-col items-center justify-center rounded-[2rem] border border-violet-300/20 bg-white p-8 text-slate-950 shadow-[0_0_45px_rgba(168,85,247,.16)]">
              <QRCodeSVG value={signupUrl} size={300} level="M" includeMargin />
              <strong className="mt-6 text-2xl">{scan}</strong>
              <p className="mt-2 max-w-sm text-center text-base text-slate-500">{fr ? "Inscription sécurisée sur votre téléphone. Aucune donnée personnelle n’est saisie sur la borne." : de ? "Sichere Anmeldung auf Ihrem Smartphone. Keine persönlichen Daten werden an der Station eingegeben." : "Secure signup on your phone. No personal data is entered on the station."}</p>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-14 items-center gap-3 rounded-xl border border-white/8 bg-white/[.035] px-4"><Check className="h-6 w-6 shrink-0 text-violet-300" />{children}</div>;
}
