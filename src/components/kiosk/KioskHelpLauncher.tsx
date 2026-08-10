import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useI18n } from "@/i18n/i18n";
import { BRAND } from "@/config/brand";
import { KioskHelpCenter } from "@/components/kiosk/KioskHelpCenter";

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1];
}

export function KioskHelpLauncher() {
  const location = useLocation();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const stationId = stationFromPath(location.pathname);
  if (!stationId) return null;

  const label = lang === "de" ? "Hilfe" : lang === "en" ? "Help" : "Aide";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kiosk-global-help fixed right-[12.8rem] top-4 z-[60] inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-slate-950/45 px-5 text-base font-black text-white shadow-lg backdrop-blur-xl transition hover:bg-white/10 active:scale-95"
        aria-label={label}
      >
        <HelpCircle className="h-5 w-5 text-cyan-200" />{label}
      </button>
      {open && <KioskHelpCenter lang={lang} stationId={stationId} supportEmail={BRAND.supportEmail} onClose={() => setOpen(false)} />}
    </>
  );
}
