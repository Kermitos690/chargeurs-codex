import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, getCaller } from "../_shared/db.ts";
import {
  buildSignedPass,
  getOrCreateWalletPass,
  resolveVisibleData,
  visibleDataHash,
} from "../_shared/appleWallet.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const caller = await getCaller(req, db);
  if (!caller.userId) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

  try {
    const authHeader = req.headers.get("Authorization")!;
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await db.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

    const passRow = await getOrCreateWalletPass(db, caller.userId);
    if (passRow.status !== "active") return json({ error: "WALLET_PASS_REVOKED" }, 410);

    const visible = await resolveVisibleData(db, caller.userId, authData.user.email ?? null);
    const nextHash = await visibleDataHash(visible);
    if (passRow.visible_data_hash && passRow.visible_data_hash !== nextHash) {
      await db.rpc("touch_wallet_pass", {
        p_pass_id: passRow.id,
        p_reason: "visible_data_changed_on_download",
        p_visible_data_hash: nextHash,
      });
      passRow.pass_version += 1;
      passRow.visible_data_hash = nextHash;
    }

    const bytes = await buildSignedPass(passRow, visible);
    await db.from("wallet_passes").update({
      visible_data_hash: nextHash,
      last_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", passRow.id);
    await db.from("wallet_pass_events").insert({
      wallet_pass_id: passRow.id,
      event_type: "pass_generated",
      new_version: passRow.pass_version,
      reason: "owner_download",
      result: "success",
    });
    await auditLog(db, {
      actor: caller.userId,
      action: "wallet.pass.download",
      target: passRow.id,
      data: { serial: passRow.serial_number, version: passRow.pass_version },
    });

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="Chargeurs-${visible.memberNumber}.pkpass"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await auditLog(db, { actor: caller.userId, action: "wallet.pass.download_failed", data: { error: message.split(":")[0] } });
    if (message.startsWith("WALLET_CONFIG_MISSING") || message.includes("CERTIFICATE")) {
      return json({ error: "APPLE_WALLET_NOT_CONFIGURED", detail: message.split(":")[1] ?? "certificate" }, 503);
    }
    return json({ error: "WALLET_PASS_GENERATION_FAILED" }, 500);
  }
});
