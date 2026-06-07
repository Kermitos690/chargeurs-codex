// kiosk-admin — admin-gated provisioning of per-kiosk authentication tokens.
// Each physical kiosk tablet is bound to a station and receives an individual
// secret token. Only the SHA-256 hash is stored. The plaintext token is shown
// ONCE on creation/rotation. Supports provision, rotate, revoke, list.
// A token can be used only by the kiosk_quote() SQL function, strictly bound to
// the kiosk's station_id — preventing one kiosk from impersonating another.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireAdmin, auditLog } from "../_shared/db.ts";

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "kt_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const adminId = await requireAdmin(req, db);
  if (!adminId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const { action, deviceId, stationId, label, ttlDays } = await req.json();

    if (action === "list") {
      const { data } = await db.from("kiosk_devices")
        .select("id,station_id,label,active,token_revoked,token_expires_at,token_rotated_at,last_seen_at")
        .order("created_at", { ascending: false });
      return json({ ok: true, devices: data ?? [] });
    }

    if (action === "provision" || action === "rotate") {
      if (action === "provision" && !stationId) return json({ ok: false, error: "MISSING_STATION" }, 400);
      const token = newToken();
      const hash = await sha256Hex(token);
      const expires = ttlDays ? new Date(Date.now() + Number(ttlDays) * 86400000).toISOString() : null;

      let row;
      if (action === "provision") {
        const { data, error } = await db.from("kiosk_devices").insert({
          station_id: stationId, label: label ?? null, token_hash: hash,
          active: true, token_revoked: false, token_expires_at: expires,
          token_rotated_at: new Date().toISOString(),
        }).select().single();
        if (error) throw error;
        row = data;
      } else {
        if (!deviceId) return json({ ok: false, error: "MISSING_DEVICE" }, 400);
        const { data, error } = await db.from("kiosk_devices").update({
          token_hash: hash, token_revoked: false, token_expires_at: expires,
          token_rotated_at: new Date().toISOString(), active: true,
        }).eq("id", deviceId).select().single();
        if (error) throw error;
        row = data;
      }
      await auditLog(db, {
        actor: adminId, action: `kiosk.token.${action}`, target: row.id,
        data: { station_id: row.station_id, expires },
      });
      // Plaintext token returned exactly once.
      return json({ ok: true, device: { id: row.id, station_id: row.station_id }, token });
    }

    if (action === "revoke") {
      if (!deviceId) return json({ ok: false, error: "MISSING_DEVICE" }, 400);
      const { error } = await db.from("kiosk_devices")
        .update({ token_revoked: true, active: false }).eq("id", deviceId);
      if (error) throw error;
      await auditLog(db, { actor: adminId, action: "kiosk.token.revoke", target: deviceId });
      return json({ ok: true });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
