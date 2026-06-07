// close-rental-order — closes a ChargeNow rent order after battery return.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin } from "../_shared/db.ts";
import { isChargeNowConfigured, orderClose } from "../_shared/chargenow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  // Admin-gated to avoid abuse.
  const adminId = await requireAdmin(req, db);
  if (!adminId) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { rentalSessionId } = await req.json();
    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "SESSION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await db.from("rental_sessions").update({ state: "closing_order" }).eq("id", session.id);

    if (isChargeNowConfigured() && session.apifox_trade_no) {
      const res = await orderClose({ tradeNo: session.apifox_trade_no, orderId: session.apifox_trade_no });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/close", method: "POST",
        status_code: res.status, request: { tradeNo: session.apifox_trade_no }, response: res.data, error: res.error,
      });
    }

    await db.from("rental_sessions").update({
      state: "closed", closed_at: new Date().toISOString(),
    }).eq("id", session.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
