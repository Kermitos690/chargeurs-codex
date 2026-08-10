import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { BadgePercent, Check, Crown, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useI18n } from "@/i18n/i18n";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1];
}

export function KioskOffersLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const stationId = stationFromPath(location.pathname);
  const [open, setOpen] = useState(false);
  const [mainJourneyMounted, setMainJourneyMounted] = useState(false);

  useEffect(() => {
    if (!stationId) return;
    const detect = () => setMainJourneyMounted(Boolean(document.querySelector(".kiosk-root > header")));
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stationId]);

  useEffect(() => setOpen(false), [location.pathname]);

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
  const title = de ? "Chargeurs Kunde werden" : fr ? "Devenez Client Chargeurs" : "Become a Chargeurs Member";
  const subtitle = de ? "50 % günstiger laden. Das ganze Jahr." : fr ? "–50 % sur vos locations. Toute l’année." : "Save 50% on rentals. All year.";
  const scan = de ? "Scannen, um beizutreten" : fr ? "Scannez pour adhérer" : "Scan to join";

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-[27.5rem] top-4 z-[121] inline-flex h-12 items-center gap-2 rounded-full border border-cyan-300/20 bg-slate-950/60 px-5 text-lg font-black text-white shadow-xl backdrop-blur-xl transition hover:bg-white/10 active:scale-95"
        >
          <BadgePercent className="h-6 w-6 text-cyan-200" /> {label}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-[180] grid place-items-center bg-[#02050b]/95 p-8 text-white backdrop-blur-2xl">
          <button onClick={() => setOpen(false)} className="absolute right-8 top-7 grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/5" aria-label="Close">
            <X className="h-7 w-7" />
          </button>
          <div className="grid w-full max-w-6xl grid-cols-[1.15fr_.85fr] gap-12 rounded-[2.2rem] border border-white/10 bg-white/[.035] p-12 shadow-2xl">
            <section>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-4 py-2 text-sm font-black uppercase tracking-[.16em] text-cyan-200"><Crown className="h-4 w-4" /> Client Chargeurs</div>
              <h1 className="max-w-3xl text-6xl font-black leading-[.94] tracking-[-.055em]">{title}</h1>
              <p className="mt-5 text-3xl font-black text-cyan-300">{subtitle}</p>
              <div className="mt-8 flex items-end gap-3"><strong className="text-7xl font-black">49 CHF</strong><span className="pb-2 text-xl text-white/60">/ an</span></div>
              <p className="mt-2 text-lg text-white/55">≈ 4.08 CHF / mois · 10 CHF de crédit inclus au renouvellement</p>
              <div className="mt-8 grid grid-cols-2 gap-4 text-lg font-bold">
                {["0.75 CHF / heure", "Plafond 9 CHF / jour", "Pass Apple / Google Wallet", "Compte personnel & fidélité"].map((item) => <div key={item} className="flex items-center gap-3"><Check className="h-6 w-6 text-emerald-300" />{item}</div>)}
              </div>
              <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5 text-lg text-white/70"><strong className="text-white">Rentable dès ~4 h 20 / mois</strong><br />par rapport au tarif Express à 1.50 CHF/h, après prise en compte du crédit annuel de 10 CHF.</div>
            </section>
            <aside className="flex flex-col items-center justify-center rounded-[2rem] border border-cyan-300/15 bg-white p-8 text-slate-950">
              <QRCodeSVG value={signupUrl} size={300} level="M" includeMargin />
              <strong className="mt-6 text-2xl">{scan}</strong>
              <p className="mt-2 text-center text-base text-slate-500">Inscription sécurisée sur votre téléphone. Votre pass Wallet sera rattaché à votre compte Client Chargeurs.</p>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
