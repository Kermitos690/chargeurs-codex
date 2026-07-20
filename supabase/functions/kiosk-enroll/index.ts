import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import { normalizeKioskBaseUrl, randomOpaque, sha256Hex, validEnrollmentRequest } from "../_shared/kioskEnrollment.ts";

const STAGING_SUPABASE_ORIGIN = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const STAGING_KIOSK_ORIGIN = "https://chargeurs-ch-staging.vercel.app";

type EnrollmentResult = {
  ok?: boolean;
  error?: string;
  station_id?: string;
  device_id?: string;
  recovered?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function publicBaseUrl(): string | null {
  // This project is the dedicated staging backend. Pin its kiosk origin so an
  // outdated/mistyped secret cannot consume a pairing code and then make the
  // APK reject the returned configuration with KIOSK_ORIGIN_MISMATCH.
  const projectOrigin = normalizeKioskBaseUrl(Deno.env.get("SUPABASE_URL") ?? "");
  if (projectOrigin === STAGING_SUPABASE_ORIGIN) return STAGING_KIOSK_ORIGIN;
  return normalizeKioskBaseUrl(Deno.env.get("KIOSK_PUBLIC_BASE_URL") ?? "");
}

async function recoverInterruptedEnrollment(
  db: ReturnType<typeof adminClient>,
  params: {
    codeHash: string;
    tokenHash: string;
    devicePublicId: string;
    appVersion: string;
  },
): Promise<EnrollmentResult> {
  const now = new Date().toISOString();
  const { data: pairing, error: pairingError } = await db
    .from("kiosk_pairing_codes")
    .select("id,station_id,organization_id,label,used_at,expires_at")
    .eq("code_hash", params.codeHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (pairingError) return { ok: false, error: "ENROLLMENT_UNAVAILABLE" };
  if (!pairing) return { ok: false, error: "INVALID_OR_EXPIRED_PAIRING_CODE" };
  if (!pairing.organization_id) return { ok: false, error: "PAIRING_ORGANIZATION_MISSING" };

  const { data: device, error: deviceError } = await db
    .from("kiosk_devices")
    .select("id,station_id,organization_id")
    .eq("device_public_id", params.devicePublicId)
    .maybeSingle();

  if (deviceError || !device) return { ok: false, error: "ENROLLMENT_UNAVAILABLE" };
  if (device.station_id !== pairing.station_id || device.organization_id !== pairing.organization_id) {
    return { ok: false, error: "DEVICE_BOUND_TO_ANOTHER_STATION" };
  }

  // Claim the fresh pairing code before rotating the token. The conditional
  // update prevents two concurrent requests from consuming the same code.
  const { data: claimed, error: claimError } = await db
    .from("kiosk_pairing_codes")
    .update({ used_at: now, used_by_device_id: device.id })
    .eq("id", pairing.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) return { ok: false, error: "ENROLLMENT_UNAVAILABLE" };
  if (!claimed) return { ok: false, error: "PAIRING_CODE_ALREADY_USED" };

  const { data: updated, error: updateError } = await db
    .from("kiosk_devices")
    .update({
      token_hash: params.tokenHash,
      active: true,
      token_revoked: false,
      token_expires_at: null,
      token_rotated_at: now,
      app_version: params.appVersion,
      revoked_at: null,
      label: pairing.label ?? undefined,
    })
    .eq("id", device.id)
    .eq("station_id", pairing.station_id)
    .select("id,station_id")
    .maybeSingle();

  if (updateError || !updated) return { ok: false, error: "ENROLLMENT_UNAVAILABLE" };

  // Best-effort audit only; never log the pairing code or kiosk token.
  await db.from("audit_logs").insert({
    action: "kiosk.enrollment.recovered",
    target: updated.id,
    data: {
      station_id: updated.station_id,
      device_public_id: params.devicePublicId,
      app_version: params.appVersion,
    },
  }).then(() => {}, () => {});

  return {
    ok: true,
    device_id: updated.id,
    station_id: updated.station_id,
    recovered: true,
  };
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
    const codeHash = await sha256Hex(pairingCode);
    const tokenHash = await sha256Hex(kioskToken);
    const db = adminClient();
    const { data, error } = await db.rpc("redeem_kiosk_pairing_code", {
      p_code_hash: codeHash,
      p_token_hash: tokenHash,
      p_device_public_id: devicePublicId,
      p_app_version: appVersion,
    });
    if (error) {
      console.error("kiosk enrollment RPC unavailable", error.code ?? "RPC_ERROR");
      return json({ ok: false, error: "ENROLLMENT_UNAVAILABLE" }, 503);
    }

    let result = data as EnrollmentResult | null;
    if (result?.error === "DEVICE_ALREADY_ENROLLED") {
      result = await recoverInterruptedEnrollment(db, {
        codeHash,
        tokenHash,
        devicePublicId,
        appVersion,
      });
    }

    if (!result?.ok || !result.station_id || !result.device_id) {
      if (result?.error === "DEVICE_BOUND_TO_ANOTHER_STATION") {
        return json({ ok: false, error: "DEVICE_BOUND_TO_ANOTHER_STATION" }, 409);
      }
      if (result?.error === "PAIRING_ORGANIZATION_MISSING") {
        return json({ ok: false, error: "PAIRING_CONFIGURATION_INVALID" }, 503);
      }
      if (result?.error === "ENROLLMENT_UNAVAILABLE") {
        return json({ ok: false, error: "ENROLLMENT_UNAVAILABLE" }, 503);
      }
      // Keep invalid, expired and already consumed pairing codes indistinguishable.
      return json({ ok: false, error: "PAIRING_CODE_INVALID_OR_EXPIRED" }, 401);
    }

    return json({
      ok: true,
      deviceId: result.device_id,
      stationId: result.station_id,
      kioskToken,
      baseUrl,
      recovered: result.recovered === true,
    });
  } catch (error) {
    console.error("kiosk enrollment unavailable", error instanceof Error ? error.name : "UNKNOWN_ERROR");
    return json({ ok: false, error: "ENROLLMENT_UNAVAILABLE" }, 503);
  }
});
