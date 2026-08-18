import { PKPass } from "npm:passkit-generator@3.4.0";
import { Buffer } from "node:buffer";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sha256Hex, snapshotHash } from "./db.ts";

// Small embedded assets inherited from the previously reviewed Chargeurs.ch
// Wallet prototype. No external asset fetch is required to sign a pass.
const ICON_1X = "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAAjElEQVR42tXW0Q2AMAgEUIob9KNbOW23cgej/yZGegcYusDzhFzbeh+XJB+VHw6NHnPLRRGQQlGw1kyZlBD6BMd+xqJswhoz9UopItIsNYiCb/PWbDBspl8brVlzNKERv3VpkawfZC0KzQbdFmm1Cmu+HNILHwGppCgIowxY52pjUy4n9QDhGiz5XLkBFnMwu3lNyCwAAAAASUVORK5CYII=";
const ICON_2X = "iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAA/ElEQVR42u3ZwRXCQAgEUIId5JCurNau7MGnd0+aLAMMsx18BzYsbvt+vG3AcRtyBBV08Xk+bvxQFFKly5ZmGhSNTIF+I4/7Sz3aFppRsnBoJhIGzUaqR9nSDIdWQap02dIMg/6KRE1FIdBqSapHGdM0M9tWrTuRyDO97ROQ7Xr0yi3tzH25DNqhZC9DOyFb9Oiq6cmZ+zLkOxrx46ychZ29ZKHQf9OMeNVoqGcp2ZLQyId4mS1g9LbB2ZPUZcSYZjq09Rbw14sIiVSPMpVsGjQDCYdmIUOhI/5kqpYmDJqNhEArIMOgFZdnPiHNUGglpBlw3Tn+mSaooOfOB2y5U1UQU10NAAAAAElFTkSuQmCC";
const LOGO_1X = "iVBORw0KGgoAAAANSUhEUgAAAKAAAAAyCAYAAADbYdBlAAABYUlEQVR42u3dUW7CMBBF0YayApBgVV0tqwKJJVT0t0JVBZmJJ47P/ffImly9sUGQ6XA4PT6AInZaAAKCgMCmBbxdPnUbNQKSD0YwxhRQ+qFMQPLBCMaYAko/lAlIPqxuBJ++vnUbywso/fAO+17lu9+vofXH4zlUM7o+u27mflr2pstbcMaDfq7xbs3o+uy6mftp2Zs0AVulX9aD/l1rbs3o+uy6mftp1ZtdT/LBJaRcvr/OF9Fac2tG12fXzdxPq950eQbMbPDcmtH12XUz99OyN1PkNyFLpZ/PDI1g8qGPMyDQXEDphzIByYfNjWDyEbA0/TAu01J/zfGqrNJPAhq92JaAr6Qf+bCaSwgIaPRiDAHJh0UF/O/8Rz44A2JMAaUfygQkH5oI6Ks6rC4BpR/KBCQfygQkH5oK6PyH1SSg9EOZgORDmYDkQ4mAzn8oT0DphzlMXteKzd2CAQKiC34AfcOoqqMTFLMAAAAASUVORK5CYII=";
const LOGO_2X = "iVBORw0KGgoAAAANSUhEUgAAAUAAAABkCAYAAAD32uk+AAAClklEQVR42u3c0U3rQBCGUQJU4EimKqqlKpBSAnKeeLFklEC8O97/nAa8MubTjH0vp2malyeAQM9uASCAAAIIIIAAAggggAACCCCA5Xx9vPipAnkBFD/ACgyQFEDTHxAZQPEDrMAASQE0/QGRARQ/wAoMkBRA0x8QGUDxA6zAAEkBNP0BkQEUP8AKDJAUQNMfEBnAe+I3v3/7qQJWYIBDB9DqC0QGUPyAPb26Be1cLp/dz3A+v3U5X6/rVj9rxfuS9IyUnQBHm/6q/JJvnWPv8/W6bvWzVrwvSc9IyQCKX9vztDpfr+tWP2vF+5LyjPgKHBa/9blan6/XdaufteJ9SXhGygXQhw+glVIBFD8gNoAAkQE0/QGRARw5fr/926YK52p9vl7XrX7Wivcl4RmxAgdGcH2eVufrdd3qZ614X1Keke4BTFl9q/yyb51j7/P1um71s1a8L0nPyGma5mWk+PlzWMCthvu/wHtNlMIK4+m2Ah9p9RU/EMDI+AECGMv0BwJo9QUEUPwAAQQQQNMfIIDiBwjgUYkfCGDs9AcIoNUXEECrLyCAA09/4ge5dvtrMHuFxTtFwAps+gOSAvjI6U/8AB9BAAG0+gICKH6AANbyiPd/4gfEr8AAUQE0/QGRARQ/4LAB/M/7P/ED4ldggKgAmv6AyACKH2AFBjhqAP/yAcT0B0ROgOIHRAZQ/IDoCRBgiADe8/7P9AdEToDiB0QGUPyA6AkQYKgA3vL+z/QHRE6A4gdEBlD8gOgJECAugKY/YOgAbn0AET/ACgyQFEDTHxAZQPEDIgK4fv8nfkD8CgwQFUDTHxAZQPEDogL48/5P/ID4FRggKoCmP6CV0zTNi9sAmAABBBBAAAEEEEAAAQQQ4Niu1DoMST6r/mcAAAAASUVORK5CYII=";

export type CustomerWalletPassRow = {
  id: string;
  user_id: string;
  membership_id: string | null;
  public_pass_id: string;
  apple_serial_number: string | null;
  status: "active" | "suspended" | "revoked";
  token_version: number;
  access_token_hash: string | null;
  pass_revision: number;
  provider_status: "not_issued" | "pending" | "issued" | "update_pending" | "error" | "revoked";
  last_generated_at: string | null;
  last_synced_at: string | null;
  revoked_at: string | null;
  provider_metadata: Record<string, unknown> | null;
};

export type WalletVisibleData = {
  displayName: string;
  membershipStatus: string;
  planName: string;
  chargePoints: number;
  totalRentals: number;
  activeRental: { stationId: string | null; state: string } | null;
  lastRentalAt: string | null;
  renewsAt: string | null;
  passReference: string;
};

const REQUIRED_CONFIG = [
  "APPLE_PASS_TYPE_IDENTIFIER",
  "APPLE_TEAM_IDENTIFIER",
  "APPLE_PASS_SIGNER_CERTIFICATE_BASE64",
  "APPLE_PASS_SIGNER_KEY_BASE64",
  "APPLE_WWDR_CERTIFICATE_BASE64",
  "APPLE_WALLET_AUTH_SECRET",
  "PUBLIC_APP_URL",
] as const;

export function appleWalletConfigStatus() {
  const missing = REQUIRED_CONFIG.filter((name) => !(Deno.env.get(name)?.trim()));
  return { ready: missing.length === 0, missing };
}

function required(name: typeof REQUIRED_CONFIG[number]): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`APPLE_WALLET_CONFIG_MISSING:${name}`);
  return value;
}

function walletConfig() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (!supabaseUrl) throw new Error("APPLE_WALLET_CONFIG_MISSING:SUPABASE_URL");
  return {
    passTypeIdentifier: required("APPLE_PASS_TYPE_IDENTIFIER"),
    teamIdentifier: required("APPLE_TEAM_IDENTIFIER"),
    signerCertBase64: required("APPLE_PASS_SIGNER_CERTIFICATE_BASE64"),
    signerKeyBase64: required("APPLE_PASS_SIGNER_KEY_BASE64"),
    signerKeyPassphrase: Deno.env.get("APPLE_PASS_SIGNER_KEY_PASSPHRASE") ?? "",
    wwdrBase64: required("APPLE_WWDR_CERTIFICATE_BASE64"),
    authSecret: required("APPLE_WALLET_AUTH_SECRET"),
    appUrl: required("PUBLIC_APP_URL").replace(/\/$/, ""),
    webServiceUrl: (Deno.env.get("APPLE_PASS_WEB_SERVICE_URL")?.trim() || `${supabaseUrl}/functions/v1/apple-wallet-web-service`).replace(/\/$/, ""),
  };
}

function relationObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  if (new TextEncoder().encode(secret).length < 32) throw new Error("APPLE_WALLET_AUTH_SECRET_TOO_SHORT");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function authenticationTokenFor(row: CustomerWalletPassRow): Promise<string> {
  const { authSecret } = walletConfig();
  return `wa_${base64Url(await hmacSha256(authSecret, `${row.public_pass_id}:${row.token_version}`))}`;
}

export async function verifyApplePassAuthorization(row: CustomerWalletPassRow, authorization: string | null): Promise<boolean> {
  const raw = (authorization ?? "").match(/^ApplePass\s+(.+)$/i)?.[1]?.trim();
  if (!raw || !row.access_token_hash) return false;
  const actual = await sha256Hex(raw);
  if (actual.length !== row.access_token_hash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) mismatch |= actual.charCodeAt(i) ^ row.access_token_hash.charCodeAt(i);
  return mismatch === 0;
}

export function serialFor(row: CustomerWalletPassRow): string {
  return row.apple_serial_number?.trim() || `CHG-${row.public_pass_id.toUpperCase()}`;
}

export async function getOrCreateCustomerWalletPass(
  db: SupabaseClient,
  userId: string,
  membershipId: string,
): Promise<CustomerWalletPassRow> {
  const find = () => db.from("customer_wallet_passes")
    .select("id,user_id,membership_id,public_pass_id,apple_serial_number,status,token_version,access_token_hash,pass_revision,provider_status,last_generated_at,last_synced_at,revoked_at,provider_metadata")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existing = await find();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as CustomerWalletPassRow;

  const created = await db.from("customer_wallet_passes").insert({
    user_id: userId,
    membership_id: membershipId,
    status: "active",
    provider_status: "not_issued",
  }).select("id,user_id,membership_id,public_pass_id,apple_serial_number,status,token_version,access_token_hash,pass_revision,provider_status,last_generated_at,last_synced_at,revoked_at,provider_metadata").single();

  if (!created.error) return created.data as CustomerWalletPassRow;
  if (created.error.code === "23505") {
    const raced = await find();
    if (!raced.error && raced.data) return raced.data as CustomerWalletPassRow;
  }
  throw created.error;
}

export async function resolveWalletVisibleData(db: SupabaseClient, userId: string, passReference: string): Promise<WalletVisibleData> {
  const [profileResult, membershipResult, pointsResult, rentalsResult] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    db.from("customer_memberships")
      .select("id,status,renews_at,ends_at,stripe_current_period_end,customer_membership_plans(name,code)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("customer_chargepoints_balances").select("balance,last_activity_at").eq("user_id", userId).maybeSingle(),
    db.from("rental_sessions")
      .select("id,station_id,state,created_at,paid_at,ejected_at,returned_at,closed_at")
      .eq("customer_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (membershipResult.error) throw membershipResult.error;
  if (pointsResult.error) throw pointsResult.error;
  if (rentalsResult.error) throw rentalsResult.error;

  const membership = membershipResult.data as Record<string, unknown> | null;
  if (!membership || stringValue(membership.status) !== "active") throw new Error("ACTIVE_MEMBERSHIP_REQUIRED");
  const plan = relationObject(membership.customer_membership_plans);
  const planName = stringValue(plan?.name);
  if (!planName) throw new Error("MEMBERSHIP_PLAN_UNAVAILABLE");

  const rentals = (rentalsResult.data ?? []) as Array<Record<string, unknown>>;
  const activeStates = new Set(["ejected", "battery_taken", "active_rental", "ejecting"]);
  const active = rentals.find((rental) =>
    activeStates.has(stringValue(rental.state)) && !rental.returned_at && !rental.closed_at
  ) ?? null;
  const last = rentals[0] ?? null;
  const renewsAt = stringValue(
    membership.stripe_current_period_end ?? membership.renews_at ?? membership.ends_at,
  ) || null;

  return {
    displayName: stringValue(profileResult.data?.display_name, "Membre Chargeurs.ch"),
    membershipStatus: stringValue(membership.status),
    planName,
    chargePoints: Number(pointsResult.data?.balance ?? 0),
    totalRentals: rentals.length,
    activeRental: active ? {
      stationId: stringValue(active.station_id) || null,
      state: stringValue(active.state),
    } : null,
    lastRentalAt: last ? stringValue(last.closed_at ?? last.returned_at ?? last.ejected_at ?? last.paid_at ?? last.created_at) || null : null,
    renewsAt,
    passReference: passReference.slice(-10).toUpperCase(),
  };
}

export async function visibleDataHash(data: WalletVisibleData): Promise<string> {
  return snapshotHash(data);
}

export async function prepareWalletSnapshot(db: SupabaseClient, userId: string) {
  const membershipResult = await db.from("customer_memberships")
    .select("id,status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (membershipResult.error) throw membershipResult.error;
  if (!membershipResult.data || membershipResult.data.status !== "active") throw new Error("ACTIVE_MEMBERSHIP_REQUIRED");

  let row = await getOrCreateCustomerWalletPass(db, userId, String(membershipResult.data.id));
  if (row.status !== "active" || row.revoked_at) throw new Error("WALLET_PASS_REVOKED");

  const serialNumber = serialFor(row);
  const authenticationToken = await authenticationTokenFor(row);
  const authenticationTokenHash = await sha256Hex(authenticationToken);
  const data = await resolveWalletVisibleData(db, userId, row.public_pass_id);
  const dataHash = await visibleDataHash(data);
  const metadata = row.provider_metadata && typeof row.provider_metadata === "object" ? row.provider_metadata : {};
  const previousHash = typeof metadata.visible_data_hash === "string" ? metadata.visible_data_hash : null;
  const changed = previousHash !== null && previousHash !== dataHash;
  const nextRevision = changed ? row.pass_revision + 1 : row.pass_revision;
  const nextProviderStatus = changed && row.provider_status === "issued" ? "update_pending" : row.provider_status;

  const update = await db.from("customer_wallet_passes").update({
    membership_id: String(membershipResult.data.id),
    apple_serial_number: serialNumber,
    access_token_hash: authenticationTokenHash,
    pass_revision: nextRevision,
    provider_status: nextProviderStatus,
    provider_metadata: { ...metadata, visible_data_hash: dataHash },
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).select("id,user_id,membership_id,public_pass_id,apple_serial_number,status,token_version,access_token_hash,pass_revision,provider_status,last_generated_at,last_synced_at,revoked_at,provider_metadata").single();
  if (update.error) throw update.error;
  row = update.data as CustomerWalletPassRow;

  return { row, data, dataHash, authenticationToken, serialNumber, changed };
}

function passLoginUrl(appUrl: string, publicPassId: string): string {
  const url = new URL("/compte/login", `${appUrl}/`);
  url.searchParams.set("pass_ref", publicPassId);
  return url.toString();
}

export async function buildSignedPass(
  row: CustomerWalletPassRow,
  data: WalletVisibleData,
  authenticationToken: string,
): Promise<Uint8Array> {
  if (row.status !== "active" || row.revoked_at) throw new Error("WALLET_PASS_REVOKED");
  const config = walletConfig();
  const serialNumber = serialFor(row);
  const loginUrl = passLoginUrl(config.appUrl, row.public_pass_id);

  const pass = new PKPass(
    {
      "icon.png": Buffer.from(ICON_1X, "base64"),
      "icon@2x.png": Buffer.from(ICON_2X, "base64"),
      "logo.png": Buffer.from(LOGO_1X, "base64"),
      "logo@2x.png": Buffer.from(LOGO_2X, "base64"),
    },
    {
      signerCert: Buffer.from(config.signerCertBase64, "base64"),
      signerKey: Buffer.from(config.signerKeyBase64, "base64"),
      signerKeyPassphrase: config.signerKeyPassphrase,
      wwdr: Buffer.from(config.wwdrBase64, "base64"),
    },
    {
      formatVersion: 1,
      passTypeIdentifier: config.passTypeIdentifier,
      serialNumber,
      teamIdentifier: config.teamIdentifier,
      organizationName: "Chargeurs.ch",
      description: "Chargeurs+ Pass",
      logoText: "Chargeurs.ch+",
      foregroundColor: "rgb(255,255,255)",
      backgroundColor: "rgb(17,14,30)",
      labelColor: "rgb(196,181,253)",
      webServiceURL: config.webServiceUrl,
      authenticationToken,
      sharingProhibited: true,
    },
  );

  pass.type = "storeCard";
  pass.headerFields.push({ key: "status", label: "ADHÉSION", value: "ACTIVE" });
  pass.primaryFields.push({ key: "member", label: "MEMBRE", value: data.displayName });
  pass.secondaryFields.push(
    { key: "plan", label: "FORMULE", value: data.planName },
    { key: "chargepoints", label: "CHARGEPOINTS", value: data.chargePoints },
  );
  pass.auxiliaryFields.push(
    { key: "rentals", label: "LOCATIONS", value: data.totalRentals },
    { key: "reference", label: "RÉF. PASS", value: data.passReference },
  );

  if (data.activeRental) {
    pass.backFields.push({
      key: "activeRental",
      label: "Location en cours",
      value: `${data.activeRental.stationId ? `Borne ${data.activeRental.stationId} · ` : ""}${data.activeRental.state}`,
    });
  }
  if (data.renewsAt) {
    pass.backFields.push({ key: "renewsAt", label: "Prochaine échéance", value: new Date(data.renewsAt).toLocaleString("fr-CH") });
  }
  if (data.lastRentalAt) {
    pass.backFields.push({ key: "lastRental", label: "Dernière location", value: new Date(data.lastRentalAt).toLocaleString("fr-CH") });
  }
  pass.backFields.push(
    { key: "account", label: "Ouvrir mon compte Chargeurs.ch", value: loginUrl },
    { key: "support", label: "Assistance", value: `${config.appUrl}/support` },
    { key: "notice", label: "À propos", value: "Chargeurs+ Pass est une carte membre. Ce pass n'est ni une carte bancaire ni un moyen de paiement." },
  );

  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: loginUrl,
    messageEncoding: "iso-8859-1",
    altText: data.passReference,
  });

  return new Uint8Array(pass.getAsBuffer());
}

function decodeBase64Pem(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

export async function notifyAppleWalletDevice(pushToken: string): Promise<{ ok: boolean; status: number; reason: string | null }> {
  const config = walletConfig();
  const cert = decodeBase64Pem(config.signerCertBase64);
  const key = decodeBase64Pem(config.signerKeyBase64);
  if (!cert.includes("BEGIN CERTIFICATE")) throw new Error("APPLE_WALLET_SIGNER_CERT_NOT_PEM");
  if (!key.includes("BEGIN PRIVATE KEY") && !key.includes("BEGIN RSA PRIVATE KEY") && !key.includes("BEGIN EC PRIVATE KEY")) {
    throw new Error("APPLE_WALLET_SIGNER_KEY_NOT_PEM");
  }
  if (/ENCRYPTED PRIVATE KEY/.test(key)) throw new Error("APPLE_WALLET_APNS_REQUIRES_UNENCRYPTED_SECRET_KEY");

  const client = Deno.createHttpClient({ cert, key });
  try {
    const response = await fetch(`https://api.push.apple.com/3/device/${encodeURIComponent(pushToken)}`, {
      method: "POST",
      client,
      headers: {
        "apns-topic": config.passTypeIdentifier,
        "apns-push-type": "background",
        "apns-priority": "5",
        "content-type": "application/json",
      },
      body: "{}",
    } as RequestInit & { client: Deno.HttpClient });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      reason: typeof body.reason === "string" ? body.reason : null,
    };
  } finally {
    client.close();
  }
}

export async function notifyRegisteredDevices(db: SupabaseClient, walletPassId: string) {
  const registrations = await db.from("customer_wallet_device_registrations")
    .select("id,push_token")
    .eq("wallet_pass_id", walletPassId)
    .is("unregistered_at", null)
    .limit(500);
  if (registrations.error) throw registrations.error;

  let sent = 0;
  let failed = 0;
  for (const registration of registrations.data ?? []) {
    try {
      const result = await notifyAppleWalletDevice(String(registration.push_token));
      if (result.ok) {
        sent += 1;
        await db.from("customer_wallet_device_registrations")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", registration.id);
      } else {
        failed += 1;
        if (result.status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(result.reason ?? "")) {
          await db.from("customer_wallet_device_registrations")
            .update({ unregistered_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
            .eq("id", registration.id);
        }
      }
    } catch {
      failed += 1;
    }
  }
  return { devices: registrations.data?.length ?? 0, sent, failed };
}
