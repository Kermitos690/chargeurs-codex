import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ShieldAlert, Wrench } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LiquidBackground } from "@/components/LiquidBackground";
import { useI18n } from "@/i18n/i18n";
import { PILOT_STATION_IDS, resolveKioskIdentity, type KioskIdentity } from "@/lib/kioskIdentity";

/**
 * Presentation-only guard: resolves the canonical cabinet identity once per
 * mount, corrects the route when the tablet configuration disagrees, and blocks
 * the whole kiosk runtime (no rental, no payment, no ejection can be started)
 * when no valid pilot identity exists. It never falls back to a cabinet id.
 */
export function useKioskIdentity(): KioskIdentity {
  const { stationId } = useParams();
  const [identity, setIdentity] = useState<KioskIdentity>(() => resolveKioskIdentity(stationId));

  useEffect(() => {
    setIdentity(resolveKioskIdentity(stationId));
  }, [stationId]);

  return identity;
}

const COPY = {
  fr: {
    kicker: "IDENTITÉ DE BORNE INVALIDE",
    tech: "Intervention technique requise",
    title: "Borne non identifiée",
    missing: "Aucune identité de borne n’est configurée sur cette tablette.",
    unknown: "L’identifiant de borne demandé ne fait pas partie du parc pilote.",
    safe: "Aucune location, aucun paiement et aucune éjection ne peut être lancé dans cet état.",
    allowed: "Bornes autorisées",
  },
  en: {
    kicker: "INVALID KIOSK IDENTITY",
    tech: "Technical setup required",
    title: "Kiosk not identified",
    missing: "No cabinet identity is configured on this tablet.",
    unknown: "The requested cabinet id is not part of the pilot fleet.",
    safe: "No rental, payment or ejection can be started in this state.",
    allowed: "Allowed cabinets",
  },
  de: {
    kicker: "UNGÜLTIGE AUTOMATEN-IDENTITÄT",
    tech: "Technische Einrichtung erforderlich",
    title: "Automat nicht identifiziert",
    missing: "Auf diesem Tablet ist keine Automaten-Identität konfiguriert.",
    unknown: "Die angeforderte Automaten-ID gehört nicht zur Pilotflotte.",
    safe: "In diesem Zustand kann keine Miete, Zahlung oder Ausgabe gestartet werden.",
    allowed: "Zugelassene Automaten",
  },
} as const;

export function KioskIdentityGate({ children }: { children: ReactNode }) {
  const { stationId } = useParams();
  const { lang } = useI18n();
  const identity = useKioskIdentity();
  const copy = COPY[lang === "de" || lang === "en" ? lang : "fr"];
  const requested = useMemo(() => (stationId ?? "").trim().toUpperCase(), [stationId]);

  if (identity.redirectTo) return <Navigate to={identity.redirectTo} replace />;

  if (!identity.stationId) {
    return (
      <div
        className="kiosk-identity-error relative grid min-h-screen place-items-center overflow-hidden bg-[#020817] px-8 text-center"
        data-kiosk-identity-error={identity.error ?? "STATION_MISSING"}
      >
        <LiquidBackground />
        <section className="relative flex w-full max-w-[58rem] flex-col items-center rounded-[2.75rem] border border-amber-200/20 bg-slate-950/75 px-12 py-11 backdrop-blur-2xl">
          <BrandLogo size="lg" />
          <div className="mt-8 grid h-24 w-24 place-items-center rounded-[1.8rem] border border-amber-200/25 bg-amber-300/10">
            <ShieldAlert className="h-12 w-12 text-amber-200" />
          </div>
          <span className="mt-6 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-amber-200/80">
            <Wrench className="h-4 w-4" />{copy.tech}
          </span>
          <span className="mt-3 text-xs font-black uppercase tracking-[.2em] text-cyan-200/60">{copy.kicker}</span>
          <h1 className="mt-3 font-display text-[clamp(2.6rem,4.4vw,4.6rem)] font-black leading-[.94] tracking-[-.04em] text-white">
            {copy.title}
          </h1>
          <p className="mt-6 max-w-3xl text-[clamp(1.05rem,1.6vw,1.5rem)] font-semibold leading-relaxed text-slate-200/80">
            {identity.error === "STATION_NOT_IN_PILOT_FLEET" ? copy.unknown : copy.missing}
          </p>
          {requested && (
            <p className="mt-4 font-mono text-sm text-slate-400">{requested}</p>
          )}
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">{copy.safe}</p>
          <div className="mt-8 rounded-full border border-white/10 bg-white/5 px-5 py-2 font-mono text-xs tracking-[.08em] text-slate-400">
            {copy.allowed}: {PILOT_STATION_IDS.join(" · ")}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="kiosk-identity-scope contents"
      data-kiosk-station={identity.stationId}
      data-kiosk-terminal={identity.terminalAvailable ? "true" : "false"}
    >
      {children}
    </div>
  );
}
