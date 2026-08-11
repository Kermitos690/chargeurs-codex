import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`APPLE_WALLET_PUSH_CONFIG_MISSING:${name}`);
  return value;
}

function decodeBase64Pem(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

export async function notifyAppleWalletDevice(pushToken: string): Promise<{ ok: boolean; status: number; reason: string | null }> {
  const passTypeIdentifier = required("APPLE_PASS_TYPE_IDENTIFIER");
  const cert = decodeBase64Pem(required("APPLE_PASS_SIGNER_CERTIFICATE_BASE64"));
  const key = decodeBase64Pem(required("APPLE_PASS_SIGNER_KEY_BASE64"));

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
        "apns-topic": passTypeIdentifier,
        "apns-push-type": "background",
        "apns-priority": "5",
        "content-type": "application/json",
      },
      body: "{}",
    } as RequestInit & { client: Deno.HttpClient });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, reason: typeof body.reason === "string" ? body.reason : null };
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
