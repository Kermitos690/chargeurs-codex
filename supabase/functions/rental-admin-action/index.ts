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

    // Defense-in-depth: every action requires operator+ (refund additionally
    // requires super_admin, checked in its branch). Authorize BEFORE parsing
    // params so non-privileged callers always get a clean 403, never a hint.
    if (!isOperator) return json({ ok: false, error: "FORBIDDEN" }, 403);

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
      // Re-read ChargeNow order status if we have a tradeNo, then apply the
      // result to the local state machine (not just metadata).
      const { orderQuery } = await import("../_shared/chargenow.ts");
      let cn: unknown = null;
      let applied: { chargenow_status: string; state?: string } | null = null;
      if (!session.apifox_trade_no) {
        await logApi(db, { service: "admin", endpoint: "reconcile", method: "POST", status_code: 200, request: { rentalSessionId, by: uid }, response: { skipped: "NO_TRADE_NO" } });
        return json({ ok: true, chargenow: null, chargenow_skipped: true, reason: "NO_TRADE_NO" });
      }

      const res = await orderQuery(session.apifox_trade_no);
      cn = res.data;
      if (!res.ok) {
        applied = { chargenow_status: "query_error" };
      } else {
        // Tolerant parsing of the documented rent-order response shape.
        const d = (res.data as Record<string, any>) ?? {};
        const o = d.data ?? d;
        // AUTHORITATIVE return signal = a physical giveback timestamp returned
        // by ChargeNow. We deliberately do NOT treat a generic "completed"/
        // closed order, a missing order, or a finished flag as a return: those
        // can be true without the battery being back in a valid slot.
        const returnTime = o.pGivebackTime ?? o.givebackTime ?? o.returnTime ?? o.pReturnTime ?? null;
        const givebackSlot = o.pGivebackDeviceid ?? o.givebackDeviceId ?? o.returnSlot ?? null;
        const returned = Boolean(returnTime);

        if (returned) {
          // State machine: only advance to battery_returned from an in-flight
          // rental. Never regress terminal/support states.
          const ADVANCEABLE = ["active_rental", "battery_taken", "ejected"];
          if (ADVANCEABLE.includes(session.state)) {
            applied = { chargenow_status: "returned", state: "battery_returned" };
          } else {
            // Returned per ChargeNow but local state is terminal or unexpected
            // → record metadata only, do NOT mutate the state machine.
            applied = { chargenow_status: "returned" };
          }
          await logApi(db, { service: "admin", endpoint: "reconcile:return", method: "POST", status_code: 200, request: { rentalSessionId, by: uid, fromState: session.state }, response: { returnTime, givebackSlot } });
        } else {
          applied = { chargenow_status: "borrowing" };
        }
      }


      const update: Record<string, unknown> = { chargenow_status: applied.chargenow_status };
      if (applied.state) {
        update.state = applied.state;
        if (applied.state === "battery_returned") update.returned_at = new Date().toISOString();
      }
      await db.from("rental_sessions").update(update).eq("id", rentalSessionId);
      await logApi(db, { service: "admin", endpoint: "reconcile", method: "POST", status_code: 200, request: { rentalSessionId, by: uid }, response: { cn, applied } });
      return json({ ok: true, chargenow: cn, applied });
    }

    if (action === "refund") {
      if (!isSuper) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (!STRIPE_KEY) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" });
      // Idempotency: don't refund twice.
      const { data: pay } = await db.from("payments").select("*").eq("rental_session_id", rentalSessionId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!pay || !pay.stripe_payment_intent_id) return json({ ok: false, error: "NO_PAYMENT_INTENT" });
      if (pay.status === "refunded" || pay.refunded_at) return json({ ok: true, alreadyRefunded: true });

      const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-12-18.acacia", httpClient: Stripe.createFetchHttpClient() });
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
