import { useCallback, useEffect, useState } from "react";
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

function currentHelpContext() {
  const scene = document.documentElement.dataset.kioskScene;
  if (scene === "pricing") return "price";
  if (scene === "starting" || scene === "payment" || scene === "expired") return "payment";
  if (scene === "release" || scene === "active") return "release";
  if (scene === "return") return "return";
  return "rent";
}

/**
 * FAQ is available on every kiosk sub-flow. The full Kiosk screen owns its
 * header Help button. The premium V3 home also owns a Help control in its
 * dedicated top bar, so the global floating trigger must stay hidden there.
 *
 * Opening help stores only a presentation context on <html>; the FAQ content
 * remains unchanged and the CSS layer simply promotes the most relevant topic.
 * The React FAQ is the single visible help owner; any stale pre-V3 imperative
 * overlay is removed defensively before opening it.
 */
export function KioskHelpLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [mainKioskMounted, setMainKioskMounted] = useState(false);
  const [premiumHomeOwnsHelp, setPremiumHomeOwnsHelp] = useState(false);
  const stationId = stationFromPath(location.pathname);

  const openContextualHelp = useCallback(() => {
    document.getElementById("chargeurs-kiosk-help-overlay")?.remove();
    document.documentElement.dataset.kioskHelpContext = currentHelpContext();
    setOpen(true);
  }, []);

  const closeHelp = useCallback(() => {
    delete document.documentElement.dataset.kioskHelpContext;
    setOpen(false);
  }, []);

  useEffect(() => {
    const openHelp = () => openContextualHelp();
    window.addEventListener("chargeurs:open-kiosk-help", openHelp);
    return () => window.removeEventListener("chargeurs:open-kiosk-help", openHelp);
  }, [openContextualHelp]);

  useEffect(() => {
    delete document.documentElement.dataset.kioskHelpContext;
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => () => {
    delete document.documentElement.dataset.kioskHelpContext;
  }, []);

  useEffect(() => {
    if (!stationId) {
      setMainKioskMounted(false);
      setPremiumHomeOwnsHelp(false);
      return;
    }
    const detect = () => {
      setMainKioskMounted(Boolean(document.querySelector(".kiosk-root > header")));
      setPremiumHomeOwnsHelp(Boolean(document.querySelector(".ck2-home")));
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stationId]);

  if (!stationId) return null;

  return (
    <>
      {!open && !mainKioskMounted && !premiumHomeOwnsHelp && (
        <button
          type="button"
          onClick={openContextualHelp}
          className="kiosk-global-help fixed right-[14.5rem] top-4 z-[120] inline-flex h-12 items-center gap-2 rounded-full border border-white/15 bg-slate-950/55 px-5 text-lg font-black text-white shadow-xl backdrop-blur-xl transition hover:bg-white/10 active:scale-95"
          aria-label={helpLabel(lang)}
        >
          <HelpCircle className="h-6 w-6 text-cyan-200" />
          {helpLabel(lang)}
        </button>
      )}
      {open && (
        <KioskHelpCenter
          lang={lang}
          stationId={stationId}
          supportEmail={BRAND.supportEmail}
          onClose={closeHelp}
        />
      )}
    </>
  );
}
