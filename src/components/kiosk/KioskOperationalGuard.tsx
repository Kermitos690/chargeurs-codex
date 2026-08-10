import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, HelpCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { readKioskToken } from "@/lib/kioskFetch";
import { useI18n } from "@/i18n/i18n";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1] ?? null;
}

type StatusResponse = {
  ok?: boolean;
  blocked?: boolean;
  reason_code?: string | null;
  station?: { last_sync_at?: string | null } | null;
};

const COPY = {
  fr: {
    eyebrow: "Sécurité de la borne",
    title: "Borne temporairement indisponible",
    body: "Cette borne est en cours de vérification technique. Aucune nouvelle location ne peut être démarrée pour le moment.",
    note: "Vous ne serez pas débité en essayant de démarrer une nouvelle location pendant ce blocage.",
    refresh: "Vérifier à nouveau",
    help: "Aide",
    reference: "Référence technique",
  },
  en: {
    eyebrow: "Kiosk safety",
    title: "Kiosk temporarily unavailable",
    body: "This kiosk is undergoing a technical safety check. No new rental can be started right now.",
    note: "You will not be charged for attempting to start a new rental while this safety block is active.",
    refresh: "Check again",
    help: "Help",
    reference: "Technical reference",
  },
  de: {
    eyebrow: "Automatensicherheit",
    title: "Automat vorübergehend nicht verfügbar",
    body: "Dieser Automat wird technisch überprüft. Zurzeit kann keine neue Miete gestartet werden.",
    note: "Während dieser Sicherheitsblockierung wird für einen neuen Mietversuch nichts belastet.",
    refresh: "Erneut prüfen",
    help: "Hilfe",
    reference: "Technische Referenz",
  },
} as const;

export function KioskOperationalGuard() {
  const location = useLocation();
  const { lang } = useI18n();
  const stationId = useMemo(() => stationFromPath(location.pathname), [location.pathname]);
  const copy = COPY[lang === "de" || lang === "en" ? lang : "fr"];
  const [blocked, setBlocked] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (!stationId) {
      setBlocked(false);
      setReason(null);
      return;
    }
    const token = readKioskToken();
    if (!token) return;
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke<StatusResponse>("kiosk-operational-status", {
        body: { stationId },
        headers: { "X-Kiosk-Token": token },
      });
      if (!error && data?.ok) {
        setBlocked(Boolean(data.blocked));
        setReason(data.reason_code ?? null);
      }
    } finally {
      setChecking(false);
    }
  }, [stationId]);

  useEffect(() => {
    void check();
    if (!stationId) return;
    const timer = window.setInterval(() => void check(), 8_000);
    return () => window.clearInterval(timer);
  }, [check, stationId]);

  if (!stationId || !blocked) return null;

  return (
    <div className="kiosk-quarantine fixed inset-0 z-[250] grid place-items-center overflow-hidden bg-[#020817]/96 p-8 backdrop-blur-2xl" role="alertdialog" aria-modal="true" aria-label={copy.title}>
      <div aria-hidden className="absolute -left-[10vw] top-[-16vh] h-[58vh] w-[58vh] rounded-full bg-blue-600/20 blur-[120px]" />
      <div aria-hidden className="absolute -bottom-[22vh] right-[-8vw] h-[66vh] w-[66vh] rounded-full bg-violet-600/20 blur-[130px]" />
      <section className="relative flex w-full max-w-[66rem] flex-col items-center rounded-[2.75rem] border border-amber-200/20 bg-slate-950/65 px-12 py-11 text-center shadow-[0_36px_120px_rgba(0,0,0,.55)]">
        <div className="grid h-28 w-28 place-items-center rounded-[2rem] border border-amber-200/30 bg-amber-300/10 shadow-[0_0_60px_rgba(251,191,36,.16)]">
          <ShieldAlert className="h-14 w-14 text-amber-200" />
        </div>
        <div className="mt-7 text-lg font-black uppercase tracking-[.18em] text-amber-200">{copy.eyebrow}</div>
        <h1 className="mt-3 max-w-4xl font-display text-[clamp(3rem,5.4vw,5.8rem)] font-black leading-[.94] tracking-[-.05em] text-white">{copy.title}</h1>
        <p className="mt-6 max-w-3xl text-[clamp(1.35rem,2vw,2rem)] font-semibold leading-snug text-slate-200">{copy.body}</p>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-400">{copy.note}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <button type="button" onClick={() => void check()} disabled={checking} className="inline-flex min-h-16 items-center gap-3 rounded-full bg-white px-8 text-xl font-black text-slate-950 shadow-xl transition active:scale-[.98] disabled:opacity-70">
            <RefreshCw className={`h-6 w-6 ${checking ? "animate-spin" : ""}`} />{copy.refresh}
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))} className="inline-flex min-h-16 items-center gap-3 rounded-full border border-white/20 bg-white/5 px-8 text-xl font-black text-white transition hover:bg-white/10 active:scale-[.98]">
            <HelpCircle className="h-6 w-6" />{copy.help}
          </button>
        </div>
        {reason && <div className="mt-8 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-slate-400"><AlertTriangle className="h-4 w-4" />{copy.reference}: <span className="font-mono">{reason}</span></div>}
      </section>
    </div>
  );
}
