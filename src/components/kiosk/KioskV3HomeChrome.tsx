import { useEffect, useState } from "react";
import { BadgePercent, HelpCircle, RefreshCw, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import { useI18n } from "@/i18n/i18n";

export function KioskV3HomeChrome() {
  const { lang } = useI18n();
  const [visible, setVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const detect = () => setVisible(Boolean(document.querySelector(".ck2-home")));
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!visible) return null;

  const offers = lang === "de" ? "Pässe & Angebote" : lang === "en" ? "Passes & offers" : "Pass & offres";
  const offersKicker = lang === "de" ? "VORTEILE" : lang === "en" ? "BENEFITS" : "AVANTAGES";
  const offersBody = lang === "de"
    ? "Entdecke Kundentarife, Guthaben und exklusive Vorteile."
    : lang === "en"
      ? "Discover member rates, credit and exclusive benefits."
      : "Découvrez les tarifs membres, le crédit et les avantages exclusifs.";
  const offersCta = lang === "de" ? "ANGEBOTE ANSEHEN" : lang === "en" ? "VIEW OFFERS" : "VOIR LES OFFRES";
  const refresh = lang === "de" ? "Aktualisieren" : lang === "en" ? "Refresh" : "Actualiser";
  const help = lang === "de" ? "Hilfe" : lang === "en" ? "Help" : "Aide";
  const payments = lang === "de" ? "Sicher bezahlen" : lang === "en" ? "Secure payment" : "Paiement sécurisé";

  const refreshReadOnly = () => {
    const underlyingRefresh = document.querySelector<HTMLButtonElement>(".ck2-home .ck2-top-actions > .ck2-pill");
    if (!underlyingRefresh || underlyingRefresh.disabled) return;
    setRefreshing(true);
    underlyingRefresh.click();
    window.setTimeout(() => setRefreshing(false), 1100);
  };

  return (
    <>
      <header className="kv3-home-topbar">
        <div className="kv3-home-brand"><BrandLogo size="md" /></div>
        <div className="kv3-home-actions">
          <button
            type="button"
            className="kv3-home-control"
            onClick={refreshReadOnly}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "kv3-spin" : ""} /> <span>{refresh}</span>
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

      <button
        type="button"
        className="kv3-offer-card"
        onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-offers"))}
      >
        <span className="kv3-offer-icon"><BadgePercent /></span>
        <span className="kv3-offer-kicker">{offersKicker}</span>
        <strong>{offers}</strong>
        <small>{offersBody}</small>
        <span className="kv3-offer-cta"><Sparkles /> {offersCta} <b>→</b></span>
      </button>

      <div className="kv3-payment-dock" aria-label={payments}>
        <span className="kv3-payment-label">{payments}</span>
        <KioskPaymentMarks cardLabel="" />
      </div>
    </>
  );
}
