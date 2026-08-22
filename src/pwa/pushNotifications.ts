import { customerSupabase } from "@/integrations/supabase/client";

const PUSH_FUNCTION = "noop-placeholder";

export type ChargeursPushState =
  | "checking"
  | "unsupported"
  | "needs_install"
  | "server_unavailable"
  | "permission_default"
  | "permission_denied"
  | "inactive"
  | "active";

export type ChargeursPushStatus = {
  state: ChargeursPushState;
  permission: NotificationPermission | "unsupported";
  configured: boolean;
  active: boolean;
  topics: string[];
};

type PushConfig = {
  ok?: boolean;
  configured?: boolean;
  vapidPublicKey?: string;
  topics?: string[];
};

type PushServerStatus = {
  ok?: boolean;
  active?: boolean;
  subscriptions?: Array<{ endpoint?: string }>;
  topics?: string[];
};

function isIos(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await customerSupabase.functions.invoke(PUSH_FUNCTION, { body });
  if (error || !data?.ok) {
    throw new Error(String(data?.error ?? error?.message ?? "PUSH_BACKEND_UNAVAILABLE"));
  }
  return data as T;
}

async function config(): Promise<PushConfig> {
  return invoke<PushConfig>({ action: "config" });
}

export async function getChargeursPushStatus(): Promise<ChargeursPushStatus> {
  if (!supported()) {
    return { state: "unsupported", permission: "unsupported", configured: false, active: false, topics: [] };
  }
  if (isIos() && !isStandalone()) {
    return { state: "needs_install", permission: Notification.permission, configured: false, active: false, topics: [] };
  }

  let cfg: PushConfig;
  try {
    cfg = await config();
  } catch {
    return { state: "server_unavailable", permission: Notification.permission, configured: false, active: false, topics: [] };
  }
  if (!cfg.configured || !cfg.vapidPublicKey) {
    return { state: "server_unavailable", permission: Notification.permission, configured: false, active: false, topics: cfg.topics ?? [] };
  }
  if (Notification.permission === "denied") {
    return { state: "permission_denied", permission: "denied", configured: true, active: false, topics: cfg.topics ?? [] };
  }

  const registration = await navigator.serviceWorker.ready;
  const local = await registration.pushManager.getSubscription();
  let server: PushServerStatus | null = null;
  try {
    server = await invoke<PushServerStatus>({ action: "status" });
  } catch {
    server = null;
  }
  const serverHasLocal = Boolean(local && server?.subscriptions?.some((item) => item.endpoint === local.endpoint));
  if (local && serverHasLocal && Notification.permission === "granted") {
    return { state: "active", permission: "granted", configured: true, active: true, topics: server?.topics ?? cfg.topics ?? [] };
  }
  if (Notification.permission === "default") {
    return { state: "permission_default", permission: "default", configured: true, active: false, topics: cfg.topics ?? [] };
  }
  return { state: "inactive", permission: Notification.permission, configured: true, active: false, topics: cfg.topics ?? [] };
}

export async function enableAllChargeursPushNotifications(): Promise<ChargeursPushStatus> {
  if (!supported()) throw new Error("PUSH_UNSUPPORTED");
  if (isIos() && !isStandalone()) throw new Error("PUSH_REQUIRES_HOME_SCREEN_APP");

  const cfg = await config();
  if (!cfg.configured || !cfg.vapidPublicKey) throw new Error("PUSH_SERVER_NOT_CONFIGURED");
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "PUSH_PERMISSION_DENIED" : "PUSH_PERMISSION_NOT_GRANTED");

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(cfg.vapidPublicKey),
    });
  }

  const serialized = subscription.toJSON();
  await invoke({
    action: "subscribe",
    platform: isIos() ? "ios-pwa" : "web-pwa",
    subscription: {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: serialized.keys?.p256dh,
        auth: serialized.keys?.auth,
      },
    },
  });
  return getChargeursPushStatus();
}

export async function disableChargeursPushNotifications(): Promise<ChargeursPushStatus> {
  if (!supported()) return getChargeursPushStatus();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await invoke({ action: "unsubscribe", endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  } else {
    await invoke({ action: "unsubscribe" });
  }
  return getChargeursPushStatus();
}

export async function sendChargeursPushTest(): Promise<void> {
  await invoke({ action: "test" });
}
