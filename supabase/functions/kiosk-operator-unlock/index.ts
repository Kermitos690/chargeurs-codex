import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import { sha256Hex } from "../_shared/kioskEnrollment.ts";

const PIN = /^\d{6}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VerifyResult = { ok?: boolean; error?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sourceHash(req: Request, devicePublicId: string): Promise<string | null> {
  const salt = Deno.env.get("KIOSK_ENROLLMENT_RATE_LIMIT_SALT")
    ?? Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!salt || salt.length < 32) return null;
  const forwarded = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? `device:${devicePublicId}`;
  return sha256Hex(`${salt}:${forwarded}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    const devicePublicId = typeof body.devicePublicId === "string" ? body.devicePublicId.trim() : "";
    const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 64) : "";

    if (!PIN.test(pin) || !UUID_V4.test(devicePublicId) || !appVersion) {
      return json({ ok: false, error: "INVALID_OPERATOR_REQUEST" }, 400);
    }

    const hashedSource = await sourceHash(req, devicePublicId);
    if (!hashedSource) return json({ ok: false, error: "OPERATOR_ACCESS_NOT_CONFIGURED" }, 503);

    const db = adminClient();
    const { data, error } = await db.rpc("verify_kiosk_operator_pin", {
      p_pin: pin,
      p_source_hash: hashedSource,
      p_device_public_id: devicePublicId,
    });
    if (error) {
      console.error("kiosk operator unlock unavailable", error.code ?? "RPC_ERROR");
      return json({ ok: false, error: "OPERATOR_ACCESS_UNAVAILABLE" }, 503);
    }

    const result = data as VerifyResult | null;
    if (!result?.ok) {
      if (result?.error === "TOO_MANY_OPERATOR_ATTEMPTS") {
        return json({ ok: false, error: "TOO_MANY_OPERATOR_ATTEMPTS" }, 429);
      }
      return json({ ok: false, error: "INVALID_OPERATOR_PIN" }, 401);
    }

    // This event records only the non-secret device identity and app version.
    // A successful PIN verification deliberately creates no session, role,
    // bearer credential or backend capability.
    await db.from("audit_logs").insert({
      action: "kiosk.operator.unlocked",
      target: devicePublicId,
      data: { app_version: appVersion },
    }).then(() => {}, () => {});

    return json({ ok: true });
  } catch (error) {
    console.error("kiosk operator unlock unavailable", error instanceof Error ? error.name : "UNKNOWN_ERROR");
    return json({ ok: false, error: "OPERATOR_ACCESS_UNAVAILABLE" }, 503);
  }
});
