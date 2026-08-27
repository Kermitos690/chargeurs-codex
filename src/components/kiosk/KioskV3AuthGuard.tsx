import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useParams } from "react-router-dom";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/i18n/i18n";
import { readKioskToken } from "@/lib/kioskFetch";
import { KIOSK_AUTH_REQUIRED_EVENT } from "@/lib/kioskEdgeProxy";

type Language = "fr" | "en" | "de";
type NativeBridge = { restartApp?: () => void };
type NativeWindow = Window & { ChargeursNative?: NativeBridge };

const AUTO_RECOVERY_KEY = "chargeurs_kiosk_auth_auto_recovery_attempted";
const NATIVE_RECOVERY_KEY = "chargeurs_kiosk_auth_native_recovery_attempted_at";
const NATIVE_RECOVERY_COOLDOWN_MS = 10 * 60_000;

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

function nativeBridge(): NativeBridge | undefined {
  return (window as NativeWindow).ChargeursNative;
}

function nativeWrapperPresent(): boolean {
  return Boolean(nativeBridge());
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

function nativeRecoveryRecentlyAttempted(now = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(NATIVE_RECOVERY_KEY);
    if (!raw) return false;
    const attemptedAt = Number(raw);
    if (!Number.isFinite(attemptedAt) || attemptedAt <= 0 || now < attemptedAt) {
      window.localStorage.removeItem(NATIVE_RECOVERY_KEY);
      return false;
    }
    if (now - attemptedAt >= NATIVE_RECOVERY_COOLDOWN_MS) {
      window.localStorage.removeItem(NATIVE_RECOVERY_KEY);
      return false;
    }
    return true;
  } catch {
    // Without durable storage we cannot prove the restart is bounded, so do not
    // attempt automatic native recovery.
    return true;
  }
}

function markNativeRecoveryAttempted(): void {
  try {
    window.localStorage.setItem(NATIVE_RECOVERY_KEY, String(Date.now()));
  } catch {
    // The eligibility check fails closed when durable storage is unavailable.
  }
}

function clearNativeRecoveryAttempt(): void {
  try {
    window.localStorage.removeItem(NATIVE_RECOVERY_KEY);
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

export function shouldAttemptNativeAuthRecovery(input: {
  guardActive: boolean;
  nativeWrapper: boolean;
  nativeSessionCredentialPresent: boolean;
  restartAvailable: boolean;
  recentlyAttempted: boolean;
}): boolean {
  return input.guardActive
    && input.nativeWrapper
    && !input.nativeSessionCredentialPresent
    && input.restartAvailable
    && !input.recentlyAttempted;
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

  // If the native wrapper exists but its per-WebView credential disappeared,
  // ask the APK to recreate the runtime from its secure enrollment store. The
  // localStorage timestamp survives WebView recreation and limits this to one
  // automatic attempt per cooldown. No credential is exposed to JavaScript.
  useEffect(() => {
    const bridge = nativeBridge();
    if (!shouldAttemptNativeAuthRecovery({
      guardActive: state.active,
      nativeWrapper: state.nativeWrapper,
      nativeSessionCredentialPresent: state.nativeSessionCredentialPresent,
      restartAvailable: typeof bridge?.restartApp === "function",
      recentlyAttempted: nativeRecoveryRecentlyAttempted(),
    })) return;

    markNativeRecoveryAttempted();
    const timer = window.setTimeout(() => {
      try {
        bridge?.restartApp?.();
      } catch {
        setAuthenticationRejected(true);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state.active, state.nativeWrapper, state.nativeSessionCredentialPresent]);

  // Once the page remains healthy for a few seconds, allow a future isolated
  // startup race or native runtime recreation to self-heal again.
  useEffect(() => {
    if (state.active || authenticationRejected || !localCredentialReady()) return;
    const timer = window.setTimeout(() => {
      clearAuthRecoveryAttempt();
      clearNativeRecoveryAttempt();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [state.active, authenticationRejected, retryNonce]);

  useEffect(() => {
    if (state.active) document.documentElement.dataset.kioskAuth = "required";
    else delete document.documentElement.dataset.kioskAuth;
    return () => { delete document.documentElement.dataset.kioskAuth; };
  }, [state.active]);

  if (!state.active) return null;

  const retry = () => {
    clearAuthRecoveryAttempt();
    clearNativeRecoveryAttempt();
    setAuthenticationRejected(false);
    setRetryNonce((value) => value + 1);
    window.setTimeout(() => {
      if (localCredentialReady()) {
        window.location.reload();
        return;
      }
      const bridge = nativeBridge();
      if (typeof bridge?.restartApp === "function" && !nativeRecoveryRecentlyAttempted()) {
        markNativeRecoveryAttempted();
        bridge.restartApp();
      }
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
