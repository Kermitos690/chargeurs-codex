import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useParams } from "react-router-dom";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/i18n/i18n";
import { readKioskToken } from "@/lib/kioskFetch";
import { KIOSK_AUTH_REQUIRED_EVENT } from "@/lib/kioskEdgeProxy";

type Language = "fr" | "en" | "de";
type NativeWindow = Window & { ChargeursNative?: unknown };

const AUTO_RECOVERY_KEY = "chargeurs_kiosk_auth_auto_recovery_attempted";

type Copy = {
  eyebrow: string;
  title: string;
  body: string;
  safety: string;
  retry: string;
  station: string;
  code: string;
};

const COPY: Record<Language, Copy> = {
  fr: {
    eyebrow: "ACTIVATION OPÉRATEUR REQUISE",
    title: "Borne non authentifiée",
    body: "L’identité sécurisée de cette borne n’est pas disponible. Les fonctions de location restent volontairement bloquées jusqu’à restauration de l’activation.",
    safety: "Aucun paiement ni aucune éjection ne peut être démarré depuis cet écran.",
    retry: "Réessayer après activation",
    station: "Borne",
    code: "KIOSK_AUTH_REQUIRED",
  },
  en: {
    eyebrow: "OPERATOR ACTIVATION REQUIRED",
    title: "Kiosk not authenticated",
    body: "This kiosk’s secure identity is unavailable. Rental functions remain intentionally locked until activation is restored.",
    safety: "No payment or release can be started from this screen.",
    retry: "Retry after activation",
    station: "Kiosk",
    code: "KIOSK_AUTH_REQUIRED",
  },
  de: {
    eyebrow: "AKTIVIERUNG DURCH BETREIBER ERFORDERLICH",
    title: "Station nicht authentifiziert",
    body: "Die sichere Identität dieser Station ist nicht verfügbar. Mietfunktionen bleiben gesperrt, bis die Aktivierung wiederhergestellt ist.",
    safety: "Von diesem Bildschirm aus können weder Zahlung noch Ausgabe gestartet werden.",
    retry: "Nach Aktivierung erneut versuchen",
    station: "Station",
    code: "KIOSK_AUTH_REQUIRED",
  },
};

function nativeWrapperPresent(): boolean {
  return Boolean((window as NativeWindow).ChargeursNative);
}

function nativeSessionCredentialMissing(): boolean {
  if (!nativeWrapperPresent()) return false;
  try {
    return !window.sessionStorage.getItem("kiosk_token");
  } catch {
    return !readKioskToken();
  }
}

function localCredentialReady(): boolean {
  return Boolean(readKioskToken()) && !nativeSessionCredentialMissing();
}

function authRecoveryAlreadyAttempted(): boolean {
  try {
    return window.sessionStorage.getItem(AUTO_RECOVERY_KEY) === "1";
  } catch {
    return true;
  }
}

function markAuthRecoveryAttempted(): void {
  try {
    window.sessionStorage.setItem(AUTO_RECOVERY_KEY, "1");
  } catch {
    // Fail closed: lack of storage must never create a reload loop.
  }
}

function clearAuthRecoveryAttempt(): void {
  try {
    window.sessionStorage.removeItem(AUTO_RECOVERY_KEY);
  } catch {
    // Best effort only.
  }
}

export function shouldShowKioskAuthGuard(input: {
  runtimeTokenPresent: boolean;
  nativeWrapper: boolean;
  nativeSessionCredentialPresent: boolean;
  authenticationRejected: boolean;
}): boolean {
  if (input.authenticationRejected) return true;
  if (!input.runtimeTokenPresent) return true;
  if (input.nativeWrapper && !input.nativeSessionCredentialPresent) return true;
  return false;
}

export function KioskV3AuthGuard() {
  const { stationId = "—" } = useParams();
  const { lang } = useI18n();
  const copy = COPY[lang];
  const [authenticationRejected, setAuthenticationRejected] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const rejected = () => setAuthenticationRejected(true);
    window.addEventListener(KIOSK_AUTH_REQUIRED_EVENT, rejected);
    return () => window.removeEventListener(KIOSK_AUTH_REQUIRED_EVENT, rejected);
  }, []);

  // A reboot can briefly race the Android credential injection against the
  // first authenticated web requests. If the secure kiosk credential is now
  // present locally, recover exactly once by reloading the shell. A persistent
  // invalid/revoked credential still fails closed because the session marker
  // prevents a reload loop and the guard remains visible after the retry.
  useEffect(() => {
    if (!authenticationRejected || !localCredentialReady() || authRecoveryAlreadyAttempted()) return;
    markAuthRecoveryAttempted();
    const timer = window.setTimeout(() => window.location.reload(), 350);
    return () => window.clearTimeout(timer);
  }, [authenticationRejected]);

  // Once the page remains healthy for a few seconds, allow a future isolated
  // startup race to self-heal again without weakening persistent auth failures.
  useEffect(() => {
    if (authenticationRejected || !localCredentialReady()) return;
    const timer = window.setTimeout(clearAuthRecoveryAttempt, 5000);
    return () => window.clearTimeout(timer);
  }, [authenticationRejected, retryNonce]);

  const state = useMemo(() => {
    const runtimeTokenPresent = Boolean(readKioskToken());
    const nativeWrapper = nativeWrapperPresent();
    const nativeSessionCredentialPresent = !nativeWrapper || !nativeSessionCredentialMissing();
    return {
      runtimeTokenPresent,
      nativeWrapper,
      nativeSessionCredentialPresent,
      active: shouldShowKioskAuthGuard({
        runtimeTokenPresent,
        nativeWrapper,
        nativeSessionCredentialPresent,
        authenticationRejected,
      }),
    };
  }, [authenticationRejected, retryNonce]);

  useEffect(() => {
    if (state.active) document.documentElement.dataset.kioskAuth = "required";
    else delete document.documentElement.dataset.kioskAuth;
    return () => { delete document.documentElement.dataset.kioskAuth; };
  }, [state.active]);

  if (!state.active) return null;

  const retry = () => {
    clearAuthRecoveryAttempt();
    setAuthenticationRejected(false);
    setRetryNonce((value) => value + 1);
    window.setTimeout(() => {
      if (localCredentialReady()) window.location.reload();
    }, 80);
  };

  return (
    <section className="kv3-auth-required" role="alert" aria-live="assertive">
      <div className="kv3-auth-required__ambient" aria-hidden="true" />
      <header className="kv3-auth-required__topbar">
        <BrandLogo size="md" />
        <span><ShieldCheck aria-hidden="true" /> {copy.station} {stationId}</span>
      </header>

      <div className="kv3-auth-required__panel">
        <div className="kv3-auth-required__icon"><AlertTriangle aria-hidden="true" /></div>
        <span className="kv3-auth-required__eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <div className="kv3-auth-required__safety"><ShieldCheck aria-hidden="true" /><span>{copy.safety}</span></div>
        <button type="button" onClick={retry}><RefreshCw aria-hidden="true" /> {copy.retry}</button>
        <small>{copy.code}</small>
      </div>
    </section>
  );
}
