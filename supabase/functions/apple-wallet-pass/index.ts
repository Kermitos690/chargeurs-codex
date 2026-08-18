import { adminClient, auditLog } from "../_shared/db.ts";
import {
  appleWalletConfigStatus,
  buildSignedPass,
  prepareWalletSnapshot,
  type CustomerWalletPassRow,
} from "../_shared/appleWallet.ts";
import { createWalletDownloadToken, verifyWalletDownloadToken } from "../_shared/appleWalletDownload.ts";

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

async function sendPkpass(db: ReturnType<typeof adminClient>, row: CustomerWalletPassRow) {
  const snapshot = await prepareWalletSnapshot(db, row.user_id);
  if (snapshot.row.id !== row.id) throw new Error("WALLET_PASS_MISMATCH");
  const bytes = await buildSignedPass(snapshot.row, snapshot.data, snapshot.authenticationToken);
  const now = new Date();
  const metadata = snapshot.row.provider_metadata && typeof snapshot.row.provider_metadata === "object"
    ? snapshot.row.provider_metadata
    : {};
  const existingTag = typeof metadata.wallet_update_tag_ms === "number" && Number.isFinite(metadata.wallet_update_tag_ms)
    ? metadata.wallet_update_tag_ms
    : null;
  const firstIssue = snapshot.row.provider_status !== "issued" || existingTag === null;

  await db.from("customer_wallet_passes").update({
    provider_status: "issued",
    last_generated_at: now.toISOString(),
    last_synced_at: now.toISOString(),
    provider_metadata: {
      ...metadata,
      wallet_update_tag_ms: firstIssue ? now.getTime() : existingTag,
    },
    updated_at: now.toISOString(),
  }).eq("id", snapshot.row.id);

  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `inline; filename="chargeurs-plus-${snapshot.data.passReference}.pkpass"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "status") {
    const status = appleWalletConfigStatus();
    return json({ ok: true, configured: status.ready, missing: status.missing });
  }

  const config = appleWalletConfigStatus();
  if (!config.ready) return json({ ok: false, error: "APPLE_WALLET_NOT_CONFIGURED", missing: config.missing }, 503);
  const db = adminClient();

  // Short-lived, HMAC-signed download link. It contains only the already opaque
  // public pass reference plus an expiry; no account JWT or Apple auth token.
  if (req.method === "GET" && url.searchParams.has("download")) {
    const verified = await verifyWalletDownloadToken(url.searchParams.get("download") ?? "");
    if (!verified) return json({ ok: false, error: "DOWNLOAD_LINK_INVALID_OR_EXPIRED" }, 401);
    const result = await db.from("customer_wallet_passes")
      .select("id,user_id,membership_id,public_pass_id,apple_serial_number,status,token_version,access_token_hash,pass_revision,provider_status,last_generated_at,last_synced_at,revoked_at,provider_metadata")
      .eq("public_pass_id", verified.publicPassId)
      .eq("status", "active")
      .maybeSingle();
    if (result.error || !result.data) return json({ ok: false, error: "WALLET_PASS_NOT_FOUND" }, 404);
    try {
      return await sendPkpass(db, result.data as CustomerWalletPassRow);
    } catch (error) {
      console.error("apple-wallet-pass download", error instanceof Error ? error.message : "unknown");
      return json({ ok: false, error: "APPLE_WALLET_ISSUE_FAILED" }, 500);
    }
  }

  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const token = bearer(req);
  if (!token) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email_confirmed_at) return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);

  try {
    const snapshot = await prepareWalletSnapshot(db, user.id);
    const download = await createWalletDownloadToken(snapshot.row);
    const baseUrl = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/apple-wallet-pass`;
    await db.from("customer_wallet_passes").update({
      provider_status: snapshot.row.provider_status === "not_issued" ? "pending" : snapshot.row.provider_status,
      updated_at: new Date().toISOString(),
    }).eq("id", snapshot.row.id);
    await auditLog(db, {
      actor: user.id,
      action: "wallet.apple_download_link_created",
      target: snapshot.row.id,
      data: { revision: snapshot.row.pass_revision, expiresAt: download.expiresAt },
    });

    return json({
      ok: true,
      downloadUrl: `${baseUrl}?download=${encodeURIComponent(download.token)}`,
      expiresAt: download.expiresAt,
      source: "real_backend_data",
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
