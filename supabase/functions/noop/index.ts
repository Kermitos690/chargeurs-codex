import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
import {
  PassStudioError,
  requirePassStudioApiKey,
  resolvePassStudioPass,
  updatePassStudioInstance,
} from "../_shared/passStudio.ts";
import { guestPresentationFields, resolveExpressPass } from "../_shared/guestWallet.ts";

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }

async function secret(db: ReturnType<typeof admin>, name: string) {
  const { data, error } = await db.rpc("internal_transactional_email_secret", { p_name: name });
  if (error) throw new Error(`DISPATCH_SECRET_${name.toUpperCase()}_UNAVAILABLE`);
  return String(data ?? "");
}

function webPushErrorCode(error: unknown) {
  if (error && typeof error === "object" && "statusCode" in error) {
    return Number((error as { statusCode?: unknown }).statusCode ?? 0);
  }
  return 0;
}

function passStudioFailure(error: unknown) {
  if (error instanceof PassStudioError) return error.code;
  return error instanceof Error ? error.message.slice(0, 96) : "WALLET_SYNC_FAILED";
}

function presentationFields(value: unknown) {
  const presentation = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawFields = presentation.fields;
  const fields = rawFields && typeof rawFields === "object"
    ? rawFields as Record<string, string | number | boolean | null>
    : {};
  if (!("points" in fields) || !("tier" in fields)) throw new Error("WALLET_PRESENTATION_INVALID");
  return fields;
}

async function processPushOutbox(db: ReturnType<typeof admin>) {
  const vapidPublic = await secret(db, "customer_push_vapid_public");
  const vapidPrivate = await secret(db, "customer_push_vapid_private");
  const vapidSubject = await secret(db, "customer_push_vapid_subject");
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    return { configured: false, processed: 0, sent: 0, failed: 0, skipped: 0, reason: "VAPID_NOT_CONFIGURED" };
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const now = new Date().toISOString();
  const { data: rows, error } = await db.from("notifications")
    .select("id,user_id,type,title,body,data,attempts")
    .eq("channel", "push").eq("status", "pending").lte("next_attempt_at", now)
    .order("created_at", { ascending: true }).limit(20);
  if (error) throw new Error("PUSH_OUTBOX_READ_FAILED");

  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows ?? []) {
    const attempt = Number(row.attempts ?? 0) + 1;
    const { data: claimed } = await db.from("notifications")
      .update({ status: "sending", attempts: attempt, last_error: null })
      .eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) continue;

    const { data: subscriptions } = await db.from("customer_push_subscriptions")
      .select("id,endpoint,p256dh,auth_secret,failure_count")
      .eq("user_id", row.user_id).eq("enabled", true).is("revoked_at", null);
    if (!subscriptions?.length) {
      await db.from("notifications").update({
        status: "failed", failed_at: new Date().toISOString(), last_error: "NO_ACTIVE_PUSH_SUBSCRIPTION",
      }).eq("id", row.id);
      skipped += 1;
      continue;
    }

    let delivered = 0;
    let transientFailures = 0;
    for (const sub of subscriptions) {
      try {
        const payload = JSON.stringify({
          title: row.title,
          body: row.body ?? "",
          type: row.type,
          url: String(row.data?.url ?? "/compte"),
          tag: String(row.data?.tag ?? row.type ?? "chargeurs-plus"),
          data: row.data ?? {},
        });
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
          payload,
          { TTL: 60 * 60, urgency: row.type === "rental_issue" ? "high" : "normal" },
        );
        await db.from("customer_push_subscriptions").update({
          last_success_at: new Date().toISOString(), last_failure_at: null,
          failure_count: 0, last_seen_at: new Date().toISOString(),
        }).eq("id", sub.id);
        delivered += 1;
      } catch (sendError) {
        const status = webPushErrorCode(sendError);
        const message = sendError instanceof Error ? sendError.message : "PUSH_SEND_FAILED";
        if (status === 404 || status === 410) {
          await db.from("customer_push_subscriptions").update({
            enabled: false, revoked_at: new Date().toISOString(), last_failure_at: new Date().toISOString(),
            failure_count: Number(sub.failure_count ?? 0) + 1, updated_at: new Date().toISOString(),
          }).eq("id", sub.id);
        } else {
          transientFailures += 1;
          await db.from("customer_push_subscriptions").update({
            last_failure_at: new Date().toISOString(), failure_count: Number(sub.failure_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          }).eq("id", sub.id);
        }
        console.error("customer push send failed", {
          notificationId: row.id, subscriptionId: sub.id, status, message: message.slice(0, 160),
        });
      }
    }

    if (delivered > 0) {
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
      sent += 1;
    } else if (transientFailures > 0 && attempt < 5) {
      const delayMinutes = Math.min(30, 2 ** attempt);
      await db.from("notifications").update({
        status: "pending",
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        last_error: "PUSH_TRANSIENT_FAILURE",
      }).eq("id", row.id);
      failed += 1;
    } else {
      await db.from("notifications").update({
        status: "failed", failed_at: new Date().toISOString(), last_error: "PUSH_DELIVERY_FAILED",
      }).eq("id", row.id);
      failed += 1;
    }
  }
  return { configured: true, processed: (rows ?? []).length, sent, failed, skipped };
}

async function processWalletOutbox(db: ReturnType<typeof admin>) {
  const now = new Date();
  const { data: dueRows, error } = await db.from("customer_wallet_sync_outbox")
    .select("id,user_id,attempts,expires_at")
    .eq("status", "pending").lte("next_attempt_at", now.toISOString())
    .order("created_at", { ascending: true }).limit(60);
  if (error) throw new Error("WALLET_OUTBOX_READ_FAILED");
  const rows = dueRows ?? [];
  if (rows.length === 0) return { processed: 0, users: 0, delivered: 0, retried: 0, failed: 0, expired: 0 };

  const apiKey = requirePassStudioApiKey();
  const providerPass = await resolvePassStudioPass(apiKey);
  const userIds = [...new Set(rows.map((row) => String(row.user_id)))];
  let delivered = 0, retried = 0, failed = 0, expired = 0;

  for (const userId of userIds) {
    const candidates = rows.filter((row) => String(row.user_id) === userId);
    const expiredIds = candidates.filter((row) => row.expires_at && new Date(String(row.expires_at)).getTime() <= now.getTime()).map((row) => String(row.id));
    if (expiredIds.length) {
      await db.from("customer_wallet_sync_outbox").update({ status: "expired", last_error_code: "EVENT_EXPIRED", updated_at: new Date().toISOString() }).in("id", expiredIds).eq("status", "pending");
      expired += expiredIds.length;
    }
    const live = candidates.filter((row) => !expiredIds.includes(String(row.id)));
    if (!live.length) continue;
    const nextAttempt = Math.max(...live.map((row) => Number(row.attempts ?? 0))) + 1;
    const ids = live.map((row) => String(row.id));
    const { data: claimed } = await db.from("customer_wallet_sync_outbox").update({ status: "processing", attempts: nextAttempt, last_error_code: null, updated_at: new Date().toISOString() }).in("id", ids).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    const claimedIds = claimed.map((row) => String(row.id));

    try {
      const [{ data: wallet, error: walletError }, { data: presentation, error: presentationError }] = await Promise.all([
        db.from("customer_wallet_passes").select("id,provider_instance_id,pass_revision").eq("user_id", userId).eq("status", "active").eq("provider", "pass_studio").not("provider_instance_id", "is", null).is("revoked_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        db.rpc("customer_wallet_presentation_state", { p_user_id: userId }),
      ]);
      if (walletError || presentationError) throw new Error("WALLET_SOURCE_STATE_UNAVAILABLE");
      if (!wallet?.provider_instance_id) {
        await db.from("customer_wallet_sync_outbox").update({ status: "expired", last_error_code: "WALLET_INSTANCE_NOT_AVAILABLE", updated_at: new Date().toISOString() }).in("id", claimedIds);
        expired += claimedIds.length;
        continue;
      }
      const fields = presentationFields(presentation);
      await updatePassStudioInstance(apiKey, providerPass, String(wallet.provider_instance_id), fields);
      const syncedAt = new Date().toISOString();
      await db.from("customer_wallet_passes").update({ provider_status: "issued", provider_last_error_code: null, last_synced_at: syncedAt, pass_revision: Number(wallet.pass_revision ?? 0) + 1, updated_at: syncedAt }).eq("id", String(wallet.id));
      await db.from("customer_wallet_sync_outbox").update({ status: "delivered", delivered_at: syncedAt, last_error_code: null, updated_at: syncedAt }).in("id", claimedIds);
      delivered += claimedIds.length;
    } catch (syncError) {
      const code = passStudioFailure(syncError);
      if (nextAttempt < 5) {
        const retryAt = new Date(Date.now() + Math.min(300, 15 * 2 ** (nextAttempt - 1)) * 1000).toISOString();
        await db.from("customer_wallet_sync_outbox").update({ status: "pending", next_attempt_at: retryAt, last_error_code: code, updated_at: new Date().toISOString() }).in("id", claimedIds);
        await db.from("customer_wallet_passes").update({ provider_status: "update_pending", updated_at: new Date().toISOString() }).eq("user_id", userId).eq("provider", "pass_studio").eq("status", "active");
        retried += claimedIds.length;
      } else {
        await db.from("customer_wallet_sync_outbox").update({ status: "failed", last_error_code: code, updated_at: new Date().toISOString() }).in("id", claimedIds);
        await db.from("customer_wallet_passes").update({ provider_status: "error", provider_last_error_code: code, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("provider", "pass_studio").eq("status", "active");
        failed += claimedIds.length;
      }
      console.error("wallet realtime sync failed", { code, attempt: nextAttempt });
    }
  }
  return { processed: rows.length, users: userIds.length, delivered, retried, failed, expired };
}

async function processNativeWalletNotifications(db: ReturnType<typeof admin>) {
  const now = new Date();
  const { data: dueRows, error } = await db.from("customer_wallet_native_notifications").select("id,user_id,message,attempts,expires_at").eq("status", "pending").lte("next_attempt_at", now.toISOString()).order("created_at", { ascending: true }).limit(20);
  if (error) throw new Error("WALLET_NATIVE_OUTBOX_READ_FAILED");
  const rows = dueRows ?? [];
  if (!rows.length) return { processed: 0, delivered: 0, retried: 0, failed: 0, expired: 0 };

  const apiKey = requirePassStudioApiKey();
  const providerPass = await resolvePassStudioPass(apiKey);
  let delivered = 0, retried = 0, failed = 0, expired = 0;
  for (const row of rows) {
    const expiresAt = row.expires_at ? new Date(String(row.expires_at)) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      await db.from("customer_wallet_native_notifications").update({ status: "expired", last_error_code: "EVENT_EXPIRED", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending");
      expired += 1;
      continue;
    }
    const attempt = Number(row.attempts ?? 0) + 1;
    const { data: claimed } = await db.from("customer_wallet_native_notifications").update({ status: "processing", attempts: attempt, last_error_code: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) continue;
    try {
      const [{ data: wallet, error: walletError }, { data: presentation, error: presentationError }] = await Promise.all([
        db.from("customer_wallet_passes").select("id,provider_instance_id,pass_revision").eq("user_id", row.user_id).eq("status", "active").eq("provider", "pass_studio").not("provider_instance_id", "is", null).is("revoked_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        db.rpc("customer_wallet_presentation_state", { p_user_id: row.user_id }),
      ]);
      if (walletError || presentationError) throw new Error("WALLET_SOURCE_STATE_UNAVAILABLE");
      if (!wallet?.provider_instance_id) {
        await db.from("customer_wallet_native_notifications").update({ status: "expired", last_error_code: "WALLET_INSTANCE_NOT_AVAILABLE", updated_at: new Date().toISOString() }).eq("id", row.id);
        expired += 1;
        continue;
      }
      const fields = presentationFields(presentation);
      const providerResult = await updatePassStudioInstance(apiKey, providerPass, String(wallet.provider_instance_id), fields, String(row.message));
      const deliveredAt = new Date().toISOString();
      await db.from("customer_wallet_passes").update({ provider_status: "issued", provider_last_error_code: null, last_synced_at: deliveredAt, pass_revision: Number(wallet.pass_revision ?? 0) + 1, updated_at: deliveredAt }).eq("id", String(wallet.id));
      await db.from("customer_wallet_native_notifications").update({ status: "delivered", delivered_at: deliveredAt, last_error_code: null, metadata: { providerPushed: Boolean(providerResult?.pushed), warnings: providerResult?.warnings ?? [] }, updated_at: deliveredAt }).eq("id", row.id);
      delivered += 1;
    } catch (notifyError) {
      const code = passStudioFailure(notifyError);
      if (attempt < 5 && (!expiresAt || expiresAt.getTime() > Date.now())) {
        const retryAt = new Date(Date.now() + Math.min(300, 15 * 2 ** (attempt - 1)) * 1000).toISOString();
        await db.from("customer_wallet_native_notifications").update({ status: "pending", next_attempt_at: retryAt, last_error_code: code, updated_at: new Date().toISOString() }).eq("id", row.id);
        retried += 1;
      } else {
        await db.from("customer_wallet_native_notifications").update({ status: "failed", last_error_code: code, updated_at: new Date().toISOString() }).eq("id", row.id);
        failed += 1;
      }
      console.error("wallet native notification failed", { code, attempt });
    }
  }
  return { processed: rows.length, delivered, retried, failed, expired };
}

async function processGuestWalletOutbox(db: ReturnType<typeof admin>) {
  const now = new Date();
  const { data: rows, error } = await db.from("guest_wallet_outbox")
    .select("id,guest_wallet_pass_id,rental_id,message,attempts,expires_at")
    .eq("status", "pending").lte("next_attempt_at", now.toISOString())
    .order("created_at", { ascending: true }).limit(30);
  if (error) throw new Error("GUEST_WALLET_OUTBOX_READ_FAILED");
  if (!rows?.length) return { processed: 0, delivered: 0, retried: 0, failed: 0, expired: 0 };

  const apiKey = requirePassStudioApiKey();
  const providerPass = await resolveExpressPass(apiKey);
  let delivered = 0, retried = 0, failed = 0, expired = 0;

  for (const row of rows) {
    const expiresAt = row.expires_at ? new Date(String(row.expires_at)) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      await db.from("guest_wallet_outbox").update({ status: "expired", last_error_code: "EVENT_EXPIRED", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending");
      expired += 1;
      continue;
    }
    const attempt = Number(row.attempts ?? 0) + 1;
    const { data: claimed } = await db.from("guest_wallet_outbox").update({ status: "processing", attempts: attempt, last_error_code: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) continue;

    try {
      const [{ data: wallet, error: walletError }, { data: presentation, error: presentationError }] = await Promise.all([
        db.from("guest_wallet_passes").select("id,provider_instance_id,pass_revision").eq("id", row.guest_wallet_pass_id).eq("status", "active").eq("provider", "pass_studio").not("provider_instance_id", "is", null).is("revoked_at", null).maybeSingle(),
        db.rpc("guest_wallet_presentation_state", { p_rental_id: row.rental_id }),
      ]);
      if (walletError || presentationError) throw new Error("GUEST_WALLET_SOURCE_STATE_UNAVAILABLE");
      if (!wallet?.provider_instance_id) {
        await db.from("guest_wallet_outbox").update({ status: "expired", last_error_code: "GUEST_WALLET_INSTANCE_NOT_AVAILABLE", updated_at: new Date().toISOString() }).eq("id", row.id);
        expired += 1;
        continue;
      }

      const fields = guestPresentationFields(providerPass, presentation);
      const providerResult = await updatePassStudioInstance(
        apiKey,
        providerPass,
        String(wallet.provider_instance_id),
        fields,
        row.message ? String(row.message) : null,
      );
      const deliveredAt = new Date().toISOString();
      await db.from("guest_wallet_passes").update({
        provider_status: "issued", provider_last_error_code: null, current_rental_id: row.rental_id,
        last_synced_at: deliveredAt, pass_revision: Number(wallet.pass_revision ?? 0) + 1, updated_at: deliveredAt,
      }).eq("id", String(wallet.id));
      await db.from("guest_wallet_outbox").update({
        status: "delivered", delivered_at: deliveredAt, last_error_code: null,
        metadata: { providerPushed: Boolean(providerResult?.pushed), warnings: providerResult?.warnings ?? [] },
        updated_at: deliveredAt,
      }).eq("id", row.id);
      delivered += 1;
    } catch (guestError) {
      const code = passStudioFailure(guestError);
      if (attempt < 5 && (!expiresAt || expiresAt.getTime() > Date.now())) {
        const retryAt = new Date(Date.now() + Math.min(300, 15 * 2 ** (attempt - 1)) * 1000).toISOString();
        await db.from("guest_wallet_outbox").update({ status: "pending", next_attempt_at: retryAt, last_error_code: code, updated_at: new Date().toISOString() }).eq("id", row.id);
        await db.from("guest_wallet_passes").update({ provider_status: "update_pending", provider_last_error_code: code, updated_at: new Date().toISOString() }).eq("id", row.guest_wallet_pass_id);
        retried += 1;
      } else {
        await db.from("guest_wallet_outbox").update({ status: "failed", last_error_code: code, updated_at: new Date().toISOString() }).eq("id", row.id);
        await db.from("guest_wallet_passes").update({ provider_status: "error", provider_last_error_code: code, updated_at: new Date().toISOString() }).eq("id", row.guest_wallet_pass_id);
        failed += 1;
      }
      console.error("guest wallet dispatch failed", { code, attempt });
    }
  }
  return { processed: rows.length, delivered, retried, failed, expired };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = admin();
  const body = await req.json().catch(() => ({}));
  const expected = await secret(db, "customer_push_dispatch_key");
  if (!expected || String(body?.dispatchKey ?? "") !== expected) return json({ ok: false, error: "FORBIDDEN" }, 403);

  let push: Record<string, unknown>;
  let wallet: Record<string, unknown>;
  let nativeWallet: Record<string, unknown>;
  let guestWallet: Record<string, unknown>;
  try { push = await processPushOutbox(db); }
  catch (error) { const code = error instanceof Error ? error.message.slice(0, 96) : "PUSH_DISPATCH_FAILED"; console.error("push dispatch failed", { code }); push = { error: code }; }
  try { wallet = await processWalletOutbox(db); }
  catch (error) { const code = passStudioFailure(error); console.error("wallet dispatch failed", { code }); wallet = { error: code }; }
  try { nativeWallet = await processNativeWalletNotifications(db); }
  catch (error) { const code = passStudioFailure(error); console.error("wallet native dispatch failed", { code }); nativeWallet = { error: code }; }
  try { guestWallet = await processGuestWalletOutbox(db); }
  catch (error) { const code = passStudioFailure(error); console.error("guest wallet dispatch failed", { code }); guestWallet = { error: code }; }

  return json({ ok: true, push, wallet, nativeWallet, guestWallet });
});
