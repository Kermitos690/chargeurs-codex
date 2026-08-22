import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Known double-release incident on DTA21269: second BATTERY_BORROW_OUT arrived
// 646 ms after the first one. Wait after the FIRST physical event, not after
// command dispatch, so the UX stays fast while the observed failure is caught.
const FIRST_RELEASE_SETTLE_MS = 1_500;

const reply = (body: unknown, status = 200, cid = crypto.randomUUID()) => new Response(JSON.stringify({ ...(body as any), correlationId: cid }), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
    "X-Correlation-Id": cid,
  },
});
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}[0-9a-f]$/i.test(v);
async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function outIdentity(payload: any) {
  const d = payload?.eventData ?? payload?.data ?? payload ?? {};
  const tradeNo = String(d.rentOrderId ?? d.orderId ?? payload?.rentOrderId ?? payload?.orderId ?? "").trim();
  const slot = Number(d.outSlot ?? payload?.outSlot);
  const battery = String(d.outBatteryId ?? payload?.outBatteryId ?? "").trim();
  return { tradeNo, slot, battery };
}
async function appendCanonical(db: any, session: any, eventType: string, resultingState: string, key: string, at: string, batteryId: string, metadata: any) {
  const { data: snap, error: snapError } = await db.from("rental_orchestrator_snapshots").select("state,version").eq("rental_id", session.id).maybeSingle();
  if (snapError) throw snapError;
  if (!snap) throw new Error("ORCHESTRATOR_SNAPSHOT_MISSING");
  if (String(snap.state) === resultingState || (eventType === "battery_released" && ["active","return_detected","pricing_finalized","payment_captured","completed"].includes(String(snap.state)))) return;
  const { error } = await db.rpc("append_rental_orchestrator_event", {
    p_rental_id: session.id,
    p_expected_version: Number(snap.version ?? 0),
    p_event_type: eventType,
    p_idempotency_key: key,
    p_occurred_at: at,
    p_metadata: metadata,
    p_resulting_state: resultingState,
    p_payment_intent_id: session.stripe_payment_intent_id ?? null,
    p_station_id: session.station_id,
    p_battery_id: batteryId,
    p_final_amount_chf: null,
    p_failure_reason: null,
  });
  if (error && !String(error.message ?? "").includes("IDEMPOTENCY_KEY_CONFLICT")) throw error;
}

Deno.serve(async (req) => {
  const cid = crypto.randomUUID();
  if (req.method === "OPTIONS") return reply({ ok: true }, 200, cid);
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, cid);
  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const rentalSessionId = body.rentalSessionId;
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId) || !uuid(rentalSessionId)) return reply({ ok: false, error: "INVALID_RECONCILIATION_REQUEST" }, 400, cid);

    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
    if (!token || token.length < 24) return reply({ ok: false, error: "KIOSK_AUTH_REQUIRED" }, 401, cid);
    const tokenHash = await sha256Hex(token);
    const { data: kiosk } = await db.from("kiosk_devices").select("id,station_id,active,token_revoked,token_expires_at").eq("token_hash", tokenHash).maybeSingle();
    const expired = kiosk?.token_expires_at && Date.parse(kiosk.token_expires_at) < Date.now();
    if (!kiosk || !kiosk.active || kiosk.token_revoked || expired) return reply({ ok: false, error: "KIOSK_DEVICE_DISABLED" }, 403, cid);
    if (kiosk.station_id !== stationId) return reply({ ok: false, error: "KIOSK_STATION_MISMATCH" }, 403, cid);

    const { data: session, error: se } = await db.from("rental_sessions")
      .select("id,station_id,cabinet_id,kiosk_device_id,public_session_code,state,selected_slot_num,battery_id,stripe_payment_intent_id,apifox_trade_no,ejected_at,started_at")
      .eq("id", rentalSessionId).eq("station_id", stationId).eq("kiosk_device_id", kiosk.id).maybeSingle();
    if (se) throw se;
    if (!session) return reply({ ok: false, error: "RENTAL_SESSION_NOT_FOUND" }, 404, cid);
    const suppliedCode = typeof body.publicCode === "string" ? body.publicCode.trim() : "";
    if (suppliedCode && suppliedCode !== session.public_session_code) return reply({ ok: false, error: "PUBLIC_CODE_MISMATCH" }, 403, cid);
    if (["ejected","active_rental","battery_taken","battery_returned","completed"].includes(String(session.state))) return reply({ ok: true, state: session.state, alreadyReconciled: true }, 200, cid);
    if (session.state !== "ejecting") return reply({ ok: true, state: session.state, reconcilable: false }, 200, cid);

    const { data: attempt, error: ae } = await db.from("hardware_release_attempts")
      .select("id,pre_snapshot,command_sent_at")
      .eq("rental_session_id", session.id).maybeSingle();
    if (ae) throw ae;
    if (!attempt?.pre_snapshot || !attempt.command_sent_at) return reply({ ok: true, state: "ejecting", confirmed: false, reason: "RELEASE_BASELINE_MISSING" }, 202, cid);

    const tradeNo = String(session.apifox_trade_no ?? "").trim();
    if (!tradeNo) return reply({ ok: true, state: "ejecting", confirmed: false, reason: "PROVIDER_TRADE_NO_PENDING" }, 202, cid);

    const { data: events, error: ee } = await db.from("cabinet_events")
      .select("external_event_id,received_at,payload")
      .eq("station_id", stationId).eq("event_type", "BATTERY_BORROW_OUT")
      .gte("received_at", attempt.command_sent_at)
      .order("received_at", { ascending: true }).limit(20);
    if (ee) throw ee;

    const matched = (events ?? []).map((row: any) => ({ row, id: outIdentity(row.payload) }))
      .filter((x: any) => x.id.tradeNo === tradeNo && Number.isInteger(x.id.slot) && x.id.slot > 0 && x.id.battery);
    if (matched.length === 0) return reply({ ok: true, state: "ejecting", confirmed: false, reason: "AWAITING_RELEASE_CONFIRMATION" }, 202, cid);

    const firstSeenMs = Date.parse(String(matched[0].row.received_at));
    if (!Number.isFinite(firstSeenMs) || Date.now() - firstSeenMs < FIRST_RELEASE_SETTLE_MS) {
      return reply({ ok: true, state: "ejecting", confirmed: false, reason: "AWAITING_FIRST_RELEASE_SETTLE_WINDOW", settleMs: FIRST_RELEASE_SETTLE_MS }, 202, cid);
    }

    const unique = new Map<string, any>();
    for (const x of matched) unique.set(`${x.id.slot}:${x.id.battery}`, x);
    const outs = [...unique.values()];

    if (outs.length > 1) {
      const slots = outs.map((x: any) => x.id.slot).sort((a: number,b: number) => a-b);
      const batteries = outs.map((x: any) => x.id.battery);
      const now = new Date().toISOString();
      await db.from("hardware_release_attempts").update({ result: "multi_release", released_slot_nums: slots, released_battery_ids: batteries, reconciled_at: now, updated_at: now }).eq("id", attempt.id);
      await db.from("rental_sessions").update({ state: "needs_support", failure_code: "MULTI_BATTERY_RELEASE_OBSERVED", failure_message: "Plusieurs batteries sont sorties pour une seule location. Aucune nouvelle éjection automatique n'est envoyée.", chargenow_status: "multi_release_detected", updated_at: now }).eq("id", session.id).eq("state", "ejecting");
      return reply({ ok: false, state: "needs_support", error: "MULTI_BATTERY_RELEASE_OBSERVED", releasedSlotNums: slots }, 202, cid);
    }

    const actualSlot = outs[0].id.slot;
    const actualBattery = outs[0].id.battery;
    const preSlots = Array.isArray(attempt.pre_snapshot?.slots) ? attempt.pre_snapshot.slots : [];
    const pre = preSlots.find((s: any) => Number(s.slot_num) === actualSlot);
    if (!pre || pre.battery_present !== true || String(pre.battery_id ?? "") !== actualBattery) {
      return reply({ ok: false, state: "ejecting", confirmed: false, error: "PROVIDER_RELEASE_NOT_IN_BASELINE" }, 202, cid);
    }

    const { data: liveSlot } = await db.from("station_slots").select("status,battery_id,updated_at").eq("station_id", stationId).eq("slot_num", actualSlot).maybeSingle();
    if (!liveSlot || liveSlot.battery_id) return reply({ ok: true, state: "ejecting", confirmed: false, reason: "PHYSICAL_SLOT_NOT_YET_EMPTY", slotNum: actualSlot }, 202, cid);

    const now = new Date().toISOString();
    await db.from("hardware_release_attempts").update({
      selected_slot_num: actualSlot,
      expected_battery_id: actualBattery,
      result: "single_release",
      released_slot_nums: [actualSlot],
      released_battery_ids: [actualBattery],
      post_snapshot: { source: "chargenow_event_plus_station_slots", observed_at: liveSlot.updated_at ?? now, slot_num: actualSlot, battery_present: false },
      reconciled_at: now,
      updated_at: now,
    }).eq("id", attempt.id);

    const { data: aligned, error: alignError } = await db.from("rental_sessions").update({
      selected_slot_num: actualSlot,
      battery_id: actualBattery,
      chargenow_status: "o2_provider_selected_single_release_confirmed",
      failure_code: null,
      failure_message: null,
      updated_at: now,
    }).eq("id", session.id).eq("state", "ejecting").select("id");
    if (alignError) throw alignError;
    if (!aligned?.length) return reply({ ok: true, state: session.state, reconcilable: false }, 200, cid);

    const actualSession = { ...session, selected_slot_num: actualSlot, battery_id: actualBattery };
    const meta = { source: "chargenow_o2_provider_selected", stationId, slotNum: actualSlot, batteryId: actualBattery, tradeNo, providerEventId: outs[0].row.external_event_id, noSecondHardwareCommand: true, releaseSettleMs: FIRST_RELEASE_SETTLE_MS };
    await appendCanonical(db, actualSession, "battery_released", "released", `battery_released:provider_selected:${tradeNo}:${actualBattery}`, now, actualBattery, meta);
    await appendCanonical(db, actualSession, "rental_activated", "active", `rental_activated:provider_selected:${tradeNo}:${actualBattery}`, now, actualBattery, meta);

    const { data: updated, error: ue } = await db.from("rental_sessions").update({
      state: "ejected",
      ejected_at: session.ejected_at ?? now,
      started_at: session.started_at ?? now,
      chargenow_status: "ejected",
      failure_code: null,
      failure_message: null,
      updated_at: now,
    }).eq("id", session.id).eq("state", "ejecting").select("id");
    if (ue) throw ue;

    await db.from("station_slot_reservations").update({ state: "released", released_at: now, release_reason: `provider_selected_slot_${actualSlot}`, updated_at: now }).eq("rental_session_id", session.id).eq("state", "reserved");
    await db.from("batteries").update({ station_id: null, slot_num: null, status: "out_of_station", updated_at: now }).eq("battery_id", actualBattery);

    return reply({ ok: true, state: updated?.length ? "ejected" : "ejecting", confirmed: Boolean(updated?.length), slotNum: actualSlot, batteryId: actualBattery, providerSelected: true, releaseSettleMs: FIRST_RELEASE_SETTLE_MS }, 200, cid);
  } catch (e) {
    console.error("reconcile-pending-ejection", e instanceof Error ? e.message : "RECONCILIATION_UNAVAILABLE");
    return reply({ ok: false, error: "RECONCILIATION_UNAVAILABLE" }, 503, cid);
  }
});
