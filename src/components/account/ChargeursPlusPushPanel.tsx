import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BellOff, BellRing, CheckCircle2, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  disableChargeursPushNotifications,
  enableAllChargeursPushNotifications,
  getChargeursPushStatus,
  sendChargeursPushTest,
  type ChargeursPushStatus,
} from "@/pwa/pushNotifications";

type BusyAction = "enable" | "disable" | "test" | "refresh" | null;

const TOPIC_LABELS: Record<string, string> = {
  payment: "Paiement",
  rental: "Location",
  reminders: "Rappels",
  return: "Retour",
  receipt: "Reçu",
  support: "Alertes",
  membership: "Pass",
};

function copyFor(status: ChargeursPushStatus | null) {
  if (!status || status.state === "checking") return {
    tone: "text-muted-foreground",
    label: "Vérification…",
    body: "Chargeurs+ vérifie l’autorisation de cet appareil et le service d’envoi sécurisé.",
  };
  if (status.state === "active") return {
    tone: "text-success",
    label: "Toutes les notifications transactionnelles sont actives",
    body: "Cet appareil recevra les confirmations de paiement, départ de location, rappels, retours, reçus, alertes de support et événements du Pass.",
  };
  if (status.state === "permission_denied") return {
    tone: "text-destructive",
    label: "Notifications bloquées sur cet appareil",
    body: "L’autorisation a été refusée au niveau du système. Réactivez les notifications de Chargeurs+ dans les réglages de l’appareil, puis revenez ici.",
  };
  if (status.state === "needs_install") return {
    tone: "text-warning",
    label: "Installation sur l’écran d’accueil requise",
    body: "Sur iPhone/iPad, Web Push fonctionne depuis Chargeurs+ installé sur l’écran d’accueil. Installez d’abord le Pass puis rouvrez-le.",
  };
  if (status.state === "unsupported") return {
    tone: "text-warning",
    label: "Web Push non pris en charge",
    body: "Ce navigateur ne fournit pas les API nécessaires aux notifications Push.",
  };
  if (status.state === "server_unavailable") return {
    tone: "text-warning",
    label: "Service Push momentanément indisponible",
    body: "L’infrastructure d’envoi ne peut pas être validée pour le moment. Aucune activation n’est affichée à tort.",
  };
  return {
    tone: "text-violet-200",
    label: "Prêt à être activé",
    body: "Le service sécurisé est configuré. L’autorisation système ne sera demandée qu’après votre appui sur le bouton ci-dessous.",
  };
}

export function ChargeursPlusPushPanel() {
  const [status, setStatus] = useState<ChargeursPushStatus | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setBusy((current) => current ?? "refresh");
    try {
      setStatus(await getChargeursPushStatus());
    } catch {
      setStatus({ state: "server_unavailable", permission: "unsupported", configured: false, active: false, topics: [] });
    } finally {
      setBusy((current) => current === "refresh" ? null : current);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let legacyCard: HTMLElement | null = null;
    let host: HTMLElement | null = null;

    const locate = () => {
      if (host?.isConnected) return;
      const title = [...document.querySelectorAll<HTMLElement>("h2")]
        .find((node) => node.textContent?.trim() === "Notifications du Pass");
      const card = title?.closest<HTMLElement>("article") ?? null;
      if (!card || card.dataset.chargeursPushReplacement === "true") return;
      legacyCard = card;
      host = document.createElement("div");
      host.dataset.chargeursPushPortal = "true";
      card.before(host);
      card.dataset.chargeursPushReplacement = "true";
      card.style.display = "none";
      setPortalHost(host);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (legacyCard?.isConnected) {
        legacyCard.style.removeProperty("display");
        delete legacyCard.dataset.chargeursPushReplacement;
      }
      host?.remove();
      setPortalHost(null);
    };
  }, []);

  const enable = async () => {
    if (busy) return;
    setBusy("enable");
    setError(null);
    setMessage(null);
    try {
      const next = await enableAllChargeursPushNotifications();
      setStatus(next);
      if (next.active) setMessage("Notifications activées sur cet appareil.");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "PUSH_ENABLE_FAILED";
      if (code === "PUSH_PERMISSION_DENIED") setError("L’autorisation système a été refusée. Chargeurs+ ne peut pas contourner ce choix.");
      else if (code === "PUSH_REQUIRES_HOME_SCREEN_APP") setError("Ouvrez Chargeurs+ depuis l’icône installée sur l’écran d’accueil puis réessayez.");
      else setError("L’activation n’a pas pu être confirmée. Aucune notification n’est présentée comme active sans preuve serveur.");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy("disable");
    setError(null);
    setMessage(null);
    try {
      setStatus(await disableChargeursPushNotifications());
      setMessage("Notifications désactivées sur cet appareil.");
    } catch {
      setError("La désactivation n’a pas pu être confirmée côté serveur.");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      await sendChargeursPushTest();
      setMessage("Notification de test mise en file d’envoi. Elle doit arriver dans quelques secondes.");
    } catch {
      setError("Le test Push n’a pas pu être mis en file d’envoi.");
    } finally {
      setBusy(null);
    }
  };

  const view = copyFor(status);
  const topics = (status?.topics?.length ? status.topics : Object.keys(TOPIC_LABELS))
    .filter((topic) => TOPIC_LABELS[topic]);

  const panel = (
    <article className="glass rounded-3xl p-6" data-chargeurs-push-panel="true">
      <div className="flex items-center gap-3">
        <BellRing className="h-7 w-7 text-violet-300" />
        <h2 className="font-display text-xl font-bold">Notifications du Pass</h2>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{view.body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {topics.map((topic) => (
          <span key={topic} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs font-semibold text-muted-foreground">
            {TOPIC_LABELS[topic]}
          </span>
        ))}
      </div>
      <div className={`mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${view.tone}`}>
        {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : status?.active ? <CheckCircle2 className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
        <span>État : {view.label}</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {!status?.active && status?.state !== "permission_denied" && status?.state !== "unsupported" && status?.state !== "needs_install" && (
          <Button onClick={() => void enable()} disabled={Boolean(busy)} className="rounded-full bg-violet-500 font-bold text-white hover:bg-violet-400">
            {busy === "enable" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}
            Activer toutes les notifications
          </Button>
        )}
        {status?.active && (
          <>
            <Button onClick={() => void test()} disabled={Boolean(busy)} className="rounded-full">
              {busy === "test" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Envoyer un test
            </Button>
            <Button variant="outline" onClick={() => void disable()} disabled={Boolean(busy)} className="rounded-full">
              {busy === "disable" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellOff className="mr-2 h-4 w-4" />}
              Désactiver sur cet appareil
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={() => void refresh()} disabled={Boolean(busy)} className="rounded-full">
          <RefreshCw className="mr-2 h-4 w-4" />Actualiser
        </Button>
      </div>
      {message && <p className="mt-4 text-sm font-semibold text-success">{message}</p>}
      {error && <p className="mt-4 text-sm font-semibold text-destructive">{error}</p>}
      <p className="mt-4 text-xs text-muted-foreground">Notifications commerciales exclues sauf consentement marketing séparé.</p>
    </article>
  );

  return portalHost ? createPortal(panel, portalHost) : panel;
}
