import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldAlert, Wrench } from "lucide-react";
import { getLockedStation } from "@/lib/kioskLock";
import { LiquidBackground } from "@/components/LiquidBackground";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/i18n/i18n";

const COPY = {
  fr: {
    bootKicker: "BORNE CHARGEURS.CH",
    boot: "Démarrage sécurisé",
    title: "Borne à configurer",
    body: "Cette tablette n’est pas encore liée à une station Chargeurs.ch. Une configuration technique est nécessaire avant de pouvoir démarrer une location.",
    safe: "Aucune location ni aucun paiement ne peut être lancé dans cet état.",
    tech: "Intervention technique requise",
    ref: "Configuration locale absente",
  },
  en: {
    bootKicker: "CHARGEURS.CH KIOSK",
    boot: "Secure startup",
    title: "Kiosk setup required",
    body: "This tablet is not yet linked to a Chargeurs.ch station. Technical setup is required before rentals can start.",
    safe: "No rental or payment can be started in this state.",
    tech: "Technical setup required",
    ref: "Local station configuration missing",
  },
  de: {
    bootKicker: "CHARGEURS.CH AUTOMAT",
    boot: "Sicherer Start",
    title: "Automat muss eingerichtet werden",
    body: "Dieses Tablet ist noch keiner Chargeurs.ch Station zugeordnet. Vor dem Mietstart ist eine technische Einrichtung erforderlich.",
    safe: "In diesem Zustand kann keine Miete oder Zahlung gestartet werden.",
    tech: "Technische Einrichtung erforderlich",
    ref: "Lokale Stationskonfiguration fehlt",
  },
} as const;

// PWA start_url target (/kiosk). The station lock remains the source of truth;
// this component only improves the boot/fallback presentation.
export default function KioskHome() {
  const { lang } = useI18n();
  const [locked, setLocked] = useState<string | null | undefined>(undefined);
  const copy = COPY[lang === "de" || lang === "en" ? lang : "fr"];

  useEffect(() => {
    setLocked(getLockedStation());
  }, []);

  if (locked === undefined) {
    return (
      <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#020817] px-6 text-center">
        <LiquidBackground />
        <section className="relative flex w-full max-w-2xl flex-col items-center rounded-[2.5rem] border border-cyan-200/15 bg-slate-950/70 px-10 py-12 shadow-[0_36px_110px_rgba(0,0,0,.48),0_0_70px_rgba(40,163,255,.10)] backdrop-blur-2xl">
          <BrandLogo size="lg" />
          <span className="mt-8 text-xs font-black uppercase tracking-[.2em] text-cyan-200/55">{copy.bootKicker}</span>
          <Loader2 className="mt-5 h-16 w-16 animate-spin text-cyan-200 drop-shadow-[0_0_22px_rgba(103,232,249,.32)]" />
          <h1 className="mt-5 font-display text-4xl font-black tracking-tight text-white">{copy.boot}</h1>
          <div className="mt-7 h-1.5 w-52 overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-300 to-blue-500 shadow-[0_0_18px_rgba(34,211,238,.55)]" />
          </div>
        </section>
      </div>
    );
  }

  if (locked) return <Navigate to={`/kiosk/${locked}`} replace />;

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#020817] px-8 text-center">
      <LiquidBackground />
      <div aria-hidden className="absolute -left-[14vw] top-[-20vh] h-[62vh] w-[62vh] rounded-full bg-blue-600/15 blur-[130px]" />
      <section className="relative flex w-full max-w-[60rem] flex-col items-center rounded-[2.75rem] border border-amber-200/20 bg-slate-950/72 px-12 py-11 shadow-[0_38px_120px_rgba(0,0,0,.52)] backdrop-blur-2xl">
        <BrandLogo size="lg" />
        <div className="mt-8 grid h-24 w-24 place-items-center rounded-[1.8rem] border border-amber-200/25 bg-amber-300/10 shadow-[0_0_52px_rgba(251,191,36,.12)]">
          <ShieldAlert className="h-12 w-12 text-amber-200" />
        </div>
        <span className="mt-6 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-amber-200/80"><Wrench className="h-4 w-4" />{copy.tech}</span>
        <h1 className="mt-3 font-display text-[clamp(3rem,5vw,5.4rem)] font-black leading-[.92] tracking-[-.05em] text-white">{copy.title}</h1>
        <p className="mt-6 max-w-3xl text-[clamp(1.15rem,1.7vw,1.6rem)] font-semibold leading-relaxed text-slate-200/78">{copy.body}</p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">{copy.safe}</p>
        <div className="mt-8 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-[.12em] text-slate-400">{copy.ref}</div>
      </section>
    </div>
  );
}
