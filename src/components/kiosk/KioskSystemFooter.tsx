import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { useI18n } from "@/i18n/i18n";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";
import { useKioskIdentity } from "./KioskIdentityGate";
import { KioskPaymentMarks } from "./KioskPaymentMarks";

type GuestPricing = {
  currency?: string;
  daily_cap_cents?: number | null;
  deposit_cents?: number | null;
  tiers?: Array<{ upper_minutes: number; total_cents: number }>;
};

type CustomerOptions = {
  ok?: boolean;
  guest?: GuestPricing | null;
};

type BackendState = "ok" | "auth" | "error" | null;
export type KioskFooterConnectionState = "online" | "auth" | "limited" | "offline" | "checking";

const FOOTER_BACKEND_REFRESH_MS = 10 * 60_000;

const COPY = {
  fr: {
    secure: "Paiement sécurisé par Stripe",
    daily: "Plafond 24 h",
    deposit: "Caution",
    online: "En ligne",
    auth: "Identité à réactiver",
    limited: "Connexion limitée",
    offline: "Hors ligne",
    checking: "Vérification…",
  },
  en: {
    secure: "Secure payment by Stripe",
    daily: "24 h cap",
    deposit: "Deposit",
    online: "Online",
    auth: "Identity recovery required",
    limited: "Limited connection",
    offline: "Offline",
    checking: "Checking…",
  },
  de: {
    secure: "Sichere Zahlung mit Stripe",
    daily: "24-h-Limit",
    deposit: "Garantie",
    online: "Online",
    auth: "Identität muss reaktiviert werden",
    limited: "Eingeschränkte Verbindung",
    offline: "Offline",
    checking: "Prüfung…",
  },
} as const;

function money(cents: number | null | undefined, currency = "CHF") {
  if (cents == null || !Number.isFinite(Number(cents)) || Number(cents) <= 0) return "—";
  return `${(Number(cents) / 100).toFixed(2)} ${currency}`;
}

export function kioskFooterConnectionState(input: {
  networkOffline: boolean;
  backendState: BackendState;
}): KioskFooterConnectionState {
  if (input.networkOffline) return "offline";
  if (input.backendState === "ok") return "online";
  if (input.backendState === "auth") return "auth";
  if (input.backendState === "error") return "limited";
  return "checking";
}

export function KioskSystemFooter() {
  // Canonical identity only: the footer must show exactly the cabinet used for
  // backend calls, never a route/cache leftover from another installation.
  const { stationId: canonicalStation, terminalAvailable } = useKioskIdentity();
  const stationId = canonicalStation ?? "";
  const { lang } = useI18n();
  const net = useOnlineStatus();

  const copy = COPY[lang];
  const [options, setOptions] = useState<CustomerOptions | null>(null);
  const [backendState, setBackendState] = useState<BackendState>(null);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    if (net === "offline") {
      setBackendState("error");
      return;
    }
    const token = readKioskToken();
    if (!token || !stationId) {
      setBackendState(null);
      return;
    }
    const result = await invokeKioskEdgeProxy<CustomerOptions>(
      "/api/kiosk/customer-options",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (result.status === 401 || result.status === 403) {
      setBackendState("auth");
      return;
    }
    const ok = result.data?.ok === true && result.status != null && result.status >= 200 && result.status < 300;
    setBackendState(ok ? "ok" : "error");
    if (ok && result.data) setOptions(result.data);
  }, [net, stationId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), FOOTER_BACKEND_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const guest = options?.guest ?? null;
  const currency = guest?.currency ?? "CHF";
  const dayTier = useMemo(() => {
    if (!Array.isArray(guest?.tiers)) return null;
    const valid = guest.tiers
      .filter((tier) => Number(tier.upper_minutes) > 0 && Number(tier.total_cents) > 0)
      .sort((a, b) => a.upper_minutes - b.upper_minutes);
    return valid.find((tier) => tier.upper_minutes === 1440) ?? valid[valid.length - 1] ?? null;
  }, [guest?.tiers]);
  const dailyCap = dayTier?.total_cents ?? guest?.daily_cap_cents ?? null;
  const deposit = guest?.deposit_cents ?? null;

  const connection = kioskFooterConnectionState({
    networkOffline: net === "offline",
    backendState,
  });

  const time = new Intl.DateTimeFormat(lang === "fr" ? "fr-CH" : lang === "de" ? "de-CH" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const statusLabel = connection === "online"
    ? copy.online
    : connection === "auth"
      ? copy.auth
      : connection === "limited"
        ? copy.limited
        : connection === "offline"
          ? copy.offline
          : copy.checking;

  return (
    <>
      <aside className="kiosk-home-pricing-summary" aria-label={`${copy.daily} · ${copy.deposit}`}>
        <span>
          <small>{copy.daily}</small>
          <strong>{money(dailyCap, currency)}</strong>
        </span>
        <i aria-hidden="true" />
        <span>
          <small>{copy.deposit}</small>
          <strong>{money(deposit, currency)}</strong>
        </span>
      </aside>

      <footer
        className="kiosk-system-footer"
        data-connection={connection === "auth" ? "limited" : connection}
        data-station={stationId || "unconfigured"}
        data-terminal={terminalAvailable ? "true" : "false"}
        aria-label={`${stationId} · ${statusLabel}`}
      >
        <div className="kiosk-system-footer__payments">
          <span className="kiosk-system-footer__secure"><ShieldCheck aria-hidden="true" />{copy.secure}</span>
          <KioskPaymentMarks cardLabel="" />
        </div>

        <div className="kiosk-system-footer__runtime">
          <strong className="kiosk-system-footer__station">{stationId || "DTA—"}</strong>
          <span className="kiosk-system-footer__time"><Clock3 aria-hidden="true" />{time}</span>
          <span className="kiosk-system-footer__network">
            {connection === "offline" ? <WifiOff aria-hidden="true" /> : connection === "auth" ? <ShieldCheck aria-hidden="true" /> : <Wifi aria-hidden="true" />}
            <b aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </footer>
    </>
  );
}
