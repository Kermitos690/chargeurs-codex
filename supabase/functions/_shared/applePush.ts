import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`WALLET_PUSH_CONFIG_MISSING:${name}`);
  return value;
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBytes(pemOrBase64: string): Uint8Array {
  const decoded = pemOrBase64.includes("BEGIN PRIVATE KEY")
    ? pemOrBase64
    : new TextDecoder().decode(Uint8Array.from(atob(pemOrBase64), (char) => char.charCodeAt(0)));
  const body = decoded.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

let cachedJwt: { token: string; expiresAt: number } | null = null;

async function providerJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token;

  const keyId = required("APPLE_WALLET_APNS_KEY_ID");
  const teamId = required("APPLE_TEAM_IDENTIFIER");
  const keyBytes = pemToBytes(required("APPLE_WALLET_APNS_PRIVATE_KEY_BASE64"));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64Url(JSON.stringify({ iss: teamId, iat: now }));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  ));
  const token = `${signingInput}.${base64Url(signature)}`;
  cachedJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

export type PushResult = {
  ok: boolean;
  status: number;
  reason: string | null;
  invalidateToken: boolean;
};

export async function sendWalletPush(pushToken: string, passTypeIdentifier: string): Promise<PushResult> {
  if (!/^[A-Fa-f0-9]{32,512}$/.test(pushToken)) {
    return { ok: false, status: 400, reason: "INVALID_PUSH_TOKEN_FORMAT", invalidateToken: true };
  }
  const sandbox = Deno.env.get("APPLE_WALLET_APNS_ENVIRONMENT") === "sandbox";
  const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const response = await fetch(`${host}/3/device/${pushToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerJwt()}`,
      "apns-topic": passTypeIdentifier,
      "apns-push-type": "background",
      "apns-priority": "5",
      "content-type": "application/json",
    },
    body: "{}",
  });
  const body = await response.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : null;
  const invalidateToken = response.status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason ?? "");
  return { ok: response.ok, status: response.status, reason, invalidateToken };
}

export async function notifyPassDevices(db: SupabaseClient, passId: string, passTypeIdentifier: string) {
  const registrations = await db.from("wallet_device_registrations")
    .select("id,push_token")
    .eq("wallet_pass_id", passId)
    .is("unregistered_at", null)
    .limit(500);
  if (registrations.error) throw registrations.error;

  let sent = 0;
  let failed = 0;
  for (const registration of registrations.data ?? []) {
    try {
      const result = await sendWalletPush(registration.push_token, passTypeIdentifier);
      if (result.ok) sent += 1;
      else failed += 1;
      if (result.invalidateToken) {
        await db.from("wallet_device_registrations")
          .update({ unregistered_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
          .eq("id", registration.id);
      }
    } catch {
      failed += 1;
    }
  }
  return { devices: registrations.data?.length ?? 0, sent, failed };
}
