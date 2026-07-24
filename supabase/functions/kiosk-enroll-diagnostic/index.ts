import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import {
  normalizeKioskBaseUrl,
  sha256Hex,
  validRequestedTestToken,
} from "../_shared/kioskEnrollment.ts";

const STAGING_SUPABASE_ORIGIN = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const STAGING_KIOSK_ORIGIN = "https://chargeurs-ch-staging.vercel.app";
const PILOT_STATION_ID = "DTA21269";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function isPinnedStagingProject(): boolean {
  return normalizeKioskBaseUrl(Deno.env.get("SUPABASE_URL") ?? "") === STAGING_SUPABASE_ORIGIN;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!isPinnedStagingProject()) return json({ ok: false, error: "DIAGNOSTIC_PROJECT_MISMATCH" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const devicePublicId = typeof body.devicePublicId === "string" ? body.devicePublicId.trim() : "";
    const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 64) : "";
    const requestedKioskToken = typeof body.requestedKioskToken === "string"
      ? body.requestedKioskToken.trim()
      : "";

    if (body.testSelfEnroll !== true
      || stationId !== PILOT_STATION_ID
      || !UUID_V4.test(devicePublicId)
      || !appVersion.endsWith("-staging-diagnostic")
      || !validRequestedTestToken(requestedKioskToken)) {
      return json({ ok: false, error: "INVALID_DIAGNOSTIC_ENROLLMENT" }, 400);
    }

    const db = adminClient();
    const { data: station, error: stationError } = await db
      .from("stations")
      .select("station_id,organization_id,environment,is_pilot")
      .eq("station_id", stationId)
      .maybeSingle();

    if (stationError) {
      console.error("diagnostic station lookup failed", stationError.code ?? "UNKNOWN");
      return json({ ok: false, error: "DIAGNOSTIC_ENROLLMENT_UNAVAILABLE" }, 503);
    }
    if (!station || station.environment !== "staging" || station.is_pilot !== true) {
      return json({ ok: false, error: "TEST_STATION_NOT_ALLOWED" }, 404);
    }
    if (!station.organization_id) {
      return json({ ok: false, error: "TEST_STATION_ORGANIZATION_MISSING" }, 503);
    }

    const { data: existing, error: existingError } = await db
      .from("kiosk_devices")
      .select("id,station_id")
      .eq("device_public_id", devicePublicId)
      .maybeSingle();

    if (existingError) {
      console.error("diagnostic device lookup failed", existingError.code ?? "UNKNOWN");
      return json({ ok: false, error: "DIAGNOSTIC_ENROLLMENT_UNAVAILABLE" }, 503);
    }
    if (existing && existing.station_id !== stationId) {
      return json({ ok: false, error: "DEVICE_BOUND_TO_ANOTHER_STATION" }, 409);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const tokenHash = await sha256Hex(requestedKioskToken);

    await db
      .from("kiosk_devices")
      .update({ active: false, token_revoked: true, revoked_at: nowIso })
      .eq("station_id", stationId)
      .like("app_version", "%-staging-diagnostic")
      .neq("device_public_id", devicePublicId);

    const values = {
      station_id: stationId,
      organization_id: station.organization_id,
      label: `Diagnostic auto-enrollment ${stationId}`,
      token_hash: tokenHash,
      active: true,
      token_revoked: false,
      token_expires_at: expiresAt,
      token_rotated_at: nowIso,
      device_public_id: devicePublicId,
      app_version: appVersion,
      enrolled_at: nowIso,
      revoked_at: null,
    };

    const operation = existing
      ? db.from("kiosk_devices").update(values).eq("id", existing.id)
      : db.from("kiosk_devices").insert(values);

    const { data: device, error: saveError } = await operation
      .select("id,station_id,token_expires_at")
      .single();

    if (saveError || !device) {
      console.error("diagnostic device save failed", saveError?.code ?? "UNKNOWN");
      return json({ ok: false, error: "DIAGNOSTIC_ENROLLMENT_UNAVAILABLE" }, 503);
    }

    await db.from("audit_logs").insert({
      action: "kiosk.test_self_enrollment.direct",
      target: device.id,
      data: {
        station_id: stationId,
        organization_id: station.organization_id,
        device_public_id: devicePublicId,
        app_version: appVersion,
        expires_at: expiresAt,
        test_only: true,
      },
    }).then(() => undefined, () => undefined);

    return json({
      ok: true,
      deviceId: device.id,
      stationId: device.station_id,
      kioskToken: requestedKioskToken,
      baseUrl: STAGING_KIOSK_ORIGIN,
      tokenExpiresAt: device.token_expires_at,
      testSelfEnrolled: true,
      enrollmentMode: "direct-staging-pilot",
    });
  } catch (error) {
    console.error("diagnostic enrollment failed", error instanceof Error ? error.name : "UNKNOWN");
    return json({ ok: false, error: "DIAGNOSTIC_ENROLLMENT_UNAVAILABLE" }, 503);
  }
});
