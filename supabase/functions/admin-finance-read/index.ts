// admin-finance-read — read-only projection for finance/support back-office.
// The UI navigation and this endpoint intentionally share the same read roles.
// No mutation is exposed here and no card data or Stripe secrets are returned.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireRoles } from "../_shared/db.ts";

const READ_ROLES = [
  "super_admin", "admin", "finance_admin", "support_agent",
  "operations_admin", "staff", "viewer",
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const userId = await requireRoles(req, db, READ_ROLES);
  if (!userId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "payments") {
    const { data, error } = await db.from("payments")
      .select("id,rental_session_id,stripe_session_id,stripe_payment_intent_id,amount,currency,payment_method,status,created_at,amount_authorized_cents,amount_captured_cents,amount_refunded_cents,refunded_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ ok: false, error: "PAYMENTS_READ_FAILED" }, 500);
    return json({ ok: true, payments: data ?? [] });
  }

  if (action === "rentals") {
    const { data, error } = await db.from("rental_sessions")
      .select("id,public_session_code,state,station_id,cabinet_id,shop_id,selected_slot_num,battery_id,apifox_trade_no,chargenow_order_id,chargenow_status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_method_type,amount_expected,amount_paid,currency,retry_count,created_at,paid_at,ejected_at,returned_at,return_station_id,returned_slot_num,return_external_event_id,failure_code,failure_message,settlement_status,settlement_error,final_amount_cents,captured_amount_cents,refunded_amount_cents")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ ok: false, error: "RENTALS_READ_FAILED" }, 500);
    return json({ ok: true, rentals: data ?? [] });
  }

  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
});
