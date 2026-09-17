import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const API_BASE = String(import.meta.env.VITE_KIOSK_API_BASE_URL || "").replace(/\/$/, "");

type Session = {
  id: string;
  state: string;
  payment_status: string;
  failure_code: string | null;
};

async function status(rentalSessionId: string, publicCode: string) {
  if (!API_BASE) throw new Error("PILOT_API_NOT_CONFIGURED");
  const response = await fetch(`${API_BASE}/api/pilot/session-status`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rentalSessionId, publicCode }),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; session?: Session; error?: string } | null;
  if (!response.ok || !data?.session) throw new Error(data?.error || `HTTP_${response.status}`);
  return data.session;
}

export default function PilotPaymentResult() {
  const { rentalSessionId = "" } = useParams();
  const params = new URLSearchParams(window.location.search);
  const publicCode = params.get("c") || "";
  const redirectResult = params.get("result") || "";
  const lang = params.get("lang") === "de" || params.get("lang") === "en" ? params.get("lang")! : "fr";
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = {
    fr: {
      checking: "Vérification du paiement…",
      checkingBody: "La page de retour n’est pas une preuve de paiement. Nous attendons la confirmation signée de Stripe.",
      authorized: "Paiement TEST confirmé",
      authorizedBody: "Retournez à la borne. Elle a reçu la confirmation serveur.",
      cancelled: "Paiement annulé",
      cancelledBody: "Aucun paiement confirmé. Vous pouvez fermer cette page et recommencer sur la borne.",
      failed: "Paiement non confirmé",
      pending: "Confirmation en cours",
      pendingBody: "Gardez cette page ouverte quelques secondes.",
      test: "MODE TEST",
    },
    en: {
      checking: "Checking payment…",
      checkingBody: "This return page is not payment proof. We are waiting for Stripe's signed confirmation.",
      authorized: "TEST payment confirmed",
      authorizedBody: "Return to the station. It has received the server confirmation.",
      cancelled: "Payment cancelled",
      cancelledBody: "No payment was confirmed. You can close this page and try again at the station.",
      failed: "Payment not confirmed",
      pending: "Confirmation pending",
      pendingBody: "Keep this page open for a few seconds.",
      test: "TEST MODE",
    },
    de: {
      checking: "Zahlung wird geprüft…",
      checkingBody: "Diese Rückleitungsseite ist kein Zahlungsnachweis. Wir warten auf die signierte Stripe-Bestätigung.",
      authorized: "TEST-Zahlung bestätigt",
      authorizedBody: "Gehen Sie zur Station zurück. Die Serverbestätigung ist dort angekommen.",
      cancelled: "Zahlung abgebrochen",
      cancelledBody: "Keine Zahlung wurde bestätigt. Sie können diese Seite schließen und an der Station neu beginnen.",
      failed: "Zahlung nicht bestätigt",
      pending: "Bestätigung läuft",
      pendingBody: "Lassen Sie diese Seite einige Sekunden geöffnet.",
      test: "TESTMODUS",
    },
  }[lang as "fr" | "en" | "de"];

  useEffect(() => {
    if (!rentalSessionId || !publicCode) {
      setError("SESSION_REFERENCE_MISSING");
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await status(rentalSessionId, publicCode);
        if (!cancelled) {
          setSession(next);
          setError(null);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "STATUS_FAILED");
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [rentalSessionId, publicCode]);

  const authorized = session?.state === "payment_authorized" || session?.payment_status === "authorized";
  const failed = session && ["payment_failed", "payment_expired"].includes(session.state);
  const cancelledByRedirect = redirectResult === "cancel" && !authorized;

  let icon = <Loader2 className="h-14 w-14 animate-spin text-primary" />;
  let title = copy.checking;
  let body = copy.checkingBody;
  if (authorized) {
    icon = <CheckCircle2 className="h-14 w-14 text-primary" />;
    title = copy.authorized;
    body = copy.authorizedBody;
  } else if (failed) {
    icon = <AlertTriangle className="h-14 w-14 text-warning" />;
    title = copy.failed;
    body = session?.failure_code || copy.cancelledBody;
  } else if (cancelledByRedirect) {
    icon = <AlertTriangle className="h-14 w-14 text-warning" />;
    title = copy.cancelled;
    body = copy.cancelledBody;
  } else if (session) {
    icon = <Clock3 className="h-14 w-14 text-primary" />;
    title = copy.pending;
    body = copy.pendingBody;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-10 text-foreground">
      <section className="w-full max-w-xl rounded-[2rem] border border-border bg-card p-8 text-center shadow-2xl">
        <BrandLogo size="md" />
        <div className="mx-auto mt-6 inline-flex rounded-full border border-warning/30 bg-warning/10 px-4 py-2 text-xs font-black tracking-[0.14em] text-warning">{copy.test}</div>
        <div className="mt-7 flex justify-center">{icon}</div>
        <h1 className="mt-5 text-3xl font-black">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{body}</p>
        {error && !session && <p className="mt-5 font-mono text-xs text-warning">{error}</p>}
      </section>
    </main>
  );
}
