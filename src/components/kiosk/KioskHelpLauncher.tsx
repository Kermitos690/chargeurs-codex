import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "@/i18n/i18n";
import { BRAND } from "@/config/brand";
import { KioskHelpCenter } from "@/components/kiosk/KioskHelpCenter";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1];
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
 * Recovery mode: this component owns help content only, never a floating trigger.
 * The visible Premium/Home or transaction header is the sole control owner and
 * opens help through `chargeurs:open-kiosk-help`. This removes the cold-boot
 * race where the global launcher briefly rendered before the kiosk DOM mounted.
 */
export function KioskHelpLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const stationId = stationFromPath(location.pathname);

  const openContextualHelp = useCallback(() => {
    if (!stationId) return;
    document.getElementById("chargeurs-kiosk-help-overlay")?.remove();
    document.documentElement.dataset.kioskHelpContext = currentHelpContext();
    setOpen(true);
  }, [stationId]);

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

  if (!stationId || !open) return null;

  return (
    <KioskHelpCenter
      lang={lang}
      stationId={stationId}
      supportEmail={BRAND.supportEmail}
      onClose={closeHelp}
    />
  );
}
