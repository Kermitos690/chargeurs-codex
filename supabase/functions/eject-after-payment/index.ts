// eject-after-payment — trusted release command after a validated 30 CHF deposit.
//
// Service-role/admin only. The canonical financial and hardware flows must both
// be enabled. Definitive delivery failures cancel an uncaptured card hold or
// refund a captured TWINT deposit through the shared compensation adapter.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, auditLog, requireAdmin } from "../_shared/db.ts";
import { ejectByRent, isChargeNowConfigured, orderCreate } from "../_shared/chargenow.ts";
import { compensateFailedRelease } from "../_shared/depositCompensation.ts";
import { extractEjectedBattery } from "../_shared/returnCorrelation.ts";

const MAX_RETRIES = 3;
const FINANCIAL_FLOW_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_FLOW") ?? "false").toLowerCase() === "true";
const HARDWARE_FLOW_ENABLED = (Deno.env.get("ENABLE_CANONICAL_HARDWARE_FLOW") ?? "false").toLowerCase() === "true";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DB = ReturnType<typeof adminClient>;
type Session = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

async function authorizeCaller(req: Request, db: DB): Promise<{ ok: true; actor: string } | { ok: false }> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (safeEqual(token, serviceRole)) return { ok: true, actor: "service_role" };
  const adminId = await requireAdmin(req, db);
  return adminId ? { ok: true, actor: adminId } : { ok: false };
}

function configuredCallbackUrl(): string | null {
  const raw = Deno.env.get("CHARGENOW_CALLBACK_URL") ?? "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.pathname.endsWith("/chargenow-rent-callback")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function failAndCompensate(db: DB, session: Session, code: string, message: string) {
  await db.from("rental_sessions").update({
    state: "eject_failed",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id).neq("settlement_status", "legacy");
  const { data: fresh } = await db.from("rental_sessions").select("*").eq("id", session.id).maybeSingle();
  return await compensateFailedRelease(db, (fresh ?? session) as Session, code);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!FINANCIAL_FLOW_ENABLED) return json({ ok: false, error: "CANONICAL_SETTLEMENT_FLOW_DISABLED" }, 503);
  if (!HARDWARE_FLOW_ENABLED) return json({ ok: false, error: "CANONICAL_HARDWARE_FLOW_DISABLED" }, 503);

  const db = adminClient();
  const caller = await authorizeCaller(req, db);
  if (!caller.ok) return json({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId.trim() : "";
    if (!UUID_RE.test(rentalSessionId)) return json({ ok: false, error: "INVALID_SESSION" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (session.settlement_status === "legacy") return json({ ok: false, error: "LEGACY_RENTAL_NOT_RELEASABLE" }, 409);

    if (["ejected", "battery_taken", "active_rental", "battery_returned", "closed", "completed", "non_return"].includes(session.state)) {
      return json({ ok: true, alreadyDone: true, state: session.state });
    }
    if (["refund_pending", "refunded"].includes(session.state)) {
      return json({ ok: true, compensated: true, state: session.state });
    }
    if (!["authorized", "prepaid"].includes(String(session.settlement_status))) {
      return json({ ok: false, error: "DEPOSIT_NOT_READY", settlement_status: session.settlement_status }, 409);
    }
    if (!["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"].includes(session.state)) {
      return json({ ok: false, error: "INVALID_RELEASE_STATE", state: session.state }, 409);
    }

    if (!isChargeNowConfigured()) {
      const compensation = await failAndCompensate(db, session, "CHARGENOW_NOT_CONFIGURED", "API ChargeNow non configurée — délivrance impossible.");
      return json({ ok: false, error: "CHARGENOW_NOT_CONFIGURED", compensation }, 503);
    }

    const callbackURL = configuredCallbackUrl();
    if (!callbackURL) {
      const compensation = await failAndCompensate(db, session, "CHARGENOW_CALLBACK_NOT_CONFIGURED", "Le callback ChargeNow sécurisé n'est pas configuré.");
      return json({ ok: false, error: "CHARGENOW_CALLBACK_NOT_CONFIGURED", compensation }, 503);
    }

    const retry = Number(session.retry_count ?? 0);
    if (!Number.isInteger(retry) || retry >= MAX_RETRIES) {
      const compensation = await failAndCompensate(db, session, "MAX_RELEASE_RETRIES", "Nombre maximal de tentatives de délivrance atteint.");
      return json({ ok: false, error: "MAX_RELEASE_RETRIES", compensation }, 409);
    }

    const { data: locked, error: lockError } = await db.from("rental_sessions")
      .update({ state: "ejecting", retry_count: retry + 1 })
      .eq("id", session.id)
      .in("state", ["payment_succeeded", "chargenow_failed", "eject_failed"])
      .in("settlement_status", ["authorized", "prepaid"])
      .select("id");
    if (lockError) throw lockError;
    if (!locked?.length) return json({ ok: true, alreadyInProgress: true });

    const cabinetId = String(session.cabinet_id ?? session.station_id ?? "").trim();
    if (!cabinetId) throw new Error("CABINET_ID_MISSING");

    let tradeNo = typeof session.apifox_trade_no === "string" ? session.apifox_trade_no : null;
    if (!tradeNo) {
      const order = await orderCreate({ deviceId: cabinetId, callbackURL });
      await logApi(db, {
        service: "chargenow",
        endpoint: "/rent/order/create",
        method: "POST",
        status_code: order.status,
        request: { cabinetId },
        response: order.data,
        error: order.error,
      });

      const orderData = order.data as { data?: { tradeNo?: string; orderId?: string }; tradeNo?: string } | null;
      tradeNo = orderData?.data?.tradeNo ?? orderData?.tradeNo ?? null;
      const orderId = orderData?.data?.orderId ?? null;

      await db.from("apifox_orders").upsert({
        rental_session_id: session.id,
        trade_no: tradeNo,
        request: { cabinetId },
        response: order.data,
        status: order.ok ? "created" : "error",
      }, { onConflict: "rental_session_id" });

      if (!order.ok || !tradeNo) {
        const compensation = await failAndCompensate(db, session, order.error ?? "ORDER_CREATE_FAILED", "La commande ChargeNow n'a pas pu être créée.");
        return json({ ok: false, error: "ORDER_CREATE_FAILED", compensation }, 502);
      }

      await db.from("rental_sessions").update({
        apifox_trade_no: tradeNo,
        chargenow_order_id: orderId,
        chargenow_status: "created",
      }).eq("id", session.id);
    }

    const configuredSlot = Number(session.selected_slot_num ?? 0);
    const slotNum = Number.isInteger(configuredSlot) && configuredSlot >= 0 ? configuredSlot : 0;
    const ejection = await ejectByRent(cabinetId, slotNum, tradeNo);
    await logApi(db, {
      service: "chargenow",
      endpoint: "/cabinet/ejectByRent",
      method: "POST",
      status_code: ejection.status,
      request: { cabinetId, slotNum, tradeNoFingerprint: tradeNo.slice(-8) },
      response: ejection.data,
      error: ejection.error,
    });

    if (!ejection.ok) {
      const compensation = await failAndCompensate(db, session, ejection.error ?? "EJECTION_FAILED", "La batterie n'a pas été délivrée par la borne.");
      return json({ ok: false, error: "EJECTION_FAILED", compensation }, 502);
    }

    const identity = extractEjectedBattery(ejection.data);
    const releasedAt = new Date().toISOString();
    const releasePatch: Record<string, unknown> = {
      state: "ejected",
      ejected_at: releasedAt,
      started_at: releasedAt,
      chargenow_status: "ejected",
      apifox_trade_no: tradeNo,
    };
    if (identity.batteryId) releasePatch.battery_id = identity.batteryId;
    if (identity.slotNum != null) releasePatch.selected_slot_num = identity.slotNum;

    const { error: releaseError } = await db.from("rental_sessions")
      .update(releasePatch)
      .eq("id", session.id)
      .eq("state", "ejecting");
    if (releaseError) throw releaseError;

    await auditLog(db, {
      actor: caller.actor,
      action: "rental.released",
      target: session.id,
      data: {
        cabinet_id: cabinetId,
        slot_num: identity.slotNum ?? slotNum,
        battery_id: identity.batteryId,
        trade_no_fingerprint: tradeNo.slice(-8),
      },
    });

    return json({
      ok: true,
      slotNum: identity.slotNum ?? slotNum,
      batteryIdentified: Boolean(identity.batteryId),
    });
  } catch (error) {
    await logApi(db, {
      service: "chargenow",
      endpoint: "eject-after-payment:handle",
      method: "POST",
      status_code: 500,
      error: error instanceof Error ? error.message : "RELEASE_INTERNAL_ERROR",
    }).catch(() => {});
    return json({ ok: false, error: "RELEASE_INTERNAL_ERROR" }, 500);
  }
});
