import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import { normalizeKioskBaseUrl, randomOpaque, sha256Hex, validEnrollmentRequest } from "../_shared/kioskEnrollment.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function publicBaseUrl(): string | null {
  return normalizeKioskBaseUrl(Deno.env.get("KIOSK_PUBLIC_BASE_URL") ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const baseUrl = publicBaseUrl();
  if (!baseUrl) return json({ ok: false, error: "KIOSK_ENROLLMENT_NOT_CONFIGURED" }, 503);

  try {
    const body = await req.json().catch(() => ({}));
    const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim() : "";
    const devicePublicId = typeof body.devicePublicId === "string" ? body.devicePublicId.trim() : "";
    const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 64) : "";

    if (!validEnrollmentRequest(pairingCode, devicePublicId, appVersion)) {
      return json({ ok: false, error: "INVALID_ENROLLMENT_REQUEST" }, 400);
    }

    const kioskToken = randomOpaque("kt_", 32);
    const db = adminClient();
    const { data, error } = await db.rpc("redeem_kiosk_pairing_code", {
      p_code_hash: await sha256Hex(pairingCode),
      p_token_hash: await sha256Hex(kioskToken),
      p_device_public_id: devicePublicId,
      p_app_version: appVersion,
    });
    if (error) return json({ ok: false, error: "ENROLLMENT_UNAVAILABLE" }, 503);

    const result = data as { ok?: boolean; error?: string; station_id?: string; device_id?: string } | null;
    if (!result?.ok || !result.station_id || !result.device_id) {
      // Do not reveal whether a code existed, expired or was already consumed.
      return json({ ok: false, error: "PAIRING_CODE_INVALID_OR_EXPIRED" }, 401);
    }

    return json({
      ok: true,
      deviceId: result.device_id,
      stationId: result.station_id,
      kioskToken,
      baseUrl,
    });
  } catch {
    return json({ ok: false, error: "ENROLLMENT_UNAVAILABLE" }, 503);
  }
});
