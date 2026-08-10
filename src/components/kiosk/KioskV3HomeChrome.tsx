import { useEffect, useState } from "react";
import { BadgePercent, HelpCircle, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import { useI18n } from "@/i18n/i18n";

export function KioskV3HomeChrome() {
  const { lang } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const detect = () => setVisible(Boolean(document.querySelector(".ck2-home")));
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!visible) return null;

  const offers = lang === "de" ? "Angebote" : lang === "en" ? "Offers" : "Offres";
  const refresh = lang === "de" ? "Aktualisieren" : lang === "en" ? "Refresh" : "Actualiser";
  const help = lang === "de" ? "Hilfe" : lang === "en" ? "Help" : "Aide";

  return (
    <>
      <header className="kv3-home-topbar">
        <div className="kv3-home-brand"><BrandLogo size="md" /></div>
        <div className="kv3-home-actions">
          <button
            type="button"
            className="kv3-home-control kv3-home-offers"
            onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-offers"))}
          >
            <BadgePercent /> <span>{offers}</span>
          </button>
          <button
            type="button"
            className="kv3-home-control"
            onClick={() => window.location.reload()}
          >
            <RefreshCw /> <span>{refresh}</span>
          </button>
          <button
            type="button"
            className="kv3-home-control"
            onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))}
          >
            <HelpCircle /> <span>{help}</span>
          </button>
          <div className="kv3-home-language"><LanguageSwitcher /></div>
        </div>
      </header>

      <div className="kv3-payment-dock" aria-label="Moyens de paiement acceptés">
        <KioskPaymentMarks cardLabel="" />
      </div>
    </>
  );
}
