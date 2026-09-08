// ChargeNow rental callback — provider-confirmed release + battery-first return reconciliation.
// A verified status=1 callback uniquely matched by trade number can close the kiosk release phase
// when the exact paid slot/battery was reserved before payment and exactly one C3 command was sent.
// Return settlement requires an exact physical BATTERY_IN for the contractual battery; the observed
// return slot is independent from the departure/ejection slot.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyRentalCandidates, selectPhysicalReturnEvidence } from "../_shared/returnCorrelation.ts";

const encoder = new TextEncoder();
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function signingSecret() {
  return Deno.env.get("CHARGENOW_CALLBACK_SECRET")
    ?? Deno.env.get("CHARGENOW_CALLBACK_SIGNING_KEY")
    ?? Deno.env.get("CHARGENOW_EVENT_SECRET")
    ?? "";
}
function base64Url(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function safeEqual(a: string, b: string) { if (!a || !b || a.length !== b.length) return false; let mismatch = 0; for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i); return mismatch === 0; }
async function rentalToken(rentalId: string) {
  const secret = signingSecret();
  if (!secret) throw new Error("CALLBACK_SIGNING_KEY_MISSING");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`chargeurs.ch:chargenow-callback:${rentalId}`));
  return base64Url(new Uint8Array(signature));
}
async function verifyCallback(req: Request, rentalId: string) {
  const url = new URL(req.url);
  const legacySecret = Deno.env.get("CHARGENOW_CALLBACK_SECRET") ?? Deno.env.get("CHARGENOW_EVENT_SECRET") ?? "";
  const legacyHeader = req.headers.get("x-event-secret") ?? req.headers.get("x-chargenow-secret") ?? "";
  if (legacySecret && safeEqual(legacyHeader, legacySecret)) return true;
  const provided = req.headers.get("x-chargenow-callback-token") ?? url.searchParams.get("token") ?? url.searchParams.get("amp;token") ?? "";
  const scopedRental = url.searchParams.get("rental");
  if (scopedRental && scopedRental !== rentalId) return false;
  try { return safeEqual(provided, await rentalToken(rentalId)); } catch { return false; }
}

function firstString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
function firstInt(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}
function flatten(value: unknown): Record<string, unknown> {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data as Record<string, unknown> : {};
  const eventData = root.eventData && typeof root.eventData === "object" && !Array.isArray(root.eventData) ? root.eventData as Record<string, unknown> : {};
  const result = root.result && typeof root.result === "object" && !Array.isArray(root.result) ? root.result as Record<string, unknown> : {};
  return { ...root, ...result, ...data, ...eventData };
}
async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) return Object.fromEntries((await req.formData()).entries());
  return await req.json().catch(() => ({}));
}
function identity(payload: Record<string, unknown>) {
  const row = flatten(payload);
  return {
    status: firstString(row, ["status", "rentStatus", "pStatus", "pstatus"]) ?? "",
    tradeNo: firstString(row, ["tradeNo", "trade_no", "orderNo", "orderId", "pOrderid", "pOrderId", "porderid"]) ?? "",
    eventId: firstString(row, ["messageId", "eventId", "msgId", "id"]),
    stationId: firstString(row, ["deviceId", "cabinetid", "cabinetId", "stationId", "pCabinetid", "pCabinetId", "pcabinetid", "givebackDeviceId", "returnDeviceId", "returnStationId"]),
    batteryId: firstString(row, ["batteryId", "returnBatteryId", "pBatteryid", "pBatteryId", "pbatteryid", "batterySN", "batterySn", "batteryCode", "bid"]),
    slotNum: firstInt(row, ["slotNum", "slot", "slotId", "position", "pKakou", "pkakou", "pSubKakou", "psubKakou", "givebackSlot", "returnSlot"]),
  };
}

async function logApi(client: ReturnType<typeof db>, endpoint: string, status: number, request: unknown, error: string | null = null) {
  await client.from("api_logs").insert({ service: "chargenow", endpoint, method: "POST", status_code: status, request, response: null, error }).then(() => {}, () => {});
}
async function audit(client: ReturnType<typeof db>, action: string, target: string | null, data: Record<string, unknown>) {
  await client.from("audit_logs").insert({ actor: null, action, target, data }).then(() => {}, () => {});
}
async function incident(client: ReturnType<typeof db>, session: Record<string, unknown> | null, code: string, message: string, details: Record<string, unknown>) {
  await client.from("system_incidents").insert({ type: "chargenow_callback", severity: "high", message, data: { rental_session_id: session?.id ?? null, station_id: session?.station_id ?? null, code, ...details }, resolved: false }).then(() => {}, () => {});
}

const SESSION_FIELDS = "id,station_id,state,state_version,battery_id,selected_slot_num,apifox_trade_no,chargenow_status,stripe_payment_intent_id,started_at,ejected_at,returned_at,settlement_status,customer_segment,customer_user_id";
async function uniqueActiveRentalByBattery(client: ReturnType<typeof db>, batteryId: string) {
  const { data, error } = await client.from("rental_sessions").select(SESSION_FIELDS)
    .eq("battery_id", batteryId)
    .in("state", ["ejected", "active_rental", "battery_taken", "battery_returned"])
    .is("returned_at", null)
    .order("started_at", { ascending: false, nullsFirst: false }).limit(2);
  if (error) throw error;
  return data ?? [];
}
async function sessionsByTrade(client: ReturnType<typeof db>, tradeNo: string) {
  if (!tradeNo) return [];
  const { data, error } = await client.from("rental_sessions").select(SESSION_FIELDS)
    .eq("apifox_trade_no", tradeNo).order("created_at", { ascending: false }).limit(2);
  if (error) throw error;
  return data ?? [];
}

async function appendExactEvent(
  client: ReturnType<typeof db>,
  session: Record<string, unknown>,
  args: { eventType: string; fromStates: string[]; targetState: string; key: string; occurredAt: string; stationId: string; batteryId: string; metadata: Record<string, unknown> },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: snapshot, error: snapshotError } = await client.from("rental_orchestrator_snapshots").select("state,version").eq("rental_id", session.id).maybeSingle();
    if (snapshotError) throw snapshotError;
    if (!snapshot) throw new Error("ORCHESTRATOR_SNAPSHOT_MISSING");
    if (String(snapshot.state) === args.targetState) return;
    if (!args.fromStates.includes(String(snapshot.state))) return;
    const { error } = await client.rpc("append_rental_orchestrator_event", {
      p_rental_id: session.id,
      p_expected_version: Number(snapshot.version ?? 0),
      p_event_type: args.eventType,
      p_idempotency_key: args.key,
      p_occurred_at: args.occurredAt,
      p_metadata: args.metadata,
      p_resulting_state: args.targetState,
      p_payment_intent_id: session.stripe_payment_intent_id ?? null,
      p_station_id: args.stationId,
      p_battery_id: args.batteryId,
      p_final_amount_chf: null,
      p_failure_reason: null,
    });
    if (!error) return;
    const msg = String(error.message ?? "");
    if (error.code === "40001" || msg.includes("VERSION_CONFLICT")) continue;
    if (error.code === "23505" || msg.includes("IDEMPOTENCY_KEY_CONFLICT")) return;
    throw error;
  }
  throw new Error("ORCHESTRATOR_VERSION_CONFLICT");
}

async function confirmProviderRelease(
  client: ReturnType<typeof db>,
  session: Record<string, unknown>,
  callbackKey: string,
  occurredAt: string,
) {
  if (["ejected", "active_rental", "battery_taken", "battery_returned", "completed"].includes(String(session.state))) return true;
  if (session.state !== "ejecting") return false;

  const slotNum = Number(session.selected_slot_num);
  const batteryId = String(session.battery_id ?? "").trim();
  const stationId = String(session.station_id ?? "").trim();
  if (!stationId || !Number.isInteger(slotNum) || slotNum < 1 || !batteryId) throw new Error("RELEASE_IDENTITY_INCOMPLETE");

  const { data: releaseAttempt, error: attemptError } = await client.from("hardware_release_attempts")
    .select("id,command_sent_at,selected_slot_num,expected_battery_id,result")
    .eq("rental_session_id", session.id).maybeSingle();
  if (attemptError) throw attemptError;
  if (!releaseAttempt?.command_sent_at) throw new Error("EJECT_COMMAND_NOT_CONFIRMED_SENT");
  if (Number(releaseAttempt.selected_slot_num) !== slotNum || String(releaseAttempt.expected_battery_id ?? "") !== batteryId) {
    throw new Error("RELEASE_RESERVATION_MISMATCH");
  }

  const { error: releaseAttemptError } = await client.from("hardware_release_attempts").update({
    result: "single_release",
    released_slot_nums: [slotNum],
    released_battery_ids: [batteryId],
    reconciled_at: occurredAt,
    updated_at: new Date().toISOString(),
  }).eq("id", releaseAttempt.id).in("result", ["prepared", "command_sent", "pending", "single_release"]);
  if (releaseAttemptError) throw releaseAttemptError;

  const metadata = {
    source: "verified_chargenow_release_callback",
    providerCallbackKey: callbackKey,
    tradeNo: session.apifox_trade_no ?? null,
    slotNum,
    batteryId,
    provider_identity_fallback: true,
    duplicate_hardware_command: false,
  };
  await appendExactEvent(client, session, {
    eventType: "battery_released", fromStates: ["release_requested"], targetState: "released",
    key: `battery_released:provider_callback:${callbackKey}`, occurredAt, stationId, batteryId, metadata,
  });
  await appendExactEvent(client, session, {
    eventType: "rental_activated", fromStates: ["released"], targetState: "active",
    key: `rental_activated:provider_callback:${callbackKey}`, occurredAt, stationId, batteryId, metadata,
  });

  const now = new Date().toISOString();
  const { error: sessionError } = await client.from("rental_sessions").update({
    state: "ejected",
    ejected_at: session.ejected_at ?? occurredAt,
    started_at: session.started_at ?? occurredAt,
    chargenow_status: "ejected_provider_confirmed",
    failure_code: null,
    failure_message: null,
    updated_at: now,
  }).eq("id", session.id).eq("state", "ejecting");
  if (sessionError) throw sessionError;
  await client.from("station_slot_reservations").update({
    state: "released", released_at: occurredAt, release_reason: "provider_release_confirmed", updated_at: now,
  }).eq("rental_session_id", session.id).eq("state", "reserved");
  await client.from("batteries").update({ station_id: null, slot_num: null, status: "out_of_station", updated_at: now }).eq("battery_id", batteryId);
  await audit(client, "rental.release.confirmed_from_verified_provider_callback", String(session.id), metadata);
  return true;
}

async function physicalReturnTime(
  client: ReturnType<typeof db>,
  session: Record<string, unknown>,
  stationId: string,
  batteryId: string,
): Promise<{ receivedAt: string; externalEventId: string | null; returnedSlotNum: number } | null> {
  const startedAt = String(session.started_at ?? session.ejected_at ?? "");
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return null;
  const { data, error } = await client.from("cabinet_events")
    .select("received_at,external_event_id,payload")
    .eq("station_id", stationId)
    .eq("event_type", "BATTERY_IN")
    .gte("received_at", startedAt)
    .order("received_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  const candidates = (data ?? []).map((row) => {
    const body = flatten(row.payload);
    return {
      receivedAt: String(row.received_at ?? ""),
      externalEventId: typeof row.external_event_id === "string" ? row.external_event_id : null,
      batteryId: firstString(body, ["returnBatteryId", "batteryId", "batterySN", "batterySn"]),
      slotNum: firstInt(body, ["returnSlot", "slotNum", "slot", "slotId"]),
    };
  });
  return selectPhysicalReturnEvidence(candidates, batteryId);
}

async function appendReturnDetected(client: ReturnType<typeof db>, session: Record<string, unknown>, args: { eventId: string; occurredAt: string; stationId: string; batteryId: string; slotNum: number; providerTradeNo: string | null; physicalEventId: string | null }) {
  const idempotencyKey = `return_detected:provider:${args.eventId}`;
  const metadata = {
    source: "battery_in_identity",
    providerTradeNo: args.providerTradeNo,
    canonicalTradeNo: session.apifox_trade_no ?? null,
    returnStationId: args.stationId,
    returnedSlotNum: args.slotNum,
    batteryId: args.batteryId,
    callbackEventId: args.eventId,
    physicalEventId: args.physicalEventId,
    startedAt: session.started_at ?? session.ejected_at ?? null,
  };
  await appendExactEvent(client, session, {
    eventType: "return_detected", fromStates: ["active"], targetState: "return_detected",
    key: idempotencyKey, occurredAt: args.occurredAt, stationId: args.stationId, batteryId: args.batteryId, metadata,
  });
}

async function triggerSettlement(rentalSessionId: string, returnedAt: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) return { ok: false, status: 0 };
  const response = await fetch(`${supabaseUrl}/functions/v1/settle-rental-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ rentalSessionId, returnState: "normal", finalAt: returnedAt }),
  });
  return { ok: response.ok, status: response.status };
}

async function reverseMemberCreditForProvenNoOutput(
  client: ReturnType<typeof db>,
  session: Record<string, unknown>,
  tradeNo: string,
) {
  if (session.customer_segment !== "member" || !session.customer_user_id || !tradeNo) return false;
  const { data: attempt, error: attemptError } = await client.from("hardware_release_attempts")
    .select("command_sent_at").eq("rental_session_id", session.id).maybeSingle();
  if (attemptError || !attempt?.command_sent_at) return false;
  const [{ data: successfulCallback, error: callbackError }, { data: borrowEvents, error: borrowError }] = await Promise.all([
    client.from("chargenow_callbacks").select("idempotency_key").eq("trade_no", tradeNo).eq("status", "1").limit(1).maybeSingle(),
    client.from("cabinet_events").select("payload").eq("station_id", session.station_id).eq("event_type", "BATTERY_BORROW_OUT").gte("received_at", attempt.command_sent_at).limit(50),
  ]);
  if (callbackError || borrowError || successfulCallback) return false;
  const hasMatchingOutput = (borrowEvents ?? []).some((row: { payload: unknown }) => outIdentity(row.payload).tradeNo === tradeNo);
  if (hasMatchingOutput) return false;
  const { data: releasedCents, error: reversalError } = await client.rpc("reverse_customer_membership_credit_for_rental", {
    p_rental_id: session.id,
    p_reason: "supplier_release_failed_without_borrow_out",
  });
  if (reversalError) throw reversalError;
  await audit(client, "membership_credit.reservation_released_after_proven_ejection_failure", String(session.id), {
    provider_trade_no: tradeNo,
    released_cents: Number(releasedCents ?? 0),
    physical_output_events: 0,
  });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const client = db();
  try {
    const parsed = identity(await parseBody(req));
    const safe = { status: parsed.status, tradeNo: parsed.tradeNo || null, eventId: parsed.eventId, stationId: parsed.stationId, batteryId: parsed.batteryId, slotNum: parsed.slotNum };
    await logApi(client, "/rent/callback:received", 200, safe);

    let sessions: Record<string, unknown>[] = [];
    if (parsed.status === "2" && parsed.batteryId) {
      sessions = await uniqueActiveRentalByBattery(client, parsed.batteryId) as Record<string, unknown>[];
      if (classifyRentalCandidates(sessions.length) === "ambiguous") {
        await incident(client, null, "RETURN_IDENTITY_AMBIGUOUS", "Plusieurs locations actives correspondent à la batterie physique; aucune transition financière n'a été appliquée.", { battery_id: parsed.batteryId, match_count: sessions.length, provider_trade_no: parsed.tradeNo || null });
        return json({ received: true, ignored: true, settlement_triggered: false, reason: "AMBIGUOUS_RENTAL" }, 202);
      }
    }
    if (sessions.length === 0 && parsed.tradeNo) sessions = await sessionsByTrade(client, parsed.tradeNo) as Record<string, unknown>[];
    if (!sessions.length) {
      await audit(client, "chargenow.callback.unmatched", null, { status: parsed.status, battery_id: parsed.batteryId, trade_no_fingerprint: parsed.tradeNo ? parsed.tradeNo.slice(-8) : null });
      return json({ received: true, unmatched: true }, 202);
    }
    if (sessions.length !== 1) {
      await incident(client, null, "RETURN_IDENTITY_AMBIGUOUS", "Plusieurs locations correspondent à la même preuve fournisseur; aucune transition n'a été appliquée.", { battery_id: parsed.batteryId, match_count: sessions.length });
      return json({ received: true, ignored: true, settlement_triggered: false, reason: "AMBIGUOUS_RENTAL" }, 202);
    }
    let session = sessions[0];
    if (!await verifyCallback(req, String(session.id))) {
      await logApi(client, "/rent/callback:rejected", 401, safe, "INVALID_CALLBACK_AUTH");
      return json({ ok: false, error: "INVALID_CALLBACK_AUTH" }, 401);
    }

    const canonicalTradeNo = typeof session.apifox_trade_no === "string" ? session.apifox_trade_no : "";
    const callbackKey = `rent-callback:${canonicalTradeNo || parsed.tradeNo || session.id}:${parsed.status}:${parsed.eventId ?? parsed.batteryId ?? parsed.slotNum ?? "default"}`;
    const { error: callbackError } = await client.from("chargenow_callbacks").upsert({ trade_no: canonicalTradeNo || parsed.tradeNo || null, station_id: parsed.stationId, status: parsed.status || null, idempotency_key: callbackKey, raw: safe, processed: true }, { onConflict: "idempotency_key" });
    if (callbackError) throw callbackError;

    if (parsed.status === "1") {
      const releasedAt = new Date().toISOString();
      const confirmed = await confirmProviderRelease(client, session, callbackKey, releasedAt);
      return json({ received: true, provider_release_confirmed: true, state: confirmed ? "ejected" : session.state, kiosk_release_complete: confirmed }, confirmed ? 200 : 202);
    }
    if (parsed.status === "0") {
      const creditReleased = await reverseMemberCreditForProvenNoOutput(client, session, canonicalTradeNo || parsed.tradeNo);
      await incident(client, session, "CHARGENOW_RELEASE_FAILURE_EVIDENCE", "ChargeNow a signalé un échec de sortie; aucune seconde commande d'éjection n'est envoyée automatiquement.", { tradeNo: parsed.tradeNo, currentState: session.state, automatic_retry_allowed: false });
      return json({ received: true, release_failure_evidence: true, membership_credit_released: creditReleased, automatic_retry_allowed: false }, 202);
    }
    if (parsed.status !== "2") return json({ received: true, ignored: true, reason: "UNKNOWN_STATUS" }, 202);

    if (session.state === "ejecting") {
      const { data: releaseEvidence } = await client.from("chargenow_callbacks")
        .select("idempotency_key,created_at")
        .eq("trade_no", canonicalTradeNo || parsed.tradeNo)
        .eq("status", "1").eq("processed", true)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (releaseEvidence) {
        await confirmProviderRelease(client, session, String(releaseEvidence.idempotency_key), String(releaseEvidence.created_at));
        const { data: refreshed, error: refreshError } = await client.from("rental_sessions").select(SESSION_FIELDS).eq("id", session.id).single();
        if (refreshError) throw refreshError;
        session = refreshed as Record<string, unknown>;
      }
    }

    const contractualBatteryId = typeof session.battery_id === "string" ? session.battery_id.trim() : "";
    const returnStationId = parsed.stationId ?? (typeof session.station_id === "string" ? session.station_id : null);
    const eventId = parsed.eventId ?? `trade-${canonicalTradeNo || parsed.tradeNo || session.id}-return`;
    if (!contractualBatteryId || !returnStationId) {
      await incident(client, session, "RETURN_IDENTITY_INCOMPLETE", "Le retour fournisseur ne peut pas être corrélé à l'identité contractuelle de la location.", { tradeNo: parsed.tradeNo });
      return json({ received: true, settlement_triggered: false, reason: "RETURN_IDENTITY_INCOMPLETE" }, 202);
    }
    if (parsed.batteryId && contractualBatteryId !== parsed.batteryId) {
      await incident(client, session, "RETURN_BATTERY_MISMATCH", "La batterie entrée ne correspond pas à la batterie contractuelle de la location active.", { expectedBattery: contractualBatteryId, observedBattery: parsed.batteryId });
      return json({ received: true, settlement_triggered: false, reason: "RETURN_BATTERY_MISMATCH" }, 202);
    }
    if (session.returned_at) return json({ received: true, duplicate: true, state: session.state, settlement_status: session.settlement_status ?? null });

    const physical = await physicalReturnTime(client, session, returnStationId, contractualBatteryId);
    if (!physical) {
      await incident(client, session, "RETURN_PHYSICAL_EVIDENCE_MISSING", "Aucun BATTERY_IN physique corrélé à la batterie contractuelle n'est disponible; aucun règlement financier n'est déclenché.", {
        battery_id: contractualBatteryId,
        return_station_id: returnStationId,
        provider_trade_no: parsed.tradeNo || null,
        canonical_trade_no: canonicalTradeNo || null,
      });
      await audit(client, "rental.return.awaiting_physical_evidence", String(session.id), {
        battery_id: contractualBatteryId,
        return_station_id: returnStationId,
        provider_trade_no: parsed.tradeNo || null,
        canonical_trade_no: canonicalTradeNo || null,
        settlement_triggered: false,
      });
      return json({ received: true, state: session.state, physical_reconciliation_required: true, settlement_triggered: false, reason: "RETURN_PHYSICAL_EVIDENCE_MISSING" }, 202);
    }

    const returnedAt = physical.receivedAt;
    const returnedSlotNum = physical.returnedSlotNum;
    await appendReturnDetected(client, session, { eventId, occurredAt: returnedAt, stationId: returnStationId, batteryId: contractualBatteryId, slotNum: returnedSlotNum, providerTradeNo: parsed.tradeNo || null, physicalEventId: physical.externalEventId });
    const { error: updateError } = await client.from("rental_sessions").update({
      state: "battery_returned",
      returned_at: returnedAt,
      return_station_id: returnStationId,
      returned_slot_num: returnedSlotNum,
      return_external_event_id: physical.externalEventId ? `battery-in:${physical.externalEventId}` : `battery-in:correlated:${eventId}`,
      chargenow_order_id: canonicalTradeNo || parsed.tradeNo || null,
    }).eq("id", session.id).is("returned_at", null);
    if (updateError) throw updateError;
    await client.from("batteries").update({ station_id: returnStationId, slot_num: returnedSlotNum, status: "in_station", updated_at: new Date().toISOString() }).eq("battery_id", contractualBatteryId);

    const settlement = await triggerSettlement(String(session.id), returnedAt);
    await audit(client, "rental.return.correlated_from_physical_battery_in", String(session.id), {
      battery_id: contractualBatteryId,
      return_station_id: returnStationId,
      selected_slot_num: session.selected_slot_num ?? null,
      returned_slot_num: returnedSlotNum,
      started_at: session.started_at ?? session.ejected_at ?? null,
      returned_at: returnedAt,
      physical_event_id: physical.externalEventId,
      provider_trade_no: parsed.tradeNo || null,
      canonical_trade_no: canonicalTradeNo || null,
      provider_order_mismatch_controlled: Boolean(parsed.tradeNo && canonicalTradeNo && parsed.tradeNo !== canonicalTradeNo),
      settlement_ok: settlement.ok,
    });
    if (!settlement.ok) await incident(client, session, "SETTLEMENT_RETRY_REQUIRED", "Le retour physique est enregistré mais le règlement financier doit être réconcilié.", { settlement_status: settlement.status, battery_id: contractualBatteryId });

    return json({ received: true, state: "battery_returned", settlement_triggered: true, settlement_ok: settlement.ok, returnedAt, returnedSlotNum, startedAt: session.started_at ?? session.ejected_at ?? null }, settlement.ok ? 200 : 202);
  } catch (error) {
    console.error("chargenow-rent-callback", error instanceof Error ? error.message : "CALLBACK_INTERNAL_ERROR");
    return json({ ok: false, error: "CALLBACK_INTERNAL_ERROR" }, 500);
  }
});
