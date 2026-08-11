import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/i18n/i18n";

export type KioskScene =
  | "home"
  | "member"
  | "connected"
  | "selection"
  | "pricing"
  | "starting"
  | "payment"
  | "release"
  | "active"
  | "return"
  | "expired"
  | "error"
  | "support"
  | "loading"
  | "other";

export type KioskReturnStage = "settling" | "support" | "completed" | "unknown";

type ProgressLanguage = "fr" | "en" | "de";

type ProgressConfig = {
  labels: string[];
  active: number;
  client: boolean;
};

const TRANSIENT_SCENES = new Set<KioskScene>(["expired", "error", "support", "loading", "other"]);

function returnOverlay(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('div[class*="z-[120]"][class*="fixed"][class*="inset-0"]');
}

export function detectKioskReturnStage(overlay: Element | null): KioskReturnStage {
  if (!overlay) return "unknown";
  if (overlay.querySelector(".lucide-receipt-text")) return "settling";
  if (overlay.querySelector('[class*="text-warning"]')) return "support";
  if (overlay.querySelector('[class*="text-success"]')) return "completed";
  return "unknown";
}

export function detectKioskScene(root: ParentNode = document): KioskScene {
  const overlay = returnOverlay(root);
  if (overlay) {
    overlay.classList.add("kv3-return-overlay");
    return "return";
  }
  if (root.querySelector(".kiosk-quarantine")) return "support";
  if (root.querySelector(".ck2-loading")) return "loading";
  if (root.querySelector(".ck2-home")) return "home";
  if (root.querySelector(".ck2-member")) return "member";
  if (root.querySelector(".ck2-connected")) return "connected";
  if (root.querySelector(".kiosk-idle-stage")) return "selection";
  if (root.querySelector(".kiosk-pricing-stage")) return "pricing";
  if (root.querySelector(".kiosk-qr-stage")) return "payment";
  if (root.querySelector('.kiosk-release-stage:not([data-kiosk-timeout-owner="inner"])')) return "release";
  if (root.querySelector(".kiosk-ready-stage") || root.querySelector(".kiosk-root .bg-gradient-success")) return "active";
  if (root.querySelector(".kv3-product-layer .lucide-lock")) return "support";

  const main = root.querySelector(".kiosk-root main");
  if (!main) return "other";

  if (main.querySelector(".lucide-alert-triangle")) {
    return main.querySelector('[class*="bg-warning"]') ? "support" : "error";
  }
  if (main.querySelector(".lucide-clock") && main.querySelector(".lucide-refresh-cw")) return "expired";
  if (
    (main.querySelector(".lucide-loader-circle") || main.querySelector(".lucide-loader-2")) &&
    main.querySelector('[class*="text-3xl"]')
  ) return "starting";
  if (main.querySelector(".lucide-loader-circle") || main.querySelector(".lucide-loader-2")) return "loading";

  return "other";
}

export function buildKioskProgressConfig(
  scene: KioskScene,
  journey: string,
  lang: ProgressLanguage,
  lastTransactionalScene: KioskScene | null = null,
): ProgressConfig {
  const effectiveScene = TRANSIENT_SCENES.has(scene) && lastTransactionalScene ? lastTransactionalScene : scene;
  const client = journey === "client" || effectiveScene === "member" || effectiveScene === "connected";
  const fr = lang === "fr";
  const de = lang === "de";
  const labels = client
    ? de ? ["VERBINDUNG", "AUSWAHL", "ZAHLUNG", "ENTNEHMEN", "RÜCKGABE"]
      : fr ? ["CONNEXION", "SÉLECTION", "PAIEMENT", "RETIRER", "RETOUR"]
        : ["CONNECT", "SELECT", "PAYMENT", "COLLECT", "RETURN"]
    : de ? ["AUSWAHL", "ZAHLUNG", "AUSGABE", "MIETE", "RÜCKGABE"]
      : fr ? ["CHOIX", "PAIEMENT", "DÉPART", "LOCATION", "RETOUR"]
        : ["CHOOSE", "PAYMENT", "RELEASE", "RENTAL", "RETURN"];

  let active = 1;
  if (effectiveScene === "return") active = 5;
  else if (client) {
    if (effectiveScene === "selection" || effectiveScene === "pricing") active = 2;
    else if (effectiveScene === "starting" || effectiveScene === "payment") active = 3;
    else if (effectiveScene === "release" || effectiveScene === "active") active = 4;
  } else {
    if (effectiveScene === "starting" || effectiveScene === "payment") active = 2;
    else if (effectiveScene === "release") active = 3;
    else if (effectiveScene === "active") active = 4;
  }

  return { labels, active, client };
}

export function shouldShowKioskProgress(scene: KioskScene, lastTransactionalScene: KioskScene | null): boolean {
  if (scene === "home" || scene === "loading") return false;
  if (TRANSIENT_SCENES.has(scene) && !lastTransactionalScene) return false;
  return true;
}

const TRACKABLE_SCENES = new Set<KioskScene>([
  "member",
  "connected",
  "selection",
  "pricing",
  "starting",
  "payment",
  "release",
  "active",
  "return",
]);

export function KioskV3JourneyChrome() {
  const { lang } = useI18n();
  const [scene, setScene] = useState<KioskScene>(() => detectKioskScene());
  const [journey, setJourney] = useState<string>(() => document.documentElement.dataset.kioskJourney ?? "");
  const [lastTransactionalScene, setLastTransactionalScene] = useState<KioskScene | null>(() => {
    const value = document.documentElement.dataset.kioskLastScene as KioskScene | undefined;
    return value && TRACKABLE_SCENES.has(value) ? value : null;
  });

  useEffect(() => {
    const detect = () => {
      const nextScene = detectKioskScene();
      const nextJourney = document.documentElement.dataset.kioskJourney ?? "";
      setScene((current) => current === nextScene ? current : nextScene);
      setJourney((current) => current === nextJourney ? current : nextJourney);
      document.documentElement.dataset.kioskScene = nextScene;

      if (TRACKABLE_SCENES.has(nextScene)) {
        setLastTransactionalScene((current) => current === nextScene ? current : nextScene);
        document.documentElement.dataset.kioskLastScene = nextScene;
      }

      const overlay = returnOverlay();
      if (overlay) document.documentElement.dataset.kioskReturnStage = detectKioskReturnStage(overlay);
      else delete document.documentElement.dataset.kioskReturnStage;
    };
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const timer = window.setInterval(detect, 350);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      delete document.documentElement.dataset.kioskScene;
      delete document.documentElement.dataset.kioskLastScene;
      delete document.documentElement.dataset.kioskReturnStage;
    };
  }, []);

  const config = useMemo(
    () => buildKioskProgressConfig(scene, journey, lang, lastTransactionalScene),
    [journey, lang, scene, lastTransactionalScene],
  );

  if (!shouldShowKioskProgress(scene, lastTransactionalScene)) return null;

  const progressLabel = lang === "de" ? "Fortschritt" : lang === "en" ? "Progress" : "Progression";

  return (
    <div
      className={`kv3-progress-rail ${config.client ? "is-client" : "is-express"}`}
      data-scene={scene}
      aria-label={progressLabel}
    >
      {config.labels.map((label, index) => {
        const step = index + 1;
        const done = step < config.active;
        const current = step === config.active;
        return (
          <div className={`kv3-progress-step ${done ? "is-done" : ""} ${current ? "is-current" : ""}`} key={label}>
            <span aria-current={current ? "step" : undefined}>{done ? <Check /> : step}</span>
            <small>{label}</small>
          </div>
        );
      })}
    </div>
  );
}
