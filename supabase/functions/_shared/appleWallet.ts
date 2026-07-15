import { PKPass } from "npm:passkit-generator@3.4.0";
import { Buffer } from "node:buffer";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sha256Hex, snapshotHash } from "./db.ts";

const ICON_1X = "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAAjElEQVR42tXW0Q2AMAgEUIob9KNbOW23cgej/yZGegcYusDzhFzbeh+XJB+VHw6NHnPLRRGQQlGw1kyZlBD6BMd+xqJswhoz9UopItIsNYiCb/PWbDBspl8brVlzNKERv3VpkawfZC0KzQbdFmm1Cmu+HNILHwGppCgIowxY52pjUy4n9QDhGiz5XLkBFnMwu3lNyCwAAAAASUVORK5CYII=";
const ICON_2X = "iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAA/ElEQVR42u3ZwRXCQAgEUIId5JCurNau7MGnd0+aLAMMsx18BzYsbvt+vG3AcRtyBBV08Xk+bvxQFFKly5ZmGhSNTIF+I4/7Sz3aFppRsnBoJhIGzUaqR9nSDIdWQap02dIMg/6KRE1FIdBqSapHGdM0M9tWrTuRyDO97ROQ7Xr0yi3tzH25DNqhZC9DOyFb9Oiq6cmZ+zLkOxrx46ychZ29ZKHQf9OMeNVoqGcp2ZLQyId4mS1g9LbB2ZPUZcSYZjq09Rbw14sIiVSPMpVsGjQDCYdmIUOhI/5kqpYmDJqNhEArIMOgFZdnPiHNUGglpBlw3Tn+mSaooOfOB2y5U1UQU10NAAAAAElFTkSuQmCC";
const LOGO_1X = "iVBORw0KGgoAAAANSUhEUgAAAKAAAAAyCAYAAADbYdBlAAABYUlEQVR42u3dUW7CMBBF0YayApBgVV0tqwKJJVT0t0JVBZmJJ47P/ffImly9sUGQ6XA4PT6AInZaAAKCgMCmBbxdPnUbNQKSD0YwxhRQ+qFMQPLBCMaYAko/lAlIPqxuBJ++vnUbywso/fAO+17lu9+vofXH4zlUM7o+u27mflr2pstbcMaDfq7xbs3o+uy6mftp2Zs0AVulX9aD/l1rbs3o+uy6mftp1ZtdT/LBJaRcvr/OF9Fac2tG12fXzdxPq950eQbMbPDcmtH12XUz99OyN1PkNyFLpZ/PDI1g8qGPMyDQXEDphzIByYfNjWDyEbA0/TAu01J/zfGqrNJPAhq92JaAr6Qf+bCaSwgIaPRiDAHJh0UF/O/8Rz44A2JMAaUfygQkH5oI6Ks6rC4BpR/KBCQfygQkH5oK6PyH1SSg9EOZgORDmYDkQ4mAzn8oT0DphzlMXteKzd2CAQKiC34AfcOoqqMTFLMAAAAASUVORK5CYII=";
const LOGO_2X = "iVBORw0KGgoAAAANSUhEUgAAAUAAAABkCAYAAAD32uk+AAAClklEQVR42u3c0U3rQBCGUQJU4EimKqqlKpBSAnKeeLFklEC8O97/nAa8MubTjH0vp2malyeAQM9uASCAAAIIIIAAAggggAACCCCA5Xx9vPipAnkBFD/ACgyQFEDTHxAZQPEDrMAASQE0/QGRARQ/wAoMkBRA0x8QGUDxA6zAAEkBNP0BkQEUP8AKDJAUQNMfEBnAe+I3v3/7qQJWYIBDB9DqC0QGUPyAPb26Be1cLp/dz3A+v3U5X6/rVj9rxfuS9IyUnQBHm/6q/JJvnWPv8/W6bvWzVrwvSc9IyQCKX9vztDpfr+tWP2vF+5LyjPgKHBa/9blan6/XdaufteJ9SXhGygXQhw+glVIBFD8gNoAAkQE0/QGRARw5fr/926YK52p9vl7XrX7Wivcl4RmxAgdGcH2eVufrdd3qZ614X1Keke4BTFl9q/yyb51j7/P1um71s1a8L0nPyGma5mWk+PlzWMCthvu/wHtNlMIK4+m2Ah9p9RU/EMDI+AECGMv0BwJo9QUEUPwAAQQQQNMfIIDiBwjgUYkfCGDs9AcIoNUXEECrLyCAA09/4ge5dvtrMHuFxTtFwAps+gOSAvjI6U/8AB9BAAG0+gICKH6AANbyiPd/4gfEr8AAUQE0/QGRARQ/4LAB/M/7P/ED4ldggKgAmv6AyACKH2AFBjhqAP/yAcT0B0ROgOIHRAZQ/IDoCRBgiADe8/7P9AdEToDiB0QGUPyA6AkQYKgA3vL+z/QHRE6A4gdEBlD8gOgJECAugKY/YOgAbn0AET/ACgyQFEDTHxAZQPEDIgK4fv8nfkD8CgwQFUDTHxAZQPEDogL48/5P/ID4FRggKoCmP6CV0zTNi9sAmAABBBBAAAEEEEAAAQQQ4Niu1DoMST6r/mcAAAAASUVORK5CYII=";

export type WalletVisibleData = {
  memberName: string;
  memberNumber: string;
  accountStatus: string;
  subscriptionName: string | null;
  creditCents: number | null;
  totalRentals: number;
  activeRental: { stationId: string | null; state: string } | null;
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
  last_updated_at: string;
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
    appUrl: required("PUBLIC_APP_URL").replace(/\/$/, ""),
    signerCert: required("APPLE_PASS_SIGNER_CERTIFICATE_BASE64"),
    signerKey: required("APPLE_PASS_SIGNER_KEY_BASE64"),
    signerKeyPassphrase: Deno.env.get("APPLE_PASS_SIGNER_KEY_PASSPHRASE") ?? "",
    wwdr: required("APPLE_WWDR_CERTIFICATE_BASE64"),
    encryptionKey: required("WALLET_TOKEN_ENCRYPTION_KEY"),
  };
}

export function stableWalletSerial(userId: string): string {
  const normalized = userId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (normalized.length < 16) throw new Error("INVALID_USER_ID");
  return `CHG-${normalized}`;
}

function randomToken(prefix: "wq" | "wa"): string {
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
  if (combined.length < 29) throw new Error("INVALID_ENCRYPTED_WALLET_TOKEN");
  const key = await importAesKey(base64Key);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(clear);
}

export async function getOrCreateWalletPass(db: SupabaseClient, userId: string): Promise<WalletPassRow> {
  const config = walletConfig();
  const findExisting = () => db.from("wallet_passes").select("*")
    .eq("user_id", userId).eq("pass_type_identifier", config.passTypeIdentifier).maybeSingle();
  const existing = await findExisting();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as WalletPassRow;

  const qrToken = randomToken("wq");
  const authToken = randomToken("wa");
  const insert = await db.from("wallet_passes").insert({
    user_id: userId,
    serial_number: stableWalletSerial(userId),
    pass_type_identifier: config.passTypeIdentifier,
    qr_token_hash: await sha256Hex(qrToken),
    qr_token_ciphertext: await encryptToken(qrToken, config.encryptionKey),
    qr_token_last_four: qrToken.slice(-4),
    apple_authentication_token_hash: await sha256Hex(authToken),
    apple_authentication_token_ciphertext: await encryptToken(authToken, config.encryptionKey),
  }).select("*").single();
  if (!insert.error) return insert.data as WalletPassRow;
  if (insert.error.code === "23505") {
    const raced = await findExisting();
    if (!raced.error && raced.data) return raced.data as WalletPassRow;
  }
  throw insert.error;
}

function firstString(source: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstCents(source: Record<string, unknown> | null, keys: string[]): number | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  }
  return null;
}

type RentalRecord = {
  id: string;
  station_id: string | null;
  state: string;
  created_at: string;
  paid_at: string | null;
  ejected_at: string | null;
  returned_at: string | null;
  closed_at: string | null;
};

export async function resolveVisibleData(db: SupabaseClient, userId: string, email: string | null): Promise<WalletVisibleData> {
  const profileResult = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = (profileResult.data ?? {}) as Record<string, unknown>;
  const memberResult = await db.rpc("ensure_member_number", { p_user_id: userId });
  if (memberResult.error) throw memberResult.error;

  const fields = "id,station_id,state,created_at,paid_at,ejected_at,returned_at,closed_at";
  const byUser = await db.from("rental_sessions").select(fields).eq("customer_user_id", userId).limit(500);
  if (byUser.error) throw byUser.error;
  const records = new Map<string, RentalRecord>();
  for (const row of (byUser.data ?? []) as unknown as RentalRecord[]) records.set(row.id, row);

  if (email) {
    const byEmail = await db.from("rental_sessions").select(fields).ilike("customer_email", email).limit(500);
    if (byEmail.error) throw byEmail.error;
    for (const row of (byEmail.data ?? []) as unknown as RentalRecord[]) records.set(row.id, row);
  }

  const rentals = [...records.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const activeStates = new Set(["ejected", "battery_taken", "active_rental", "payment_succeeded", "ejecting"]);
  const active = rentals.find((r) => activeStates.has(r.state) && !r.returned_at && !r.closed_at) ?? null;

  let creditCents = firstCents(profile, ["credit_cents", "balance_cents", "wallet_balance_cents"]);
  if (creditCents === null) {
    const wallet = await db.from("wallets").select("*").eq("user_id", userId).maybeSingle();
    if (!wallet.error && wallet.data) creditCents = firstCents(wallet.data as Record<string, unknown>, ["balance_cents", "credit_cents"]);
  }

  let subscriptionName = firstString(profile, ["subscription_name", "plan_name", "membership_tier"]);
  if (!subscriptionName) {
    const subscription = await db.from("subscriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!subscription.error && subscription.data) {
      subscriptionName = firstString(subscription.data as Record<string, unknown>, ["plan_name", "name", "tier", "status"]);
    }
  }

  return {
    memberName: firstString(profile, ["display_name"]) ?? "Membre Chargeurs.ch",
    memberNumber: String(memberResult.data),
    accountStatus: firstString(profile, ["account_status"]) ?? "active",
    subscriptionName,
    creditCents,
    totalRentals: rentals.length,
    activeRental: active ? { stationId: active.station_id, state: active.state } : null,
    lastRentalAt: rentals.length ? (rentals[0].closed_at ?? rentals[0].returned_at ?? rentals[0].ejected_at ?? rentals[0].paid_at ?? rentals[0].created_at) : null,
  };
}

export async function visibleDataHash(data: WalletVisibleData): Promise<string> {
  return snapshotHash(data);
}

export function walletUrlForToken(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/wallet/${encodeURIComponent(token)}`;
}

export async function buildSignedPass(row: WalletPassRow, data: WalletVisibleData): Promise<Uint8Array> {
  if (row.status !== "active") throw new Error("WALLET_PASS_REVOKED");
  const config = walletConfig();
  const qrToken = await decryptToken(row.qr_token_ciphertext, config.encryptionKey);
  const authToken = await decryptToken(row.apple_authentication_token_ciphertext, config.encryptionKey);
  const walletUrl = walletUrlForToken(config.appUrl, qrToken);

  const pass = new PKPass(
    {
      "icon.png": Buffer.from(ICON_1X, "base64"),
      "icon@2x.png": Buffer.from(ICON_2X, "base64"),
      "logo.png": Buffer.from(LOGO_1X, "base64"),
      "logo@2x.png": Buffer.from(LOGO_2X, "base64"),
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
    pass.secondaryFields.push({ key: "credit", label: "CRÉDIT", value: data.creditCents / 100, currencyCode: "CHF" } as never);
  }
  pass.secondaryFields.push({ key: "rentals", label: "LOCATIONS", value: data.totalRentals });
  pass.auxiliaryFields.push({ key: "memberNumber", label: "N° MEMBRE", value: data.memberNumber });
  if (data.subscriptionName) pass.auxiliaryFields.push({ key: "subscription", label: "FORMULE", value: data.subscriptionName });
  if (data.activeRental) {
    pass.auxiliaryFields.push({ key: "activeRental", label: "BATTERIE", value: data.activeRental.state });
    pass.backFields.push({ key: "currentRental", label: "Voir ma location", value: walletUrl });
  }
  if (data.lastRentalAt) {
    pass.backFields.push({ key: "lastRental", label: "Dernière location", value: new Date(data.lastRentalAt).toLocaleString("fr-CH") });
  }
  pass.backFields.push(
    { key: "account", label: "Ouvrir mon compte", value: walletUrl },
    { key: "stations", label: "Trouver une borne", value: `${config.appUrl}/?section=bornes` },
    { key: "support", label: "Assistance Chargeurs.ch", value: `${config.appUrl}/support` },
    { key: "terms", label: "Conditions", value: "Cette carte membre ne constitue ni un moyen de paiement ni une carte bancaire. Une connexion au compte Chargeurs.ch est requise pour consulter les données personnelles." },
  );
  pass.setBarcodes({ format: "PKBarcodeFormatQR", message: walletUrl, messageEncoding: "iso-8859-1", altText: data.memberNumber });
  return new Uint8Array(pass.getAsBuffer());
}
