import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import {
  normalizeKioskBaseUrl,
  randomOpaque,
  sha256Hex,
  validEnrollmentRequest,
  validRequestedTestToken,
} from "../_shared/kioskEnrollment.ts";

const STAGING_SUPABASE_ORIGIN = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const STAGING_KIOSK_ORIGIN = "https://chargeurs-ch-staging.vercel.app";
const STATION_ID = /^[A-Za-z0-9_-]{4,32}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type EnrollmentResult = {
  ok?: boolean;
  error?: string;
  station_id?: string;
  device_id?: string;
  recovered?: boolean;
  token_expires_at?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function projectOrigin(): string | null {
  return normalizeKioskBaseUrl(Deno.env.get("SUPABASE_URL") ?? "");
}

function publicBaseUrl(): string | null {
  // The dedicated staging project is pinned to the staging kiosk frontend.
  // Other environments must provide their own explicit HTTPS origin.
  if (projectOrigin() === STAGING_SUPABASE_ORIGIN) return STAGING_KIOSK_ORIGIN;
  return normalizeKioskBaseUrl(Deno.env.get("KIOSK_PUBLIC_BASE_URL") ?? "");
}

function diagnosticSelfEnrollmentAllowed(
  stationId: string,
  devicePublicId: string,
  appVersion: string,
  requestedToken: string,
): boolean {
  const explicitFlag = (Deno.env.get("KIOSK_TEST_SELF_ENROLLMENT_ENABLED") ?? "true") === "true";
  return explicitFlag
    && projectOrigin() === STAGING_SUPABASE_ORIGIN
    && STATION_ID.test(stationId)
    && UUID_V4.test(devicePublicId)
    && appVersion.endsWith("-staging-diagnostic")
    && validRequestedTestToken(requestedToken);
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
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const devicePublicId = typeof body.devicePublicId === "string" ? body.devicePublicId.trim() : "";
    const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 64) : "";
    const requestedKioskToken = typeof body.requestedKioskToken === "string"
      ? body.requestedKioskToken.trim()
      : "";
    const testSelfEnroll = body.testSelfEnroll === true;
    const db = adminClient();

    if (testSelfEnroll) {
      if (!diagnosticSelfEnrollmentAllowed(
        stationId,
        devicePublicId,
        appVersion,
        requestedKioskToken,
      )) {
        return json({ ok: false, error: "TEST_SELF_ENROLLMENT_NOT_ALLOWED" }, 403);
      }

      const tokenHash = await sha256Hex(requestedKioskToken);
      const { data, error } = await db.rpc("self_enroll_staging_kiosk", {
        p_station_id: stationId,
        p_token_hash: tokenHash,
        p_device_public_id: devicePublicId,
        p_app_version: appVersion,
      });
      if (error) {
        console.error("test self enrollment RPC unavailable", error.code ?? "RPC_ERROR");
        return json({ ok: false, error: "TEST_ENROLLMENT_UNAVAILABLE" }, 503);
      }

      const result = data as EnrollmentResult | null;
      if (!result?.ok || !result.station_id || !result.device_id) {
        const code = result?.error ?? "TEST_ENROLLMENT_REJECTED";
        const status = code === "DEVICE_BOUND_TO_ANOTHER_STATION" ? 409
          : code === "TEST_STATION_NOT_ALLOWED" ? 404
          : 400;
        return json({ ok: false, error: code }, status);
      }

      return json({
        ok: true,
        deviceId: result.device_id,
        stationId: result.station_id,
        kioskToken: requestedKioskToken,
        baseUrl,
        tokenExpiresAt: result.token_expires_at ?? null,
        testSelfEnrolled: true,
      });
    }

    // Normal/release enrollment remains unchanged and requires a one-time code.
    if (!validEnrollmentRequest(pairingCode, devicePublicId, appVersion)) {
      return json({ ok: false, error: "INVALID_ENROLLMENT_REQUEST" }, 400);
    }

    const kioskToken = randomOpaque("kt_", 32);
    const codeHash = await sha256Hex(pairingCode);
    const tokenHash = await sha256Hex(kioskToken);
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
