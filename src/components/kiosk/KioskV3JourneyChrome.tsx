import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/i18n/i18n";

type Scene = "home" | "member" | "connected" | "selection" | "pricing" | "payment" | "release" | "active" | "other";

function detectScene(): Scene {
  if (document.querySelector(".ck2-home")) return "home";
  if (document.querySelector(".ck2-member")) return "member";
  if (document.querySelector(".ck2-connected")) return "connected";
  if (document.querySelector(".kiosk-idle-stage")) return "selection";
  if (document.querySelector(".kiosk-pricing-stage")) return "pricing";
  if (document.querySelector(".kiosk-qr-stage")) return "payment";
  if (document.querySelector(".kiosk-release-stage")) return "release";
  if (document.querySelector(".kiosk-root .bg-gradient-success")) return "active";
  return "other";
}

export function KioskV3JourneyChrome() {
  const { lang } = useI18n();
  const [scene, setScene] = useState<Scene>(() => detectScene());
  const [journey, setJourney] = useState<string>(() => document.documentElement.dataset.kioskJourney ?? "");

  useEffect(() => {
    const detect = () => {
      const nextScene = detectScene();
      const nextJourney = document.documentElement.dataset.kioskJourney ?? "";
      setScene(nextScene);
      setJourney(nextJourney);
      document.documentElement.dataset.kioskScene = nextScene;
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const timer = window.setInterval(detect, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      delete document.documentElement.dataset.kioskScene;
    };
  }, []);

  const config = useMemo(() => {
    const fr = lang === "fr";
    const de = lang === "de";
    const client = journey === "client" || scene === "member" || scene === "connected";
    const labels = client
      ? de ? ["VERBINDUNG", "AUSWAHL", "ZAHLUNG", "ENTNEHMEN", "RÜCKGABE"]
        : fr ? ["CONNEXION", "SÉLECTION", "PAIEMENT", "RETIRER", "RETOUR"]
          : ["CONNECT", "SELECT", "PAYMENT", "COLLECT", "RETURN"]
      : de ? ["AUSWAHL", "ZAHLUNG", "AUSGABE", "MIETE", "RÜCKGABE"]
        : fr ? ["CHOIX", "PAIEMENT", "DÉPART", "LOCATION", "RETOUR"]
          : ["CHOOSE", "PAYMENT", "RELEASE", "RENTAL", "RETURN"];

    let active = 1;
    if (client) {
      if (scene === "selection" || scene === "pricing") active = 2;
      else if (scene === "payment") active = 3;
      else if (scene === "release" || scene === "active") active = 4;
    } else {
      if (scene === "payment") active = 2;
      else if (scene === "release") active = 3;
      else if (scene === "active") active = 4;
    }
    return { labels, active, client };
  }, [journey, lang, scene]);

  if (scene === "home" || scene === "other") return null;

  return (
    <div className={`kv3-progress-rail ${config.client ? "is-client" : "is-express"}`} aria-label="Progression">
      {config.labels.map((label, index) => {
        const step = index + 1;
        const done = step < config.active;
        const current = step === config.active;
        return (
          <div className={`kv3-progress-step ${done ? "is-done" : ""} ${current ? "is-current" : ""}`} key={label}>
            <span>{done ? <Check /> : step}</span>
            <small>{label}</small>
          </div>
        );
      })}
    </div>
  );
}
