import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400); }
  const stationId = String(body.stationId ?? "").trim();
  const token = String(req.headers.get("x-kiosk-token") ?? "").trim();
  if (!stationId || token.length < 24) return json({ ok: false, error: "KIOSK_AUTH_REQUIRED" }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const tokenHash = await sha256Hex(token);
  const { data: device, error: deviceError } = await db.from("kiosk_devices")
    .select("id, station_id, active, token_revoked, token_expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (deviceError || !device) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
  if (device.station_id !== stationId) return json({ ok: false, error: "KIOSK_STATION_MISMATCH" }, 403);
  const expired = device.token_expires_at && new Date(device.token_expires_at).getTime() < Date.now();
  if (!device.active || device.token_revoked || expired) return json({ ok: false, error: "KIOSK_DEVICE_DISABLED" }, 403);

  const [{ data: station }, { data: quarantine }] = await Promise.all([
    db.from("stations").select("station_id,status,online,rentable_count,returnable_count,total_count,last_sync_at").eq("station_id", stationId).maybeSingle(),
    db.from("station_hardware_quarantines").select("active,reason_code,created_at,source_rental_session_id").eq("station_id", stationId).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const blocked = Boolean(quarantine?.active);
  return json({
    ok: true,
    station: station ?? null,
    blocked,
    reason_code: blocked ? quarantine?.reason_code ?? "HARDWARE_QUARANTINE" : null,
    since: blocked ? quarantine?.created_at ?? null : null,
  });
});
