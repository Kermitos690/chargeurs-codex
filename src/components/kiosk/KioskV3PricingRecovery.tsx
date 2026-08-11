import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n/i18n";

function pricingUnavailable() {
  return Boolean(document.querySelector(".kiosk-pricing-stage > p.text-warning"));
}

function clickExistingKioskRefresh() {
  const header = document.querySelector(".kiosk-root > header");
  if (!header) return false;
  const buttons = Array.from(header.querySelectorAll<HTMLButtonElement>("button"));
  const refresh = buttons.find((button) => button.querySelector(".lucide-refresh-cw"));
  if (!refresh || refresh.disabled) return false;
  refresh.click();
  return true;
}

/**
 * Presentation-only recovery control for a failed/missing pricing quote.
 * It never supplies a tariff. Retry delegates to the existing Kiosk refresh
 * action, which remains the only owner of quote/station/slot reloading.
 */
export function KioskV3PricingRecovery() {
  const { lang } = useI18n();
  const [visible, setVisible] = useState(() => pricingUnavailable());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const detect = () => setVisible(pricingUnavailable());
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const timer = window.setInterval(detect, 600);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const retry = useCallback(() => {
    if (retrying) return;
    const started = clickExistingKioskRefresh();
    if (!started) return;
    setRetrying(true);
    window.setTimeout(() => setRetrying(false), 1500);
  }, [retrying]);

  if (!visible) return null;

  const copy = lang === "de"
    ? {
        kicker: "TARIF WIRD GEPRÜFT",
        title: "Tarif vorübergehend nicht verfügbar",
        body: "Versuchen Sie die Tarifabfrage erneut. Es wird kein Preis erfunden oder ersetzt.",
        retry: "Tarif erneut prüfen",
        retrying: "Wird geprüft…",
      }
    : lang === "en"
      ? {
          kicker: "PRICE CHECK",
          title: "Pricing temporarily unavailable",
          body: "Retry the live price check. No fallback price will be invented or substituted.",
          retry: "Retry price check",
          retrying: "Checking…",
        }
      : {
          kicker: "VÉRIFICATION DU TARIF",
          title: "Tarif momentanément indisponible",
          body: "Relancez la vérification du tarif réel. Aucun prix de secours ne sera inventé ni substitué.",
          retry: "Réessayer le tarif",
          retrying: "Vérification…",
        };

  return (
    <aside className="kv3-pricing-recovery" role="status" aria-live="polite">
      <span className="kv3-pricing-recovery-kicker"><ShieldCheck aria-hidden="true" />{copy.kicker}</span>
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      <button type="button" onClick={retry} disabled={retrying}>
        <RefreshCw aria-hidden="true" className={retrying ? "is-spinning" : ""} />
        {retrying ? copy.retrying : copy.retry}
      </button>
    </aside>
  );
}
