// ChargeNow rental callback — supplier notifications plus battery-first return
// reconciliation. A callback alone is never physical release proof: the cabinet
// event/snapshot reconciler owns the transition to an active rental.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const SESSION_FIELDS = "id,station_id,state,state_version,battery_id,selected_slot_num,apifox_trade_no,chargenow_status,stripe_payment_intent_id,started_at,ejected_at,returned_at,settlement_status";
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

async function physicalReturnTime(
  client: ReturnType<typeof db>,
  session: Record<string, unknown>,
  stationId: string,
  batteryId: string,
  slotNum: number,
): Promise<{ receivedAt: string; externalEventId: string | null } | null> {
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
  for (const row of data ?? []) {
    const body = flatten(row.payload);
    const observedBattery = firstString(body, ["returnBatteryId", "batteryId", "batterySN", "batterySn"]);
    const observedSlot = firstInt(body, ["returnSlot", "slotNum", "slot", "slotId"]);
    if (observedBattery === batteryId && (observedSlot == null || observedSlot === slotNum)) {
      return { receivedAt: String(row.received_at), externalEventId: typeof row.external_event_id === "string" ? row.external_event_id : null };
    }
  }
  return null;
}

async function appendReturnDetected(client: ReturnType<typeof db>, session: Record<string, unknown>, args: { eventId: string; occurredAt: string; stationId: string; batteryId: string; slotNum: number; providerTradeNo: string | null; physicalEventId: string | null }) {
  const idempotencyKey = `return_detected:provider:${args.eventId}`;
  const metadata = {
    source: args.physicalEventId ? "battery_in_identity" : "verified_chargenow_return_callback",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const client = db();
  try {
    const parsed = identity(await parseBody(req));
    const safe = { status: parsed.status, tradeNo: parsed.tradeNo || null, eventId: parsed.eventId, stationId: parsed.stationId, batteryId: parsed.batteryId, slotNum: parsed.slotNum };
    await logApi(client, "/rent/callback:received", 200, safe);

    let sessions: Record<string, unknown>[] = [];
    if (parsed.status === "2" && parsed.batteryId) sessions = await uniqueActiveRentalByBattery(client, parsed.batteryId) as Record<string, unknown>[];
    if (sessions.length !== 1 && parsed.tradeNo) sessions = await sessionsByTrade(client, parsed.tradeNo) as Record<string, unknown>[];
    if (!sessions.length) {
      await audit(client, "chargenow.callback.unmatched", null, { status: parsed.status, battery_id: parsed.batteryId, trade_no_fingerprint: parsed.tradeNo ? parsed.tradeNo.slice(-8) : null });
      return json({ received: true, unmatched: true }, 202);
    }
    if (sessions.length !== 1) {
      await incident(client, null, "RETURN_IDENTITY_AMBIGUOUS", "Plusieurs locations correspondent à la même preuve fournisseur; aucune transition n'a été appliquée.", { battery_id: parsed.batteryId, match_count: sessions.length });
      return json({ received: true, ignored: true, reason: "AMBIGUOUS_RENTAL" }, 202);
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
      await incident(
        client,
        session,
        "RELEASE_PROVIDER_NOTIFICATION_ONLY",
        "Le fournisseur a signalé une sortie, mais cette notification ne prouve ni le slot ni la batterie physiquement sortie; la location reste en réconciliation.",
        { tradeNo: parsed.tradeNo, battery_id: parsed.batteryId, station_id: parsed.stationId, slot_num: parsed.slotNum },
      );
      return json({ received: true, provider_release_confirmed: false, state: session.state, requires_physical_reconciliation: true }, 202);
    }
    if (parsed.status === "0") {
      await incident(client, session, "CHARGENOW_RELEASE_FAILURE_EVIDENCE", "ChargeNow a signalé un échec de sortie; aucune seconde commande d'éjection n'est envoyée automatiquement.", { tradeNo: parsed.tradeNo, currentState: session.state, automatic_retry_allowed: false });
      return json({ received: true, release_failure_evidence: true, automatic_retry_allowed: false }, 202);
    }
    if (parsed.status !== "2") return json({ received: true, ignored: true, reason: "UNKNOWN_STATUS" }, 202);

    // A generic order-status callback is not physical return evidence. The
    // return must name the actual battery, receiving station and slot. Falling
    // back to the reserved identity here can settle the wrong rental after a
    // supplier double-ejection.
    if (!parsed.batteryId || !parsed.stationId || parsed.slotNum == null) {
      await incident(client, session, "RETURN_IDENTITY_INCOMPLETE", "Le callback de retour ne contient pas l'identité physique complète; aucune clôture ni capture n'est autorisée.", {
        tradeNo: parsed.tradeNo,
        battery_id: parsed.batteryId,
        station_id: parsed.stationId,
        slot_num: parsed.slotNum,
      });
      return json({ received: true, settlement_triggered: false, reason: "RETURN_IDENTITY_INCOMPLETE" }, 202);
    }

    const batteryId = parsed.batteryId;
    const stationId = parsed.stationId;
    const slotNum = parsed.slotNum;
    const eventId = parsed.eventId ?? `trade-${canonicalTradeNo || parsed.tradeNo || session.id}-return`;
    if (!batteryId || !stationId || !Number.isInteger(slotNum) || slotNum < 1) {
      await incident(client, session, "RETURN_IDENTITY_INCOMPLETE", "Le retour fournisseur ne peut pas être corrélé à l'identité réservée de la location.", { tradeNo: parsed.tradeNo });
      return json({ received: true, settlement_triggered: false, reason: "RETURN_IDENTITY_INCOMPLETE" }, 202);
    }
    if (parsed.batteryId && String(session.battery_id ?? "") !== parsed.batteryId) {
      await incident(client, session, "RETURN_BATTERY_MISMATCH", "La batterie entrée ne correspond pas à la batterie de la location active.", { expectedBattery: session.battery_id ?? null, observedBattery: parsed.batteryId });
      return json({ received: true, settlement_triggered: false, reason: "RETURN_BATTERY_MISMATCH" }, 202);
    }
    if (session.returned_at) return json({ received: true, duplicate: true, state: session.state, settlement_status: session.settlement_status ?? null });

    const physical = await physicalReturnTime(client, session, stationId, batteryId, slotNum);
    const returnedAt = physical?.receivedAt ?? new Date().toISOString();
    await appendReturnDetected(client, session, { eventId, occurredAt: returnedAt, stationId, batteryId, slotNum, providerTradeNo: parsed.tradeNo || null, physicalEventId: physical?.externalEventId ?? null });
    const { error: updateError } = await client.from("rental_sessions").update({
      state: "battery_returned",
      returned_at: returnedAt,
      return_station_id: stationId,
      returned_slot_num: slotNum,
      return_external_event_id: physical?.externalEventId ? `battery-in:${physical.externalEventId}` : `provider-return:${eventId}`,
      chargenow_order_id: canonicalTradeNo || parsed.tradeNo || null,
    }).eq("id", session.id).is("returned_at", null);
    if (updateError) throw updateError;
    await client.from("batteries").update({ station_id: stationId, slot_num: slotNum, status: "in_station", updated_at: new Date().toISOString() }).eq("battery_id", batteryId);

    const settlement = await triggerSettlement(String(session.id), returnedAt);
    await audit(client, "rental.return.correlated_from_verified_provider_callback", String(session.id), {
      battery_id: batteryId,
      return_station_id: stationId,
      returned_slot_num: slotNum,
      started_at: session.started_at ?? session.ejected_at ?? null,
      returned_at: returnedAt,
      physical_event_id: physical?.externalEventId ?? null,
      provider_trade_no: parsed.tradeNo || null,
      canonical_trade_no: canonicalTradeNo || null,
      provider_identity_fallback: false,
      settlement_ok: settlement.ok,
    });
    if (!settlement.ok) await incident(client, session, "SETTLEMENT_RETRY_REQUIRED", "Le retour est enregistré mais le règlement financier doit être réconcilié.", { settlement_status: settlement.status, battery_id: batteryId });

    return json({ received: true, state: "battery_returned", settlement_triggered: true, settlement_ok: settlement.ok, returnedAt, startedAt: session.started_at ?? session.ejected_at ?? null }, settlement.ok ? 200 : 202);
  } catch (error) {
    console.error("chargenow-rent-callback", error instanceof Error ? error.message : "CALLBACK_INTERNAL_ERROR");
    return json({ ok: false, error: "CALLBACK_INTERNAL_ERROR" }, 500);
  }
});
