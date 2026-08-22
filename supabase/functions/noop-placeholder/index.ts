import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}
async function secret(db: ReturnType<typeof admin>, name: string) {
  const { data, error } = await db.rpc("internal_transactional_email_secret", { p_name: name });
  if (error) throw new Error(`PUSH_SECRET_${name.toUpperCase()}_UNAVAILABLE`);
  return String(data ?? "");
}
async function currentUser(req: Request, db: ReturnType<typeof admin>) {
  const token = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}
const TOPICS = ["payment", "rental", "reminders", "return", "receipt", "support", "membership"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = admin();
  const user = await currentUser(req, db);
  if (!user) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "status");

  if (action === "config") {
    const vapidPublicKey = await secret(db, "customer_push_vapid_public").catch(() => "");
    const { data: setting } = await db.from("app_settings").select("value").eq("key", "customer_push.delivery").maybeSingle();
    const enabled = setting?.value?.enabled === true;
    return json({ ok: true, configured: Boolean(enabled && vapidPublicKey), vapidPublicKey: enabled ? vapidPublicKey : "", topics: TOPICS, marketingIncluded: false });
  }

  if (action === "status") {
    const { data, error } = await db.from("customer_push_subscriptions")
      .select("id,endpoint,enabled,topics,platform,last_seen_at,last_success_at,last_failure_at,failure_count")
      .eq("user_id", user.id).eq("enabled", true).is("revoked_at", null).order("last_seen_at", { ascending: false });
    if (error) return json({ ok: false, error: "PUSH_STATUS_UNAVAILABLE" }, 500);
    return json({ ok: true, active: (data?.length ?? 0) > 0, subscriptions: data ?? [], topics: TOPICS });
  }

  if (action === "subscribe") {
    const subscription = body?.subscription ?? {};
    const endpoint = String(subscription?.endpoint ?? "").trim();
    const p256dh = String(subscription?.keys?.p256dh ?? "").trim();
    const authSecret = String(subscription?.keys?.auth ?? "").trim();
    if (!endpoint.startsWith("https://") || endpoint.length > 4096 || p256dh.length < 20 || p256dh.length > 512 || authSecret.length < 8 || authSecret.length > 256) return json({ ok: false, error: "INVALID_PUSH_SUBSCRIPTION" }, 400);

    const { data: existing, error: existingError } = await db.from("customer_push_subscriptions").select("id,user_id,revoked_at").eq("endpoint", endpoint).maybeSingle();
    if (existingError) return json({ ok: false, error: "PUSH_SUBSCRIPTION_LOOKUP_FAILED" }, 500);
    if (existing && existing.user_id !== user.id && !existing.revoked_at) return json({ ok: false, error: "PUSH_ENDPOINT_OWNERSHIP_CONFLICT" }, 409);

    const row = { user_id: user.id, endpoint, p256dh, auth_secret: authSecret, enabled: true, topics: TOPICS, user_agent: String(req.headers.get("user-agent") ?? "").slice(0, 500), platform: String(body?.platform ?? "web").slice(0, 80), updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), revoked_at: null, failure_count: 0 };
    const mutation = existing
      ? await db.from("customer_push_subscriptions").update(row).eq("id", existing.id).eq("user_id", user.id).select("id").single()
      : await db.from("customer_push_subscriptions").insert(row).select("id").single();
    if (mutation.error) return json({ ok: false, error: "PUSH_SUBSCRIPTION_SAVE_FAILED" }, 500);
    return json({ ok: true, active: true, subscriptionId: mutation.data.id, topics: TOPICS });
  }

  if (action === "unsubscribe") {
    const endpoint = String(body?.endpoint ?? "").trim();
    let query = db.from("customer_push_subscriptions").update({ enabled: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("enabled", true);
    if (endpoint) query = query.eq("endpoint", endpoint);
    const { error } = await query;
    if (error) return json({ ok: false, error: "PUSH_UNSUBSCRIBE_FAILED" }, 500);
    return json({ ok: true, active: false });
  }

  if (action === "test") {
    const { count } = await db.from("customer_push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("enabled", true).is("revoked_at", null);
    if (!count) return json({ ok: false, error: "NO_ACTIVE_PUSH_SUBSCRIPTION" }, 409);
    const { error } = await db.from("notifications").insert({ user_id: user.id, channel: "push", type: "push_test", title: "Chargeurs+ est prêt 🔋", body: "Les notifications sont actives sur cet appareil.", data: { url: "/compte/pass", test: true }, status: "pending", idempotency_key: `push:test:${user.id}:${crypto.randomUUID()}`, next_attempt_at: new Date().toISOString() });
    if (error) return json({ ok: false, error: "PUSH_TEST_QUEUE_FAILED" }, 500);
    return json({ ok: true, queued: true });
  }
  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
});
