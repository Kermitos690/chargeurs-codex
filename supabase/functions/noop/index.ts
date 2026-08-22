import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const headers = { "Content-Type": "application/json" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
async function secret(db: ReturnType<typeof admin>, name: string) {
  const { data, error } = await db.rpc("internal_transactional_email_secret", { p_name: name });
  if (error) throw new Error(`PUSH_SECRET_${name.toUpperCase()}_UNAVAILABLE`);
  return String(data ?? "");
}
function errorCode(error: unknown) {
  if (error && typeof error === "object" && "statusCode" in error) return Number((error as { statusCode?: unknown }).statusCode ?? 0);
  return 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = admin();
  const body = await req.json().catch(() => ({}));
  const expected = await secret(db, "customer_push_dispatch_key");
  if (!expected || String(body?.dispatchKey ?? "") !== expected) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const vapidPublic = await secret(db, "customer_push_vapid_public");
  const vapidPrivate = await secret(db, "customer_push_vapid_private");
  const vapidSubject = await secret(db, "customer_push_vapid_subject");
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return json({ ok: true, configured: false, reason: "VAPID_NOT_CONFIGURED" });
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const now = new Date().toISOString();
  const { data: rows, error } = await db.from("notifications")
    .select("id,user_id,type,title,body,data,attempts")
    .eq("channel", "push").eq("status", "pending").lte("next_attempt_at", now)
    .order("created_at", { ascending: true }).limit(20);
  if (error) return json({ ok: false, error: "PUSH_OUTBOX_READ_FAILED" }, 500);

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
      await db.from("notifications").update({ status: "failed", failed_at: new Date().toISOString(), last_error: "NO_ACTIVE_PUSH_SUBSCRIPTION" }).eq("id", row.id);
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
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } }, payload, { TTL: 60 * 60, urgency: row.type === "rental_issue" ? "high" : "normal" });
        await db.from("customer_push_subscriptions").update({ last_success_at: new Date().toISOString(), last_failure_at: null, failure_count: 0, last_seen_at: new Date().toISOString() }).eq("id", sub.id);
        delivered += 1;
      } catch (sendError) {
        const status = errorCode(sendError);
        const message = sendError instanceof Error ? sendError.message : "PUSH_SEND_FAILED";
        if (status === 404 || status === 410) {
          await db.from("customer_push_subscriptions").update({ enabled: false, revoked_at: new Date().toISOString(), last_failure_at: new Date().toISOString(), failure_count: Number(sub.failure_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", sub.id);
        } else {
          transientFailures += 1;
          await db.from("customer_push_subscriptions").update({ last_failure_at: new Date().toISOString(), failure_count: Number(sub.failure_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", sub.id);
        }
        console.error("customer push send failed", { notificationId: row.id, subscriptionId: sub.id, status, message: message.slice(0, 160) });
      }
    }

    if (delivered > 0) {
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
      sent += 1;
    } else if (transientFailures > 0 && attempt < 5) {
      const delayMinutes = Math.min(30, 2 ** attempt);
      await db.from("notifications").update({ status: "pending", next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), last_error: "PUSH_TRANSIENT_FAILURE" }).eq("id", row.id);
      failed += 1;
    } else {
      await db.from("notifications").update({ status: "failed", failed_at: new Date().toISOString(), last_error: "PUSH_DELIVERY_FAILED" }).eq("id", row.id);
      failed += 1;
    }
  }

  return json({ ok: true, configured: true, processed: (rows ?? []).length, sent, failed, skipped });
});
