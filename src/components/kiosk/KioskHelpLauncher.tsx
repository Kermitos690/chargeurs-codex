import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "@/i18n/i18n";
import { BRAND } from "@/config/brand";
import { KioskHelpCenter } from "@/components/kiosk/KioskHelpCenter";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1];
}

/**
 * One canonical FAQ surface for the kiosk. Kiosk.tsx owns the visible Aide
 * button in its header and dispatches `chargeurs:open-kiosk-help`; this global
 * launcher keeps the full FAQ mounted above every kiosk sub-flow, including
 * pairing/recovery screens, without duplicating a second floating Help button.
 */
export function KioskHelpLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const stationId = stationFromPath(location.pathname);

  useEffect(() => {
    const openHelp = () => setOpen(true);
    window.addEventListener("chargeurs:open-kiosk-help", openHelp);
    return () => window.removeEventListener("chargeurs:open-kiosk-help", openHelp);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!stationId || !open) return null;

  return (
    <KioskHelpCenter
      lang={lang}
      stationId={stationId}
      supportEmail={BRAND.supportEmail}
      onClose={() => setOpen(false)}
    />
  );
}
