// rental-admin-action — privileged operations on rental sessions:
//   retry_chargenow | reconcile | retry_settlement | declare_non_return |
//   refund | manual_review
//
// Role rules:
//   - operator+: retry/reconcile/manual review;
//   - super_admin: full refund and explicit non-return declaration.
//
// No automatic non-return deadline is invented here. The 99 CHF non-return
// settlement starts only after an explicit, audited super-admin decision.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

type DB = ReturnType<typeof adminClient>;

async function rolesOf(req: Request, db: DB): Promise<{ uid: string | null; roles: string[] }> {
  const auth = req.headers.get("Authorization");
  if (!auth) return { uid: null, roles: [] };
  const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
  if (!user) return { uid: null, roles: [] };
  const { data } = await db.from("user_roles").select("role").eq("user_id", user.id);
  return { uid: user.id, roles: (data ?? []).map((r: { role: string }) => r.role) };
}

async function callSettlement(
  rentalSessionId: string,
  returnState: "normal" | "not_returned",
  finalAt: string,
) {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/settle-rental-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ rentalSessionId, returnState, finalAt }),
  });
  const result = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, result };
}

function parsedTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const { uid, roles } = await rolesOf(req, db);
    if (!uid) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const isAdmin = roles.includes("admin") || roles.includes("super_admin");
    const isOperator = isAdmin || roles.includes("operator");
    const isSuper = roles.includes("super_admin");
    if (!isOperator) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const { action, rentalSessionId } = await req.json();
    if (!action || !rentalSessionId) return json({ ok: false, error: "MISSING_PARAMS" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (action === "retry_chargenow") {
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eject-after-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ rentalSessionId }),
      });
      const result = await response.json().catch(() => null);
      await logApi(db, {
        service: "admin",
        endpoint: "retry_chargenow",
        method: "POST",
        status_code: response.status,
        request: { rentalSessionId, by: uid },
        response: result,
      });
      return json({ ok: response.ok, result }, response.ok ? 200 : response.status);
    }

    if (action === "manual_review") {
      const { error } = await db.from("rental_sessions").update({
        state: "manual_review",
        settlement_status: session.settlement_status === "settled" ? "settled" : "manual_review",
        failure_message: "Placée en revue manuelle par un opérateur.",
      }).eq("id", rentalSessionId);
      if (error) throw error;
      await auditLog(db, { actor: uid, action: "rental.manual_review", target: rentalSessionId });
      return json({ ok: true });
    }

    if (action === "retry_settlement") {
      if (!session.returned_at && session.state !== "battery_returned" && session.state !== "needs_support") {
        return json({ ok: false, error: "RETURN_NOT_CONFIRMED" }, 409);
      }
      const finalAt = session.returned_at ?? new Date().toISOString();
      const settlement = await callSettlement(rentalSessionId, "normal", finalAt);
      await logApi(db, {
        service: "admin",
        endpoint: "retry_settlement",
        method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId, by: uid },
        response: settlement.result,
      });
      return json({ ok: settlement.ok, settlement: settlement.result }, settlement.ok ? 200 : settlement.status);
    }

    if (action === "declare_non_return") {
      if (!isSuper) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (session.returned_at || session.state === "battery_returned") {
        return json({ ok: false, error: "BATTERY_ALREADY_RETURNED" }, 409);
      }
      if (session.settlement_status === "settled") {
        return json({ ok: false, error: "SETTLEMENT_ALREADY_FINAL" }, 409);
      }

      const finalAt = new Date().toISOString();
      await auditLog(db, {
        actor: uid,
        action: "rental.non_return.declared",
        target: rentalSessionId,
        data: {
          previous_state: session.state,
          declared_at: finalAt,
          target_total_cents: 9900,
        },
      });

      const settlement = await callSettlement(rentalSessionId, "not_returned", finalAt);
      await logApi(db, {
        service: "admin",
        endpoint: "declare_non_return",
        method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId, by: uid },
        response: settlement.result,
      });

      return json({
        ok: settlement.ok,
        non_return_declared: true,
        settlement: settlement.result,
      }, settlement.ok ? 200 : settlement.status);
    }

    if (action === "reconcile") {
      const { orderQuery } = await import("../_shared/chargenow.ts");
      if (!session.apifox_trade_no) {
        await logApi(db, {
          service: "admin",
          endpoint: "reconcile",
          method: "POST",
          status_code: 200,
          request: { rentalSessionId, by: uid },
          response: { skipped: "NO_TRADE_NO" },
        });
        return json({ ok: true, chargenow: null, chargenow_skipped: true, reason: "NO_TRADE_NO" });
      }

      const response = await orderQuery(session.apifox_trade_no);
      if (!response.ok) {
        await db.from("rental_sessions").update({ chargenow_status: "query_error" }).eq("id", rentalSessionId);
        await logApi(db, {
          service: "admin",
          endpoint: "reconcile",
          method: "POST",
          status_code: 502,
          request: { rentalSessionId, by: uid },
          response: response.data,
          error: response.error ?? "CHARGENOW_QUERY_ERROR",
        });
        return json({ ok: false, error: "CHARGENOW_QUERY_ERROR", chargenow: response.data }, 502);
      }

      interface RentOrder {
        pGivebackTime?: string | number | null;
        givebackTime?: string | number | null;
        returnTime?: string | number | null;
        pReturnTime?: string | number | null;
        pGivebackDeviceid?: string | null;
        givebackDeviceId?: string | null;
        returnSlot?: string | null;
        data?: RentOrder;
      }

      const root = ((response.data as RentOrder) ?? {}) as RentOrder;
      const order = (root.data ?? root) as RentOrder;
      const rawReturnTime = order.pGivebackTime ?? order.givebackTime ?? order.returnTime ?? order.pReturnTime ?? null;
      const returnTime = parsedTimestamp(rawReturnTime);
      const givebackSlot = order.pGivebackDeviceid ?? order.givebackDeviceId ?? order.returnSlot ?? null;

      if (!returnTime) {
        await db.from("rental_sessions").update({ chargenow_status: "borrowing" }).eq("id", rentalSessionId);
        await logApi(db, {
          service: "admin",
          endpoint: "reconcile",
          method: "POST",
          status_code: 200,
          request: { rentalSessionId, by: uid },
          response: { returned: false },
        });
        return json({ ok: true, chargenow: response.data, applied: { chargenow_status: "borrowing" } });
      }

      const advanceable = ["active_rental", "battery_taken", "ejected", "needs_support"];
      const update: Record<string, unknown> = {
        chargenow_status: "returned",
        returned_at: session.returned_at ?? returnTime,
      };
      if (advanceable.includes(session.state)) update.state = "battery_returned";

      const { error: updateError } = await db.from("rental_sessions").update(update).eq("id", rentalSessionId);
      if (updateError) throw updateError;

      const settlement = await callSettlement(rentalSessionId, "normal", String(update.returned_at));
      await logApi(db, {
        service: "admin",
        endpoint: "reconcile:return",
        method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId, by: uid, fromState: session.state },
        response: { returnTime, givebackSlot, settlement: settlement.result },
      });

      return json({
        ok: settlement.ok,
        chargenow: response.data,
        applied: { chargenow_status: "returned", state: update.state ?? session.state, returnTime, givebackSlot },
        settlement: settlement.result,
      }, settlement.ok ? 200 : settlement.status);
    }

    if (action === "refund") {
      if (!isSuper) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (!STRIPE_KEY) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);

      const { data: payment } = await db.from("payments").select("*")
        .eq("rental_session_id", rentalSessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!payment?.stripe_payment_intent_id) return json({ ok: false, error: "NO_PAYMENT_INTENT" }, 409);
      if (payment.status === "refunded" || payment.refunded_at) return json({ ok: true, alreadyRefunded: true });

      const stripe = new Stripe(STRIPE_KEY, {
        apiVersion: "2024-12-18.acacia",
        httpClient: Stripe.createFetchHttpClient(),
      });
      const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);

      let providerId: string;
      if (intent.status === "requires_capture") {
        const cancelled = await stripe.paymentIntents.cancel(
          intent.id,
          {},
          { idempotencyKey: `admin_cancel_${rentalSessionId}` },
        );
        providerId = cancelled.id;
      } else {
        const refund = await stripe.refunds.create(
          { payment_intent: payment.stripe_payment_intent_id },
          { idempotencyKey: `admin_refund_${rentalSessionId}` },
        );
        providerId = refund.id;
      }

      const now = new Date().toISOString();
      await db.from("payments").update({
        status: "refunded",
        refund_id: providerId,
        refunded_at: now,
        amount_refunded_cents: payment.amount_captured_cents ?? payment.amount_authorized_cents ?? 0,
      }).eq("id", payment.id);
      await db.from("rental_sessions").update({
        state: "refunded",
        settlement_status: "settled",
        settlement_error: null,
        settlement_locked_at: null,
        settled_at: now,
      }).eq("id", rentalSessionId);
      await auditLog(db, {
        actor: uid,
        action: "rental.refunded",
        target: rentalSessionId,
        data: { provider_id: providerId, previous_payment_status: payment.status },
      });
      return json({ ok: true, provider_id: providerId });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    return json({ ok: false, error: String(error) }, 500);
  }
});
