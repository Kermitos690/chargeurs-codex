// rental-admin-action — admin-gated operations on rental sessions:
//   retry_chargenow | refund | reconcile | manual_review
// Role rules: refund requires super_admin; others require operator+.
// Refunds are idempotent and never executed from the frontend directly.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

async function rolesOf(req: Request, db: ReturnType<typeof adminClient>): Promise<{ uid: string | null; roles: string[] }> {
  const auth = req.headers.get("Authorization");
  if (!auth) return { uid: null, roles: [] };
  const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
  if (!user) return { uid: null, roles: [] };
  const { data } = await db.from("user_roles").select("role").eq("user_id", user.id);
  return { uid: user.id, roles: (data ?? []).map((r: { role: string }) => r.role) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { uid, roles } = await rolesOf(req, db);
    if (!uid) return json({ ok: false, error: "FORBIDDEN" }, 403);
    const isAdmin = roles.includes("admin") || roles.includes("super_admin");
    const isOperator = isAdmin || roles.includes("operator");
    const isSuper = roles.includes("super_admin");

    const { action, rentalSessionId } = await req.json();
    if (!action || !rentalSessionId) return json({ ok: false, error: "MISSING_PARAMS" }, 400);

    const { data: session } = await db.from("rental_sessions").select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (action === "retry_chargenow") {
      if (!isOperator) return json({ ok: false, error: "FORBIDDEN" }, 403);
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eject-after-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ rentalSessionId }),
      });
      const data = await r.json();
      await logApi(db, { service: "admin", endpoint: "retry_chargenow", method: "POST", status_code: r.status, request: { rentalSessionId, by: uid }, response: data });
      return json({ ok: true, result: data });
    }

    if (action === "manual_review") {
      if (!isOperator) return json({ ok: false, error: "FORBIDDEN" }, 403);
      await db.from("rental_sessions").update({ state: "manual_review", failure_message: "Placée en revue manuelle par un opérateur." }).eq("id", rentalSessionId);
      await logApi(db, { service: "admin", endpoint: "manual_review", method: "POST", status_code: 200, request: { rentalSessionId, by: uid } });
      return json({ ok: true });
    }

    if (action === "reconcile") {
      if (!isOperator) return json({ ok: false, error: "FORBIDDEN" }, 403);
      // Best-effort: re-read ChargeNow order status if we have a tradeNo.
      const { orderQuery } = await import("../_shared/chargenow.ts");
      let cn: unknown = null;
      if (session.apifox_trade_no) {
        const res = await orderQuery(session.apifox_trade_no);
        cn = res.data;
        await db.from("rental_sessions").update({ chargenow_status: res.ok ? "queried" : "query_error" }).eq("id", rentalSessionId);
      }
      await logApi(db, { service: "admin", endpoint: "reconcile", method: "POST", status_code: 200, request: { rentalSessionId, by: uid }, response: cn });
      return json({ ok: true, chargenow: cn });
    }

    if (action === "refund") {
      if (!isSuper) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (!STRIPE_KEY) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" });
      // Idempotency: don't refund twice.
      const { data: pay } = await db.from("payments").select("*").eq("rental_session_id", rentalSessionId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!pay || !pay.stripe_payment_intent_id) return json({ ok: false, error: "NO_PAYMENT_INTENT" });
      if (pay.status === "refunded" || pay.refunded_at) return json({ ok: true, alreadyRefunded: true });

      const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-12-18.acacia" });
      const refund = await stripe.refunds.create(
        { payment_intent: pay.stripe_payment_intent_id },
        { idempotencyKey: `refund_${rentalSessionId}` },
      );
      await db.from("payments").update({ status: "refunded", refund_id: refund.id, refunded_at: new Date().toISOString() }).eq("id", pay.id);
      await db.from("rental_sessions").update({ state: "refunded" }).eq("id", rentalSessionId);
      await logApi(db, { service: "stripe", endpoint: "refunds.create", method: "POST", status_code: 200, request: { rentalSessionId, by: uid }, response: { id: refund.id } });
      return json({ ok: true, refund_id: refund.id });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
