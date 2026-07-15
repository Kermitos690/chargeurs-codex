import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, requireAdmin, requireSuperAdmin, sha256Hex } from "../_shared/db.ts";
import { encryptToken } from "../_shared/appleWallet.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function randomQrToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `wq_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function walletEncryptionKey(): string {
  const key = Deno.env.get("WALLET_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!key) throw new Error("WALLET_TOKEN_ENCRYPTION_KEY_MISSING");
  return key;
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
    const names = [
      "APPLE_PASS_TYPE_IDENTIFIER", "APPLE_TEAM_IDENTIFIER", "APPLE_PASS_WEB_SERVICE_URL",
      "APPLE_PASS_SIGNER_CERTIFICATE_BASE64", "APPLE_PASS_SIGNER_KEY_BASE64",
      "APPLE_WWDR_CERTIFICATE_BASE64", "WALLET_TOKEN_ENCRYPTION_KEY", "PUBLIC_APP_URL",
    ];
    return json({ ok: true, configured: Object.fromEntries(names.map((name) => [name, Boolean(Deno.env.get(name))])) });
  }

  if (action === "list") {
    const query = typeof body.query === "string" ? body.query.trim().toLowerCase() : "";
    const passesResult = await db.from("wallet_passes")
      .select("id,user_id,serial_number,status,pass_version,last_generated_at,last_updated_at,revoked_at")
      .order("last_updated_at", { ascending: false }).limit(100);
    if (passesResult.error) return json({ error: passesResult.error.message }, 400);

    const passes = passesResult.data ?? [];
    const userIds = [...new Set(passes.map((pass) => pass.user_id))];
    const profilesResult = userIds.length
      ? await db.from("profiles").select("id,member_number,display_name,email,account_status").in("id", userIds)
      : { data: [], error: null };
    if (profilesResult.error) return json({ error: profilesResult.error.message }, 400);
    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));

    const merged = passes.map((pass) => ({ ...pass, profile: profiles.get(pass.user_id) ?? null }));
    const filtered = query
      ? merged.filter((pass) => {
          const profile = pass.profile as Record<string, unknown> | null;
          return [pass.serial_number, profile?.member_number, profile?.display_name, profile?.email]
            .some((value) => typeof value === "string" && value.toLowerCase().includes(query));
        })
      : merged;
    return json({ ok: true, passes: filtered });
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
    const now = new Date().toISOString();
    const update = await db.from("wallet_passes").update({ status: "revoked", revoked_at: now, updated_at: now, last_updated_at: now }).eq("id", passId);
    if (update.error) return json({ error: update.error.message }, 400);
    await db.from("wallet_pass_events").insert({ wallet_pass_id: passId, event_type: "pass_revoked", previous_version: passResult.data.pass_version, new_version: passResult.data.pass_version, reason: "admin_revoke", result: "success" });
    await auditLog(db, { actor: superId, action: "wallet.pass.revoke", target: passId });
    return json({ ok: true });
  }

  if (action === "rotate_qr") {
    const superId = await requireSuperAdmin(req, db);
    if (!superId) return json({ error: "SUPER_ADMIN_REQUIRED" }, 403);
    const token = randomQrToken();
    const now = new Date().toISOString();
    const nextVersion = passResult.data.pass_version + 1;
    const update = await db.from("wallet_passes").update({
      qr_token_hash: await sha256Hex(token),
      qr_token_ciphertext: await encryptToken(token, walletEncryptionKey()),
      qr_token_last_four: token.slice(-4),
      status: "active",
      revoked_at: null,
      pass_version: nextVersion,
      last_updated_at: now,
      updated_at: now,
    }).eq("id", passId);
    if (update.error) return json({ error: update.error.message }, 400);
    await db.from("wallet_pass_events").insert({ wallet_pass_id: passId, event_type: "qr_rotated", previous_version: passResult.data.pass_version, new_version: nextVersion, reason: "admin_rotate_qr", result: "success" });
    await auditLog(db, { actor: superId, action: "wallet.pass.rotate_qr", target: passId });
    return json({ ok: true, version: nextVersion });
  }

  return json({ error: "UNKNOWN_ACTION" }, 400);
});
