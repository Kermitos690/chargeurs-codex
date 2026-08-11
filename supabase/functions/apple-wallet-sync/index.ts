import { adminClient, auditLog } from "../_shared/db.ts";
import {
  appleWalletConfigStatus,
  notifyRegisteredDevices,
  prepareWalletSnapshot,
} from "../_shared/appleWallet.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const config = appleWalletConfigStatus();
  if (!config.ready) return json({ ok: false, error: "APPLE_WALLET_NOT_CONFIGURED", missing: config.missing }, 503);

  const db = adminClient();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email_confirmed_at) return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const testTransport = body.testTransport === true;

  try {
    const snapshot = await prepareWalletSnapshot(db, user.id);
    const shouldNotify = snapshot.changed || testTransport;
    const notification = shouldNotify
      ? await notifyRegisteredDevices(db, snapshot.row.id)
      : { devices: 0, sent: 0, failed: 0 };

    if (shouldNotify) {
      const metadata = snapshot.row.provider_metadata && typeof snapshot.row.provider_metadata === "object"
        ? snapshot.row.provider_metadata
        : {};
      await db.from("customer_wallet_passes").update({
        provider_status: snapshot.row.provider_status === "issued" && snapshot.changed ? "update_pending" : snapshot.row.provider_status,
        provider_metadata: {
          ...metadata,
          last_notification_at: new Date().toISOString(),
          last_notification_mode: snapshot.changed ? "data_changed" : "transport_test",
          last_notification_result: notification,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", snapshot.row.id);
    }

    await auditLog(db, {
      actor: user.id,
      action: testTransport ? "wallet.apple_transport_tested" : "wallet.apple_synced",
      target: snapshot.row.id,
      data: {
        changed: snapshot.changed,
        revision: snapshot.row.pass_revision,
        devices: notification.devices,
        sent: notification.sent,
        failed: notification.failed,
      },
    });

    return json({
      ok: true,
      changed: snapshot.changed,
      revision: snapshot.row.pass_revision,
      notified: shouldNotify,
      notification,
      source: "real_backend_data",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "APPLE_WALLET_SYNC_FAILED";
    if (message === "ACTIVE_MEMBERSHIP_REQUIRED") return json({ ok: false, error: message }, 409);
    if (message === "WALLET_PASS_REVOKED") return json({ ok: false, error: message }, 410);
    console.error("apple-wallet-sync", message);
    return json({ ok: false, error: "APPLE_WALLET_SYNC_FAILED" }, 500);
  }
});
