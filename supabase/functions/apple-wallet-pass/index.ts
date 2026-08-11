import { adminClient, auditLog } from "../_shared/db.ts";
import {
  appleWalletConfigStatus,
  buildSignedPass,
  prepareWalletSnapshot,
} from "../_shared/appleWallet.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "status") {
    const status = appleWalletConfigStatus();
    return json({ ok: true, configured: status.ready, missing: status.missing });
  }
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const config = appleWalletConfigStatus();
  if (!config.ready) {
    return json({ ok: false, error: "APPLE_WALLET_NOT_CONFIGURED", missing: config.missing }, 503);
  }

  const db = adminClient();
  const token = bearer(req);
  if (!token) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email_confirmed_at) return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);

  try {
    const snapshot = await prepareWalletSnapshot(db, user.id);
    const bytes = await buildSignedPass(snapshot.row, snapshot.data, snapshot.authenticationToken);
    const now = new Date().toISOString();
    await db.from("customer_wallet_passes").update({
      provider_status: "issued",
      last_generated_at: now,
      last_synced_at: now,
      updated_at: now,
    }).eq("id", snapshot.row.id);
    await auditLog(db, {
      actor: user.id,
      action: "wallet.apple_pass_issued",
      target: snapshot.row.id,
      data: { revision: snapshot.row.pass_revision, changed: snapshot.changed },
    });

    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="chargeurs-plus-${snapshot.data.passReference}.pkpass"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APPLE_WALLET_ISSUE_FAILED";
    if (message === "ACTIVE_MEMBERSHIP_REQUIRED") return json({ ok: false, error: message }, 409);
    if (message === "WALLET_PASS_REVOKED") return json({ ok: false, error: message }, 410);
    if (message.startsWith("APPLE_WALLET_CONFIG_MISSING") || message === "APPLE_WALLET_AUTH_SECRET_TOO_SHORT") {
      return json({ ok: false, error: "APPLE_WALLET_NOT_CONFIGURED" }, 503);
    }
    console.error("apple-wallet-pass", message);
    return json({ ok: false, error: "APPLE_WALLET_ISSUE_FAILED" }, 500);
  }
});
