import { PKPass } from "npm:passkit-generator@3.4.0";
import { Buffer } from "node:buffer";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sha256Hex, snapshotHash } from "./db.ts";

const ICON_1X = "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAAwElEQVR4nNVW2xGAMAhr1Qn8cCundSt38PTLO0VoeUS95tOzpAECzeM47eljDNYD69Kz36d5U8forKQI/EKapZpKabRASjmrFEFYivMgRRGW4nW1H0rQdiyN624ki0Uo2rFMRKWbNHoBM2lUZUqO2cuBXqTmApNSjUqN7aDdq/W5mhRRyxPqmlIV1jpeAfGpdXyGa+pZECFS70ZqY/ae9Yzs3Rupdz/WQOOybyTk64ETwqYXNQikOOJr8E200b0IHIn+PMFUDV4AAAAAAElFTkSuQmCC";
const ICON_2X = "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";

export type WalletVisibleData = {
  memberName: string;
  memberNumber: string;
  accountStatus: string;
  subscriptionName: string | null;
  creditCents: number | null;
  totalRentals: number;
  activeRental: { stationId: string | null; state: string; batteryId: string | null } | null;
  lastRentalAt: string | null;
};

export type WalletPassRow = {
  id: string;
  user_id: string;
  serial_number: string;
  pass_type_identifier: string;
  qr_token_ciphertext: string;
  apple_authentication_token_ciphertext: string;
  status: "active" | "revoked" | "suspended";
  pass_version: number;
  visible_data_hash: string | null;
};

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`WALLET_CONFIG_MISSING:${name}`);
  return value;
}

export function walletConfig() {
  return {
    passTypeIdentifier: required("APPLE_PASS_TYPE_IDENTIFIER"),
    teamIdentifier: required("APPLE_TEAM_IDENTIFIER"),
    webServiceUrl: required("APPLE_PASS_WEB_SERVICE_URL").replace(/\/$/, ""),
    appUrl: (Deno.env.get("PUBLIC_APP_URL") ?? "https://chargeurs.ch").replace(/\/$/, ""),
    signerCert: required("APPLE_PASS_SIGNER_CERTIFICATE_BASE64"),
    signerKey: required("APPLE_PASS_SIGNER_KEY_BASE64"),
    signerKeyPassphrase: Deno.env.get("APPLE_PASS_SIGNER_KEY_PASSPHRASE") ?? "",
    wwdr: required("APPLE_WWDR_CERTIFICATE_BASE64"),
    encryptionKey: required("WALLET_TOKEN_ENCRYPTION_KEY"),
  };
}

function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${value}`;
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(base64Key), (char) => char.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("WALLET_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string, base64Key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(base64Key);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...iv, ...encrypted));
}

export async function decryptToken(value: string, base64Key: string): Promise<string> {
  const combined = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  const key = await importAesKey(base64Key);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(clear);
}

export async function getOrCreateWalletPass(db: SupabaseClient, userId: string): Promise<WalletPassRow> {
  const config = walletConfig();
  const existing = await db.from("wallet_passes").select("*")
    .eq("user_id", userId).eq("pass_type_identifier", config.passTypeIdentifier).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as WalletPassRow;

  const qrToken = randomToken("wq");
  const authToken = randomToken("wa");
  const serial = `CHG-${userId.replace(/-/g, "").toUpperCase()}`;
  const insert = await db.from("wallet_passes").insert({
    user_id: userId,
    serial_number: serial,
    pass_type_identifier: config.passTypeIdentifier,
    qr_token_hash: await sha256Hex(qrToken),
    qr_token_ciphertext: await encryptToken(qrToken, config.encryptionKey),
    qr_token_last_four: qrToken.slice(-4),
    apple_authentication_token_hash: await sha256Hex(authToken),
    apple_authentication_token_ciphertext: await encryptToken(authToken, config.encryptionKey),
  }).select("*").single();
  if (insert.error) throw insert.error;
  return insert.data as WalletPassRow;
}

function firstString(source: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(source: Record<string, unknown> | null, keys: string[]): number | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export async function resolveVisibleData(db: SupabaseClient, userId: string, email: string | null): Promise<WalletVisibleData> {
  const profileResult = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = (profileResult.data ?? {}) as Record<string, unknown>;
  const memberResult = await db.rpc("ensure_member_number", { p_user_id: userId });
  if (memberResult.error) throw memberResult.error;

  let rentalsQuery = db.from("rental_sessions")
    .select("id,station_id,state,battery_id,created_at,paid_at,ejected_at,returned_at,closed_at")
    .order("created_at", { ascending: false }).limit(500);
  rentalsQuery = email
    ? rentalsQuery.or(`customer_user_id.eq.${userId},customer_email.ilike.${email.replace(/[%_,]/g, "")}`)
    : rentalsQuery.eq("customer_user_id", userId);
  const rentalsResult = await rentalsQuery;
  if (rentalsResult.error) throw rentalsResult.error;
  const rentals = (rentalsResult.data ?? []) as Array<Record<string, unknown>>;
  const activeStates = new Set(["ejected", "battery_taken", "active_rental", "payment_succeeded", "ejecting"]);
  const active = rentals.find((r) => activeStates.has(String(r.state)) && !r.returned_at && !r.closed_at) ?? null;

  let creditCents: number | null = firstNumber(profile, ["credit_cents", "balance_cents", "wallet_balance_cents"]);
  if (creditCents === null) {
    const wallet = await db.from("wallets").select("*").eq("user_id", userId).maybeSingle();
    if (!wallet.error && wallet.data) creditCents = firstNumber(wallet.data as Record<string, unknown>, ["balance_cents", "credit_cents", "balance"]);
  }

  let subscriptionName = firstString(profile, ["subscription_name", "plan_name", "membership_tier"]);
  if (!subscriptionName) {
    const subscription = await db.from("subscriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!subscription.error && subscription.data) subscriptionName = firstString(subscription.data as Record<string, unknown>, ["plan_name", "name", "tier", "status"]);
  }

  return {
    memberName: firstString(profile, ["display_name", "full_name", "first_name", "name"]) ?? "Membre Chargeurs.ch",
    memberNumber: String(memberResult.data),
    accountStatus: firstString(profile, ["account_status", "status"]) ?? "active",
    subscriptionName,
    creditCents,
    totalRentals: rentals.length,
    activeRental: active ? {
      stationId: typeof active.station_id === "string" ? active.station_id : null,
      state: String(active.state),
      batteryId: typeof active.battery_id === "string" ? active.battery_id : null,
    } : null,
    lastRentalAt: rentals.length ? String(rentals[0].closed_at ?? rentals[0].returned_at ?? rentals[0].ejected_at ?? rentals[0].paid_at ?? rentals[0].created_at) : null,
  };
}

export async function visibleDataHash(data: WalletVisibleData): Promise<string> {
  return snapshotHash(data);
}

export async function buildSignedPass(row: WalletPassRow, data: WalletVisibleData): Promise<Uint8Array> {
  if (row.status !== "active") throw new Error("WALLET_PASS_REVOKED");
  const config = walletConfig();
  const qrToken = await decryptToken(row.qr_token_ciphertext, config.encryptionKey);
  const authToken = await decryptToken(row.apple_authentication_token_ciphertext, config.encryptionKey);
  const walletUrl = `${config.appUrl}/wallet/${encodeURIComponent(qrToken)}`;

  const pass = new PKPass(
    {
      "icon.png": Buffer.from(ICON_1X, "base64"),
      "icon@2x.png": Buffer.from(ICON_2X, "base64"),
      "logo.png": Buffer.from(ICON_2X, "base64"),
    },
    {
      signerCert: Buffer.from(config.signerCert, "base64"),
      signerKey: Buffer.from(config.signerKey, "base64"),
      signerKeyPassphrase: config.signerKeyPassphrase,
      wwdr: Buffer.from(config.wwdr, "base64"),
    },
    {
      formatVersion: 1,
      passTypeIdentifier: config.passTypeIdentifier,
      serialNumber: row.serial_number,
      teamIdentifier: config.teamIdentifier,
      organizationName: "Chargeurs.ch",
      description: "Carte membre Chargeurs.ch",
      logoText: "Chargeurs.ch",
      foregroundColor: "rgb(255,255,255)",
      backgroundColor: "rgb(18,18,22)",
      labelColor: "rgb(252,197,25)",
      webServiceURL: config.webServiceUrl,
      authenticationToken: authToken,
      sharingProhibited: true,
    },
  );

  pass.type = "storeCard";
  pass.headerFields.push({ key: "status", label: "STATUT", value: data.accountStatus.toUpperCase() });
  pass.primaryFields.push({ key: "member", label: "MEMBRE", value: data.memberName });
  if (data.creditCents !== null) {
    pass.secondaryFields.push({ key: "credit", label: "CRÉDIT", value: data.creditCents / 100, currencyCode: "CHF" });
  }
  pass.secondaryFields.push({ key: "rentals", label: "LOCATIONS", value: data.totalRentals });
  pass.auxiliaryFields.push({ key: "memberNumber", label: "N° MEMBRE", value: data.memberNumber });
  if (data.subscriptionName) pass.auxiliaryFields.push({ key: "subscription", label: "FORMULE", value: data.subscriptionName });
  if (data.activeRental) {
    pass.auxiliaryFields.push({ key: "activeRental", label: "LOCATION ACTIVE", value: data.activeRental.state });
    pass.backFields.push({ key: "currentRental", label: "Voir ma location", value: walletUrl });
  }
  if (data.lastRentalAt) pass.backFields.push({ key: "lastRental", label: "Dernière location", value: new Date(data.lastRentalAt).toLocaleString("fr-CH") });
  pass.backFields.push(
    { key: "account", label: "Ouvrir mon compte", value: walletUrl },
    { key: "stations", label: "Trouver une borne", value: `${config.appUrl}/?section=bornes` },
    { key: "support", label: "Assistance Chargeurs.ch", value: `${config.appUrl}/support` },
    { key: "terms", label: "Conditions", value: "Cette carte membre ne constitue ni un moyen de paiement ni une carte bancaire. L'accès aux données personnelles nécessite une connexion au compte Chargeurs.ch." },
  );
  pass.setBarcodes({ format: "PKBarcodeFormatQR", message: walletUrl, messageEncoding: "iso-8859-1", altText: data.memberNumber });
  return new Uint8Array(pass.getAsBuffer());
}
