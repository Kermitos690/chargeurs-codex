import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, requireAdmin } from "../_shared/db.ts";

const STATION_ID = "DTA21269";
const QUARANTINE_REASON = "SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED";
const PROOF_RENTAL_ID = "70e359eb-8400-42a3-bb5f-6638c33b66d6";
const RESOLUTION_REASON = "SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_VERIFIED_BY_PERSISTED_PROOF";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });

function cents(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function outIdentity(payload: unknown) {
  const row = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const data = (row.eventData && typeof row.eventData === "object" ? row.eventData : row) as Record<string, unknown>;
  return {
    tradeNo: String(data.rentOrderId ?? data.orderId ?? row.rentOrderId ?? row.orderId ?? "").trim(),
    slotNum: Number(data.outSlot ?? row.outSlot),
    batteryId: String(data.outBatteryId ?? row.outBatteryId ?? "").trim(),
  };
}

function configuredCodeSha() {
  const sha = String(Deno.env.get("QUARANTINE_RESOLVER_CODE_SHA") ?? "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

type Evidence = {
  stationId: string;
  proofRentalSessionId: string;
  sourceRentalSessionId: string | null;
  supplierOrderId: string | null;
  supplierTradeNo: string | null;
  commandSentAt: string | null;
  matchingBorrowOutCount: number;
  matchingEventIds: string[];
  releasedSlotNums: number[];
  releasedBatteryIds: string[];
  selectedSlotNum: number | null;
  batteryId: string | null;
  returnedAt: string | null;
  settlementStatus: string | null;
  physicalCommandsGenerated: 0;
};

async function collectEvidence(db: ReturnType<typeof adminClient>): Promise<{ evidence: Evidence; blockers: string[] }> {
  const [{ data: quarantine, error: quarantineError }, { data: rental, error: rentalError }] = await Promise.all([
    db.from("station_hardware_quarantines")
      .select("active,reason_code,source_rental_session_id")
      .eq("station_id", STATION_ID)
      .maybeSingle(),
    db.from("rental_sessions")
      .select("id,station_id,apifox_trade_no,chargenow_order_id,battery_id,selected_slot_num,returned_at,settlement_status")
      .eq("id", PROOF_RENTAL_ID)
      .eq("station_id", STATION_ID)
      .maybeSingle(),
  ]);
  if (quarantineError || rentalError) throw new Error("QUARANTINE_EVIDENCE_READ_FAILED");

  const tradeNo = String(rental?.apifox_trade_no ?? rental?.chargenow_order_id ?? "").trim() || null;
  const selectedSlotNum = Number(rental?.selected_slot_num);
  const batteryId = String(rental?.battery_id ?? "").trim() || null;
  const { data: attempt, error: attemptError } = await db.from("hardware_release_attempts")
    .select("id,result,command_sent_at,released_slot_nums,released_battery_ids")
    .eq("rental_session_id", PROOF_RENTAL_ID)
    .maybeSingle();
  if (attemptError) throw new Error("QUARANTINE_RELEASE_ATTEMPT_READ_FAILED");

  const { data: events, error: eventsError } = attempt?.command_sent_at
    ? await db.from("cabinet_events")
      .select("external_event_id,received_at,payload")
      .eq("station_id", STATION_ID)
      .eq("event_type", "BATTERY_BORROW_OUT")
      .gte("received_at", attempt.command_sent_at)
      .order("received_at", { ascending: true })
      .limit(100)
    : { data: [], error: null };
  if (eventsError) throw new Error("QUARANTINE_BORROW_OUT_READ_FAILED");

  const sameOrder = (events ?? []).filter((event: Record<string, unknown>) => outIdentity(event.payload).tradeNo === tradeNo);
  const matching = sameOrder.filter((event: Record<string, unknown>) => {
    const identity = outIdentity(event.payload);
    return identity.slotNum === selectedSlotNum && identity.batteryId === batteryId;
  });
  const releasedSlotNums = Array.isArray(attempt?.released_slot_nums) ? attempt.released_slot_nums.map(Number) : [];
  const releasedBatteryIds = Array.isArray(attempt?.released_battery_ids) ? attempt.released_battery_ids.map(String) : [];
  const evidence: Evidence = {
    stationId: STATION_ID,
    proofRentalSessionId: PROOF_RENTAL_ID,
    sourceRentalSessionId: typeof quarantine?.source_rental_session_id === "string" ? quarantine.source_rental_session_id : null,
    supplierOrderId: typeof rental?.chargenow_order_id === "string" ? rental.chargenow_order_id : null,
    supplierTradeNo: tradeNo,
    commandSentAt: typeof attempt?.command_sent_at === "string" ? attempt.command_sent_at : null,
    matchingBorrowOutCount: matching.length,
    matchingEventIds: matching.map((event: Record<string, unknown>) => String(event.external_event_id)),
    releasedSlotNums,
    releasedBatteryIds,
    selectedSlotNum: Number.isInteger(selectedSlotNum) ? selectedSlotNum : null,
    batteryId,
    returnedAt: typeof rental?.returned_at === "string" ? rental.returned_at : null,
    settlementStatus: typeof rental?.settlement_status === "string" ? rental.settlement_status : null,
    physicalCommandsGenerated: 0,
  };

  const blockers: string[] = [];
  if (quarantine?.active !== true || quarantine.reason_code !== QUARANTINE_REASON) blockers.push("EXPECTED_QUARANTINE_NOT_ACTIVE");
  if (!rental || !tradeNo || !batteryId || !Number.isInteger(selectedSlotNum) || selectedSlotNum < 1) blockers.push("PROOF_RENTAL_IDENTITY_INVALID");
  if (attempt?.result !== "single_release" || !evidence.commandSentAt) blockers.push("SINGLE_RELEASE_NOT_CONFIRMED");
  if (releasedSlotNums.length !== 1 || releasedSlotNums[0] !== selectedSlotNum) blockers.push("RELEASED_SLOT_MISMATCH");
  if (releasedBatteryIds.length !== 1 || releasedBatteryIds[0] !== batteryId) blockers.push("RELEASED_BATTERY_MISMATCH");
  if (sameOrder.length !== 1 || matching.length !== 1) blockers.push("BORROW_OUT_COUNT_NOT_EXACTLY_ONE");
  if (!evidence.returnedAt) blockers.push("RETURN_NOT_DETECTED");
  if (evidence.settlementStatus !== "settled") blockers.push("SETTLEMENT_NOT_COMPLETED");
  return { evidence, blockers };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireAdmin(req, db);
  if (!actor) return json({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === "resolve" ? "resolve" : body.action === "dry_run" ? "dry_run" : null;
    if (!action) return json({ ok: false, error: "INVALID_ACTION" }, 400);
    if (body.stationId !== undefined && body.stationId !== STATION_ID) return json({ ok: false, error: "STATION_SCOPE_REJECTED" }, 409);
    if (body.proofRentalSessionId !== undefined && body.proofRentalSessionId !== PROOF_RENTAL_ID) {
      return json({ ok: false, error: "PROOF_RENTAL_SCOPE_REJECTED" }, 409);
    }

    const { evidence, blockers } = await collectEvidence(db);
    const evidencePass = blockers.length === 0;
    if (action === "dry_run") {
      return json({
        ok: evidencePass,
        action: "dry_run",
        stationId: STATION_ID,
        evidencePass,
        executionReady: evidencePass && configuredCodeSha() !== null,
        blockers: configuredCodeSha() ? blockers : [...blockers, "QUARANTINE_RESOLVER_CODE_SHA_NOT_CONFIGURED"],
        evidence,
        physicalCommandsGenerated: 0,
        performedProviderMutation: false,
        performedHardwareAction: false,
        performedPaymentAction: false,
      }, evidencePass ? 200 : 409);
    }

    if (body.confirm !== "RESOLVE_DTA21269_SINGLE_SLOT_QUARANTINE") {
      return json({ ok: false, error: "EXPLICIT_CONFIRMATION_REQUIRED", evidence, physicalCommandsGenerated: 0 }, 409);
    }
    if (!evidencePass) return json({ ok: false, error: "QUARANTINE_EVIDENCE_REJECTED", blockers, evidence, physicalCommandsGenerated: 0 }, 409);
    const codeSha = configuredCodeSha();
    if (!codeSha) return json({ ok: false, error: "QUARANTINE_RESOLVER_CODE_SHA_NOT_CONFIGURED", evidence, physicalCommandsGenerated: 0 }, 409);

    const { data, error } = await db.rpc("resolve_dta21269_single_slot_quarantine", {
      p_proof_rental_session_id: PROOF_RENTAL_ID,
      p_resolved_by: actor,
      p_code_sha: codeSha,
      p_resolution_reason: RESOLUTION_REASON,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return json({
      ok: true,
      action: "resolve",
      stationId: STATION_ID,
      evidence,
      resolution: result ?? null,
      physicalCommandsGenerated: 0,
      performedProviderMutation: false,
      performedHardwareAction: false,
      performedPaymentAction: false,
    });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "QUARANTINE_RESOLUTION_FAILED";
    return json({ ok: false, error: code, physicalCommandsGenerated: 0 }, 500);
  }
});
