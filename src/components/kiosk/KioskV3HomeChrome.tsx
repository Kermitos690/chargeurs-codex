import { useLayoutEffect, useState } from "react";
import { HelpCircle, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import { useI18n } from "@/i18n/i18n";

/**
 * Home-only utility chrome.
 *
 * Primary journey decisions remain exclusively in KioskPremiumGateV2
 * (Express / Client). Passes and member benefits belong to the Client journey,
 * so this chrome deliberately does not add a third competing home action.
 *
 * Visibility is resolved in a layout effect so the underlying V2 chrome never
 * gets a painted frame before this V3 chrome is ready on physical WebViews.
 */
export function KioskV3HomeChrome() {
  const { lang } = useI18n();
  const [visible, setVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    const detect = () => setVisible(Boolean(document.querySelector(".ck2-home")));
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!visible) return null;

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
          <button type="button" className="kv3-home-control" onClick={refreshReadOnly} disabled={refreshing} aria-label={refresh} title={refresh}>
            <RefreshCw className={refreshing ? "kv3-spin" : ""} /> <span>{refresh}</span>
          </button>
          <button type="button" className="kv3-home-control" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))} aria-label={help} title={help}>
            <HelpCircle /> <span>{help}</span>
          </button>
          <div className="kv3-home-language"><LanguageSwitcher /></div>
        </div>
      </header>

      <div className="kv3-payment-dock" aria-label={payments}>
        <span className="kv3-payment-label">{payments}</span>
        <KioskPaymentMarks cardLabel="" />
      </div>
    </>
  );
}
