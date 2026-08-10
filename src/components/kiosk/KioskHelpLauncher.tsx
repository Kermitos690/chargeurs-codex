import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { useI18n } from "@/i18n/i18n";
import { BRAND } from "@/config/brand";
import { KioskHelpCenter } from "@/components/kiosk/KioskHelpCenter";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1];
}

function helpLabel(lang: string) {
  return lang === "de" ? "Hilfe" : lang === "en" ? "Help" : "Aide";
}

/**
 * One canonical FAQ surface for the entire kiosk route. The full Kiosk screen
 * already owns a header Help trigger; entry, pairing and recovery screens do
 * not. A MutationObserver keeps one floating trigger visible only while the
 * inner `.kiosk-root` surface is absent, so Help is always reachable without
 * rendering duplicate buttons once the main kiosk UI is mounted.
 */
export function KioskHelpLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [innerKioskMounted, setInnerKioskMounted] = useState(false);
  const stationId = stationFromPath(location.pathname);

  useEffect(() => {
    const openHelp = () => setOpen(true);
    window.addEventListener("chargeurs:open-kiosk-help", openHelp);
    return () => window.removeEventListener("chargeurs:open-kiosk-help", openHelp);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!stationId) {
      setInnerKioskMounted(false);
      return;
    }
    const detect = () => setInnerKioskMounted(Boolean(document.querySelector(".kiosk-root")));
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stationId]);

  if (!stationId) return null;

  return (
    <>
      {!open && !innerKioskMounted && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-[12.5rem] top-4 z-[120] inline-flex h-12 items-center gap-2 rounded-full border border-white/15 bg-slate-950/55 px-5 text-base font-black text-white shadow-xl backdrop-blur-xl transition hover:bg-white/10 active:scale-95"
          aria-label={helpLabel(lang)}
        >
          <HelpCircle className="h-5 w-5 text-cyan-200" />
          {helpLabel(lang)}
        </button>
      )}
      {open && (
        <KioskHelpCenter
          lang={lang}
          stationId={stationId}
          supportEmail={BRAND.supportEmail}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
