// chargenow-rent-callback — O2 rent callback receiver.
// ChargeNow POSTs application/x-www-form-urlencoded with:
//   status : 0-Rent Fail, 1-Rent success, 2-Return Success
//   tradeNo
// Public endpoint (called by ChargeNow servers). Idempotent.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  try {
    let status: string | null = null;
    let tradeNo: string | null = null;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      status = String(form.get("status") ?? "");
      tradeNo = String(form.get("tradeNo") ?? "");
    } else {
      const body = await req.json().catch(() => ({}));
      status = String(body.status ?? "");
      tradeNo = String(body.tradeNo ?? "");
    }

    await db.from("api_logs").insert({
      service: "chargenow", endpoint: "/rent/callback", method: "POST",
      status_code: 200, request: { status, tradeNo }, response: null, error: null,
    });

    if (tradeNo) {
      const { data: session } = await db.from("rental_sessions")
        .select("id, state").eq("apifox_trade_no", tradeNo)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (session) {
        if (status === "1") {
          await db.from("rental_sessions").update({ state: "active_rental" }).eq("id", session.id);
        } else if (status === "2") {
          await db.from("rental_sessions").update({
            state: "battery_returned", returned_at: new Date().toISOString(),
          }).eq("id", session.id);
        } else if (status === "0") {
          await db.from("rental_sessions").update({
            state: "eject_failed", error_code: "RENT_FAIL",
            error_message: "ChargeNow a signalé un échec de location.",
          }).eq("id", session.id);
        }
      }
    }
    return new Response(JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
