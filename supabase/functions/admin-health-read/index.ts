// admin-health-read — secret-safe health projection for back-office readers.
// It never performs provider mutations and never returns secret values.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";

const READ_ROLES = [
  "super_admin", "admin", "operations_admin", "operator", "support_agent",
  "maintenance_technician", "staff", "viewer",
] as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = adminClient();
  const userId = await requireRoles(req, db, READ_ROLES);
  if (!userId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const stripeMode = (Deno.env.get("STRIPE_MODE") ?? "").toLowerCase();
  const stripeLiveEnabled = (Deno.env.get("STRIPE_LIVE_ENABLED") ?? "").toLowerCase();
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const stripe = stripeMode === "test" && stripeLiveEnabled === "false" && (stripeKey.startsWith("sk_test_") || stripeKey.startsWith("rk_test_"));
  const webhookSecretConfigured = stripe && webhookSecret.startsWith("whsec_");
  const chargenow = Boolean(
    Deno.env.get("CHARGENOW_BASIC_AUTH") ||
    (Deno.env.get("CHARGENOW_BASIC_USERNAME") && Deno.env.get("CHARGENOW_BASIC_PASSWORD")),
  );

  const [{ count: stripeEvents }, { count: cabinetEvents }, { data: coverage }] = await Promise.all([
    db.from("webhook_events").select("id", { count: "exact", head: true }),
    db.from("cabinet_events").select("id", { count: "exact", head: true }),
    db.from("api_coverage").select("code,live_test_status,proof_state").in("code", ["E1", "E2"]),
  ]);
  const e1 = (coverage ?? []).find((row: any) => row.code === "E1");
  const e2 = (coverage ?? []).find((row: any) => row.code === "E2");
  const eventPushConfigured = e1?.live_test_status === "pass" && e2?.live_test_status === "pass"
    && e1?.proof_state === "live_verified" && e2?.proof_state === "live_verified";

  return json({
    ok: true,
    health: {
      stripe,
      chargenow,
      stripeWebhookConfigured: webhookSecretConfigured,
      stripeWebhookReceived: webhookSecretConfigured && (stripeEvents ?? 0) > 0,
      stripeWebhookEvents: stripeEvents ?? 0,
      eventPushConfigured,
      eventPushReceived: (cabinetEvents ?? 0) > 0,
      cabinetEvents: cabinetEvents ?? 0,
    },
  });
});
