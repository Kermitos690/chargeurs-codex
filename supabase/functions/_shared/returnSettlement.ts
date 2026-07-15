import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { correlateReturn, parseReturnIdentity, type ReturnCandidate } from "./returnCorrelation.ts";

export type ReturnSource = "chargenow_callback" | "cabinet_event" | "admin" | "reconciliation" | "system";

type MarkReturnInput = {
  source: ReturnSource;
  payload: Record<string, unknown>;
  externalEventId: string;
  exactRentalId?: string | null;
};

export type MarkReturnResult =
  | { ok: true; rentalId: string; queued: boolean; matchedBy: string }
  | { ok: false; error: string; incidentCreated: boolean };

async function incident(
  db: SupabaseClient,
  code: string,
  message: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.from("system_incidents").insert({
    type: code,
    severity: "high",
    message,
    data: details,
    resolved: false,
  }).then(() => {}, () => {});
}

async function appendReturnOrchestratorEvent(
  db: SupabaseClient,
  rentalId: string,
  externalEventId: string,
  identity: ReturnType<typeof parseReturnIdentity>,
  source: ReturnSource,
): Promise<void> {
  const { data: snapshot } = await db.from("rental_orchestrator_snapshots")
    .select("version,state")
    .eq("rental_id", rentalId)
    .maybeSingle();
  if (!snapshot) return;
  await db.rpc("append_rental_orchestrator_event", {
    p_rental_id: rentalId,
    p_expected_version: Number(snapshot.version),
    p_event_type: "return_detected",
    p_idempotency_key: `return:${source}:${externalEventId}`,
    p_occurred_at: new Date().toISOString(),
    p_metadata: {
      source,
      external_event_id: externalEventId,
      station_id: identity.stationId,
      battery_id: identity.batteryId,
      slot_num: identity.slotNum,
    },
    p_resulting_state: "return_detected",
    p_station_id: identity.stationId,
    p_battery_id: identity.batteryId,
  }).then(() => {}, () => {});
}

export async function markReturnAndEnqueue(
  db: SupabaseClient,
  input: MarkReturnInput,
): Promise<MarkReturnResult> {
  const identity = parseReturnIdentity(input.payload);
  const eventId = input.externalEventId.trim();
  if (!eventId) return { ok: false, error: "RETURN_EVENT_ID_REQUIRED", incidentCreated: false };

  let candidates: ReturnCandidate[] = [];
  if (input.exactRentalId) {
    const { data } = await db.from("rental_sessions")
      .select("id,station_id,state,battery_id,apifox_trade_no,created_at")
      .eq("id", input.exactRentalId)
      .limit(1);
    candidates = (data ?? []).map((row) => ({
      id: String(row.id), stationId: String(row.station_id), state: String(row.state),
      batteryId: row.battery_id ? String(row.battery_id) : null,
      tradeNo: row.apifox_trade_no ? String(row.apifox_trade_no) : null,
      createdAt: row.created_at ? String(row.created_at) : null,
    }));
  } else {
    let query = db.from("rental_sessions")
      .select("id,station_id,state,battery_id,apifox_trade_no,created_at")
      .in("state", ["ejected", "battery_taken", "active_rental"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (identity.tradeNo) query = query.eq("apifox_trade_no", identity.tradeNo);
    else if (identity.batteryId) query = query.eq("battery_id", identity.batteryId);
    else if (identity.stationId) query = query.eq("station_id", identity.stationId);
    const { data } = await query;
    candidates = (data ?? []).map((row) => ({
      id: String(row.id), stationId: String(row.station_id), state: String(row.state),
      batteryId: row.battery_id ? String(row.battery_id) : null,
      tradeNo: row.apifox_trade_no ? String(row.apifox_trade_no) : null,
      createdAt: row.created_at ? String(row.created_at) : null,
    }));
  }

  const correlation = input.exactRentalId && candidates.length === 1
    ? { ok: true as const, rentalId: candidates[0].id, matchedBy: "trade_no" as const }
    : correlateReturn(identity, candidates);

  if (!correlation.ok) {
    await incident(db, "return_correlation_failed", `Retour batterie non corrélé (${correlation.error}).`, {
      source: input.source,
      external_event_id: eventId,
      station_id: identity.stationId,
      battery_id: identity.batteryId,
      trade_no: identity.tradeNo,
      candidate_count: candidates.length,
      error: correlation.error,
    });
    return { ok: false, error: correlation.error, incidentCreated: true };
  }

  const returnedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await db.from("rental_sessions").update({
    state: "battery_returned",
    returned_at: returnedAt,
    return_station_id: identity.stationId,
    returned_slot_num: identity.slotNum,
    return_external_event_id: eventId,
    settlement_status: "queued",
    settlement_requested_at: returnedAt,
    settlement_error: null,
    battery_id: identity.batteryId ?? candidates.find((c) => c.id === correlation.rentalId)?.batteryId ?? null,
  }).eq("id", correlation.rentalId)
    .in("state", ["ejected", "battery_taken", "active_rental"])
    .select("id");

  if (updateError) throw updateError;
  if (!updated || updated.length === 0) {
    const { data: existing } = await db.from("rental_sessions")
      .select("id,state,settlement_status")
      .eq("id", correlation.rentalId)
      .maybeSingle();
    if (existing && ["battery_returned", "closing_order", "closed", "completed"].includes(String(existing.state))) {
      return { ok: true, rentalId: correlation.rentalId, queued: existing.settlement_status === "queued", matchedBy: correlation.matchedBy };
    }
    return { ok: false, error: "RETURN_STATE_CONFLICT", incidentCreated: false };
  }

  if (identity.batteryId) {
    await db.from("batteries").upsert({
      battery_id: identity.batteryId,
      station_id: identity.stationId,
      slot_num: identity.slotNum,
      status: "in_station",
    }, { onConflict: "battery_id" }).then(() => {}, () => {});
  }

  const { error: jobError } = await db.from("rental_settlement_jobs").upsert({
    rental_session_id: correlation.rentalId,
    reason: "returned",
    source: input.source,
    external_event_id: eventId,
    status: "pending",
    available_at: returnedAt,
  }, { onConflict: "source,external_event_id", ignoreDuplicates: true });

  if (jobError && (jobError as { code?: string }).code !== "23505") {
    await db.from("rental_sessions").update({ settlement_status: "failed", settlement_error: jobError.message })
      .eq("id", correlation.rentalId);
    await incident(db, "return_settlement_enqueue_failed", "Retour détecté mais règlement non mis en file.", {
      rental_session_id: correlation.rentalId,
      source: input.source,
      external_event_id: eventId,
      error: jobError.message,
    });
    return { ok: false, error: "SETTLEMENT_ENQUEUE_FAILED", incidentCreated: true };
  }

  await db.from("rental_orchestrator_external_events").upsert({
    source: "chargenow",
    external_event_id: `${input.source}:${eventId}`,
    rental_id: correlation.rentalId,
    event_type: "return_detected",
    payload: {
      station_id: identity.stationId,
      battery_id: identity.batteryId,
      trade_no: identity.tradeNo,
      slot_num: identity.slotNum,
    },
    processed_at: returnedAt,
    attempt_count: 1,
  }, { onConflict: "source,external_event_id", ignoreDuplicates: true }).then(() => {}, () => {});

  await appendReturnOrchestratorEvent(db, correlation.rentalId, eventId, identity, input.source);
  return { ok: true, rentalId: correlation.rentalId, queued: true, matchedBy: correlation.matchedBy };
}
