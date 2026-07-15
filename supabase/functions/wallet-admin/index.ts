import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, requireAdmin, requireSuperAdmin, sha256Hex } from "../_shared/db.ts";
import { encryptToken, walletConfig } from "../_shared/appleWallet.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function randomQrToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `wq_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const db = adminClient();
  const adminId = await requireAdmin(req, db);
  if (!adminId) return json({ error: "ADMIN_REQUIRED" }, 403);
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "list";

  if (action === "config_status") {
    const names = ["APPLE_PASS_TYPE_IDENTIFIER","APPLE_TEAM_IDENTIFIER","APPLE_PASS_WEB_SERVICE_URL","APPLE_PASS_SIGNER_CERTIFICATE_BASE64","APPLE_PASS_SIGNER_KEY_BASE64","APPLE_WWDR_CERTIFICATE_BASE64","WALLET_TOKEN_ENCRYPTION_KEY"];
    return json({ ok: true, configured: Object.fromEntries(names.map((name) => [name, Boolean(Deno.env.get(name))])) });
  }

  if (action === "list") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    let request = db.from("wallet_passes").select("id,user_id,serial_number,status,pass_version,last_generated_at,last_updated_at,revoked_at,profiles!wallet_passes_user_id_fkey(member_number,display_name,full_name)")
      .order("last_updated_at", { ascending: false }).limit(100);
    if (query) request = request.or(`serial_number.ilike.%${query.replace(/[%_,]/g, "")}%,profiles.member_number.ilike.%${query.replace(/[%_,]/g, "")}%`);
    const result = await request;
    if (result.error) return json({ error: result.error.message }, 400);
    return json({ ok: true, passes: result.data ?? [] });
  }

  const passId = typeof body.passId === "string" ? body.passId : "";
  if (!passId) return json({ error: "PASS_ID_REQUIRED" }, 400);
  const passResult = await db.from("wallet_passes").select("id,user_id,status,pass_version").eq("id", passId).maybeSingle();
  if (!passResult.data) return json({ error: "PASS_NOT_FOUND" }, 404);

  if (action === "refresh") {
    const next = await db.rpc("touch_wallet_pass", { p_pass_id: passId, p_reason: "admin_refresh", p_visible_data_hash: null });
    if (next.error) return json({ error: next.error.message }, 400);
    await auditLog(db, { actor: adminId, action: "wallet.pass.refresh", target: passId });
    return json({ ok: true, version: next.data });
  }

  if (action === "revoke") {
    const superId = await requireSuperAdmin(req, db);
    if (!superId) return json({ error: "SUPER_ADMIN_REQUIRED" }, 403);
    await db.from("wallet_passes").update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", passId);
    await auditLog(db, { actor: superId, action: "wallet.pass.revoke", target: passId });
    return json({ ok: true });
  }

  if (action === "rotate_qr") {
    const superId = await requireSuperAdmin(req, db);
    if (!superId) return json({ error: "SUPER_ADMIN_REQUIRED" }, 403);
    const config = walletConfig();
    const token = randomQrToken();
    await db.from("wallet_passes").update({
      qr_token_hash: await sha256Hex(token),
      qr_token_ciphertext: await encryptToken(token, config.encryptionKey),
      qr_token_last_four: token.slice(-4),
      status: "active",
      revoked_at: null,
      pass_version: passResult.data.pass_version + 1,
      last_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", passId);
    await auditLog(db, { actor: superId, action: "wallet.pass.rotate_qr", target: passId });
    return json({ ok: true, version: passResult.data.pass_version + 1 });
  }

  return json({ error: "UNKNOWN_ACTION" }, 400);
});
