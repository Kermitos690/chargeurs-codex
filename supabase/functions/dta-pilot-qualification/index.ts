import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { adminClient, auditLog, logApi, requireAdmin } from "../_shared/db.ts";
import {
  areChargeNowMutationsEnabled,
  cabinetQuery,
  cabinetQueryPost,
  chargeNowMode,
  ejectByRent,
  isChargeNowConfigured,
  orderCreate,
  type ApiResult,
} from "../_shared/chargenow.ts";
import { parseChargeNowCabinetStatus, type ParsedCabinetStatus } from "../_shared/chargenowStatus.ts";
import {
  choosePilotBattery,
  DTA_PILOT_STATION_ID,
  extractProviderOrderIdentity,
  extractProviderReleaseIdentity,
  providerResultSucceeded,
  reconcileQualificationRun,
  safeProviderError,
} from "../_shared/dtaPilot.ts";
import { buildDtaPilotCallbackUrl } from "../_shared/dtaPilotCallbackAuth.ts";

const responseHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: responseHeaders,
});

type ProviderAttempt = {
  transport: "primary_get" | "alternate_post";
  result: ApiResult;
  parsed: ParsedCabinetStatus | null;
};

type RunRow = {
  id: string;
  station_id: string;
  mode: string;
  state: string;
  requested_slot_num: number | null;
  expected_battery_id: string | null;
  observed_slot_num: number | null;
  observed_battery_id: string | null;
  provider_trade_no: string | null;
  provider_order_id: string | null;
  command_sent_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function usable(attempt: ProviderAttempt): boolean {
  return providerResultSucceeded(attempt.result) && Boolean(attempt.parsed?.recognized);
}

function sanitizedAttempt(attempt: ProviderAttempt) {
  return {
    transport: attempt.transport,
    status: attempt.result.status,
    businessCode: isRecord(attempt.result.data) && attempt.result.data.code != null
      ? String(attempt.result.data.code)
      : null,
    recognized: attempt.parsed?.recognized ?? false,
    error: attempt.result.error,
  };
}

async function fetchPilotStatus(db: SupabaseClient) {
  const attempts: ProviderAttempt[] = [];
  const primary = await cabinetQuery(DTA_PILOT_STATION_ID);
  attempts.push({
    transport: "primary_get",
    result: primary,
    parsed: primary.data == null ? null : parseChargeNowCabinetStatus(primary.data),
  });
  await logApi(db, {
    service: "chargenow",
    endpoint: "/rent/cabinet/query",
    method: "GET",
    status_code: primary.status,
    request: { deviceId: DTA_PILOT_STATION_ID, purpose: "battery_qualification" },
    response: primary.data,
    error: primary.error,
  });

  if (!usable(attempts[0])) {
    const alternate = await cabinetQueryPost(DTA_PILOT_STATION_ID);
    attempts.push({
      transport: "alternate_post",
      result: alternate,
      parsed: alternate.data == null ? null : parseChargeNowCabinetStatus(alternate.data),
    });
    await logApi(db, {
      service: "chargenow-alt",
      endpoint: "/rent/cabinet/query",
      method: "POST",
      status_code: alternate.status,
      request: { deviceId: DTA_PILOT_STATION_ID, purpose: "battery_qualification" },
      response: alternate.data,
      error: alternate.error,
    });
  }

  const selected = attempts.find(usable) ?? null;
  if (selected?.parsed) {
    return { parsed: selected.parsed, attempts, transport: selected.transport, error: null as string | null };
  }
  const error = attempts.some((attempt) => [401, 403].includes(attempt.result.status))
    ? "CHARGENOW_AUTH_REJECTED"
    : attempts.some((attempt) => attempt.result.status === 404)
    ? "CHARGENOW_DEVICE_NOT_FOUND"
    : attempts.some((attempt) => providerResultSucceeded(attempt.result) && !attempt.parsed?.recognized)
    ? "CHARGENOW_RESPONSE_UNRECOGNIZED"
    : safeProviderError(attempts.at(-1)?.result.error, "CHARGENOW_UNREACHABLE");
  return { parsed: null, attempts, transport: null, error };
}

async function persistPilotStatus(db: SupabaseClient, parsed: ParsedCabinetStatus) {
  const observedAt = new Date().toISOString();
  const status = parsed.online === true ? "online" : parsed.online === false ? "offline" : "unknown";
  const { error: stationError } = await db.from("stations").update({
    status,
    online: parsed.online === true,
    signal: parsed.signal,
    rentable_count: parsed.rentableCount,
    returnable_count: parsed.returnableCount ?? 0,
    total_count: parsed.totalCount ?? 0,
    last_sync_at: observedAt,
    raw_data: parsed.payload,
  }).eq("station_id", DTA_PILOT_STATION_ID);
  if (stationError) throw stationError;

  const presentBatteryIds = new Set<string>();
  const occupiedSlots = new Set<number>();
  for (const battery of parsed.batteries) {
    if (!battery.batteryId || battery.slotNum == null || battery.slotNum < 1) continue;
    presentBatteryIds.add(battery.batteryId);
    occupiedSlots.add(battery.slotNum);

    const { error: slotError } = await db.from("slots").upsert({
      station_id: DTA_PILOT_STATION_ID,
      slot_num: battery.slotNum,
      status: "occupied",
      battery_id: battery.batteryId,
      raw_data: battery.raw,
    }, { onConflict: "station_id,slot_num" });
    if (slotError) throw slotError;

    const { error: batteryError } = await db.from("batteries").upsert({
      battery_id: battery.batteryId,
      station_id: DTA_PILOT_STATION_ID,
      slot_num: battery.slotNum,
      status: "in_station",
      power_level: battery.powerLevel,
      raw_data: battery.raw,
    }, { onConflict: "battery_id" });
    if (batteryError) throw batteryError;

    await db.from("batteries").update({ qualification_status: "inventory_seen" })
      .eq("battery_id", battery.batteryId)
      .eq("qualification_status", "untested");

    const { error: observationError } = await db.from("battery_observations").insert({
      battery_id: battery.batteryId,
      station_id: DTA_PILOT_STATION_ID,
      slot_num: battery.slotNum,
      source: "chargenow_status",
      provider_metric_kind: "unknown",
      provider_metric_value: battery.powerLevel,
      raw_data: battery.raw,
    });
    if (observationError) throw observationError;
  }

  const { data: currentBatteries, error: currentBatteryError } = await db.from("batteries")
    .select("battery_id")
    .eq("station_id", DTA_PILOT_STATION_ID);
  if (currentBatteryError) throw currentBatteryError;
  for (const row of currentBatteries ?? []) {
    if (presentBatteryIds.has(String(row.battery_id))) continue;
    await db.from("batteries").update({
      station_id: null,
      slot_num: null,
      status: "out_of_station",
    }).eq("battery_id", row.battery_id);
  }

  const { data: currentSlots, error: slotListError } = await db.from("slots")
    .select("slot_num")
    .eq("station_id", DTA_PILOT_STATION_ID);
  if (slotListError) throw slotListError;
  for (const row of currentSlots ?? []) {
    const slotNum = Number(row.slot_num);
    if (!Number.isInteger(slotNum) || occupiedSlots.has(slotNum)) continue;
    await db.from("slots").update({ status: "empty", battery_id: null })
      .eq("station_id", DTA_PILOT_STATION_ID)
      .eq("slot_num", slotNum);
  }
  return observedAt;
}

async function dashboard(db: SupabaseClient) {
  const [station, slots, batteries, runs] = await Promise.all([
    db.from("stations")
      .select("station_id,cabinet_id,name,status,online,signal,rentable_count,returnable_count,total_count,last_sync_at,environment,is_pilot,qualification_mode,qualification_updated_at")
      .eq("station_id", DTA_PILOT_STATION_ID)
      .maybeSingle(),
    db.from("slots")
      .select("slot_num,status,battery_id,raw_data")
      .eq("station_id", DTA_PILOT_STATION_ID)
      .order("slot_num"),
    db.from("batteries")
      .select("battery_id,station_id,slot_num,status,power_level,model_code,rated_capacity_mah,measured_capacity_mah,measured_energy_wh,qualification_status,capacity_confidence,commercial_tier,pricing_eligible,qualified_at,quarantine_reason,updated_at")
      .order("battery_id"),
    db.from("hardware_qualification_runs")
      .select("*")
      .eq("station_id", DTA_PILOT_STATION_ID)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (station.error) throw station.error;
  if (slots.error) throw slots.error;
  if (batteries.error) throw batteries.error;
  if (runs.error) throw runs.error;

  const batteryRows = batteries.data ?? [];
  const completedIds = new Set((runs.data ?? [])
    .filter((run) => run.state === "completed")
    .map((run) => String(run.observed_battery_id ?? run.expected_battery_id ?? ""))
    .filter(Boolean));
  return {
    station: station.data,
    slots: slots.data ?? [],
    batteries: batteryRows,
    runs: runs.data ?? [],
    campaign: {
      inventoryCount: batteryRows.length,
      physicallyCycledCount: completedIds.size,
      externallyVerifiedCount: batteryRows.filter((battery) => battery.capacity_confidence === "externally_measured").length,
      labelVerifiedCount: batteryRows.filter((battery) => battery.capacity_confidence === "label_verified").length,
      pricingEligibleCount: batteryRows.filter((battery) => battery.pricing_eligible === true).length,
      quarantinedCount: batteryRows.filter((battery) => battery.qualification_status === "quarantined").length,
    },
    guards: {
      fixedStationId: DTA_PILOT_STATION_ID,
      providerConfigured: isChargeNowConfigured(),
      providerMode: chargeNowMode(),
      providerMutationsEnabled: areChargeNowMutationsEnabled(),
      freePayEnvironmentEnabled: Deno.env.get("DTA21269_FREEPAY_ENABLED") === "true",
      stripeUsed: false,
    },
  };
}

async function loadPilotStation(db: SupabaseClient) {
  const { data, error } = await db.from("stations")
    .select("station_id,cabinet_id,environment,is_pilot,qualification_mode")
    .eq("station_id", DTA_PILOT_STATION_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireAdmin(req, db);
  if (!actor) return json({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "status";

    if (action === "status") return json({ ok: true, ...(await dashboard(db)) });

    const station = await loadPilotStation(db);
    if (!station) return json({ ok: false, error: "PILOT_STATION_NOT_FOUND" }, 404);
    if (!station.is_pilot || station.environment === "production") {
      return json({ ok: false, error: "PILOT_STATION_GUARD_REJECTED" }, 409);
    }

    if (action === "set_mode") {
      const mode = body.mode === "freepay_test" ? "freepay_test" : body.mode === "read_only" ? "read_only" : null;
      if (!mode) return json({ ok: false, error: "INVALID_QUALIFICATION_MODE" }, 400);
      if (mode === "freepay_test") {
        if (Deno.env.get("DTA21269_FREEPAY_ENABLED") !== "true") {
          return json({ ok: false, error: "FREEPAY_ENVIRONMENT_GATE_DISABLED" }, 409);
        }
        if (chargeNowMode() !== "test") return json({ ok: false, error: "CHARGENOW_TEST_MODE_REQUIRED" }, 409);
      }
      const { error } = await db.from("stations").update({
        qualification_mode: mode,
        qualification_updated_at: new Date().toISOString(),
        qualification_updated_by: actor,
      }).eq("station_id", DTA_PILOT_STATION_ID);
      if (error) throw error;
      await auditLog(db, {
        actor,
        action: "hardware.qualification.mode_changed",
        target: DTA_PILOT_STATION_ID,
        data: { mode },
      });
      return json({ ok: true, ...(await dashboard(db)) });
    }

    if (action === "sync") {
      const result = await fetchPilotStatus(db);
      if (!result.parsed) {
        return json({ ok: false, error: result.error, attempts: result.attempts.map(sanitizedAttempt) }, 502);
      }
      const syncedAt = await persistPilotStatus(db, result.parsed);
      await auditLog(db, {
        actor,
        action: "hardware.qualification.status_synced",
        target: DTA_PILOT_STATION_ID,
        data: {
          syncedAt,
          transport: result.transport,
          online: result.parsed.online,
          rentableCount: result.parsed.rentableCount,
          returnableCount: result.parsed.returnableCount,
        },
      });
      return json({ ok: true, syncedAt, attempts: result.attempts.map(sanitizedAttempt), ...(await dashboard(db)) });
    }

    if (action === "start_freepay") {
      if (station.qualification_mode !== "freepay_test") return json({ ok: false, error: "FREEPAY_MODE_NOT_ACTIVE" }, 409);
      if (Deno.env.get("DTA21269_FREEPAY_ENABLED") !== "true") return json({ ok: false, error: "FREEPAY_ENVIRONMENT_GATE_DISABLED" }, 409);
      if (!isChargeNowConfigured()) return json({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }, 503);
      if (chargeNowMode() !== "test") return json({ ok: false, error: "CHARGENOW_TEST_MODE_REQUIRED" }, 409);
      if (!areChargeNowMutationsEnabled()) return json({ ok: false, error: "CHARGENOW_MUTATIONS_DISABLED" }, 409);

      const { data: activeRun, error: activeError } = await db.from("hardware_qualification_runs")
        .select("id,state")
        .eq("station_id", DTA_PILOT_STATION_ID)
        .in("state", ["created", "inventory_confirmed", "order_created", "ejection_requested", "ejection_confirmed", "battery_taken", "needs_reconciliation"])
        .maybeSingle();
      if (activeError) throw activeError;
      if (activeRun) return json({ ok: false, error: "QUALIFICATION_RUN_ALREADY_ACTIVE", run: activeRun }, 409);

      const provider = await fetchPilotStatus(db);
      if (!provider.parsed) return json({ ok: false, error: provider.error, attempts: provider.attempts.map(sanitizedAttempt) }, 502);
      if (provider.parsed.online !== true) return json({ ok: false, error: "PILOT_STATION_NOT_ONLINE" }, 409);
      await persistPilotStatus(db, provider.parsed);

      const requestedSlot = body.slotNum == null ? null : Number(body.slotNum);
      if (requestedSlot != null && (!Number.isInteger(requestedSlot) || requestedSlot < 1 || requestedSlot > 128)) {
        return json({ ok: false, error: "VALID_SLOT_REQUIRED" }, 400);
      }

      const { data: alreadyCycledRows, error: cycledError } = await db.from("hardware_qualification_runs")
        .select("expected_battery_id,observed_battery_id")
        .eq("station_id", DTA_PILOT_STATION_ID)
        .eq("state", "completed");
      if (cycledError) throw cycledError;
      const excluded = requestedSlot == null
        ? new Set((alreadyCycledRows ?? []).flatMap((row) => [row.observed_battery_id, row.expected_battery_id]).filter(Boolean).map(String))
        : new Set<string>();
      const selected = choosePilotBattery(provider.parsed, requestedSlot, excluded);
      if (!selected?.batteryId || selected.slotNum == null) {
        return json({
          ok: false,
          error: requestedSlot == null ? "NO_UNTESTED_RENTABLE_BATTERY" : "REQUESTED_SLOT_NOT_RENTABLE",
        }, 409);
      }

      const { data: run, error: runError } = await db.from("hardware_qualification_runs").insert({
        station_id: DTA_PILOT_STATION_ID,
        mode: "freepay_test",
        state: "inventory_confirmed",
        requested_slot_num: selected.slotNum,
        expected_battery_id: selected.batteryId,
        initial_snapshot: provider.parsed.payload,
        latest_snapshot: provider.parsed.payload,
        started_by: actor,
      }).select("*").single();
      if (runError) throw runError;

      const runId = String(run.id);
      await db.from("battery_observations").insert({
        battery_id: selected.batteryId,
        station_id: DTA_PILOT_STATION_ID,
        slot_num: selected.slotNum,
        qualification_run_id: runId,
        source: "chargenow_status",
        provider_metric_kind: "unknown",
        provider_metric_value: selected.powerLevel,
        raw_data: selected.raw,
        created_by: actor,
      });

      const callbackURL = await buildDtaPilotCallbackUrl(Deno.env.get("SUPABASE_URL") ?? "", runId);
      const order = await orderCreate({ deviceId: DTA_PILOT_STATION_ID, callbackURL });
      const orderIdentity = extractProviderOrderIdentity(order.data);
      await logApi(db, {
        service: "chargenow",
        endpoint: "/rent/order/create",
        method: "POST",
        status_code: order.status,
        request: { deviceId: DTA_PILOT_STATION_ID, purpose: "freepay_battery_qualification", runId },
        response: { ok: providerResultSucceeded(order), ...orderIdentity },
        error: order.error,
      });
      if (!providerResultSucceeded(order) || !orderIdentity.tradeNo) {
        const code = safeProviderError(order.error, "CHARGENOW_ORDER_FAILED");
        await db.from("hardware_qualification_runs").update({
          state: "failed",
          failure_code: code,
          failure_message: "La commande FreePay n'a pas atteint la phase d'éjection.",
          provider_order_response: order.data,
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ ok: false, error: code, runId }, 502);
      }

      const commandSentAt = new Date().toISOString();
      await db.from("hardware_qualification_runs").update({
        state: "ejection_requested",
        provider_trade_no: orderIdentity.tradeNo,
        provider_order_id: orderIdentity.orderId,
        provider_order_response: order.data,
        command_sent_at: commandSentAt,
        updated_at: commandSentAt,
      }).eq("id", runId);

      const ejection = await ejectByRent(
        String(station.cabinet_id ?? DTA_PILOT_STATION_ID),
        selected.slotNum,
        orderIdentity.tradeNo,
      );
      const release = extractProviderReleaseIdentity(ejection.data);
      const mismatch = release.batteryId != null && release.batteryId !== selected.batteryId;
      const nextState = providerResultSucceeded(ejection) && !mismatch ? "ejection_confirmed" : "needs_reconciliation";
      const code = mismatch
        ? "EJECTED_BATTERY_MISMATCH"
        : providerResultSucceeded(ejection)
        ? null
        : safeProviderError(ejection.error, "EJECTION_UNCONFIRMED");
      await logApi(db, {
        service: "chargenow",
        endpoint: "/cabinet/ejectByRent",
        method: "POST",
        status_code: ejection.status,
        request: {
          cabinetId: station.cabinet_id ?? DTA_PILOT_STATION_ID,
          slotNum: selected.slotNum,
          tradeNo: orderIdentity.tradeNo,
          purpose: "freepay_battery_qualification",
          runId,
        },
        response: { ok: providerResultSucceeded(ejection), batteryId: release.batteryId, slotNum: release.slotNum },
        error: code,
      });
      await db.from("hardware_qualification_runs").update({
        state: nextState,
        observed_battery_id: release.batteryId ?? selected.batteryId,
        observed_slot_num: release.slotNum ?? selected.slotNum,
        provider_ejection_response: ejection.data,
        ejection_confirmed_at: nextState === "ejection_confirmed" ? new Date().toISOString() : null,
        failure_code: code,
        failure_message: code ? "La commande matérielle a été envoyée; une réconciliation physique est obligatoire." : null,
        updated_at: new Date().toISOString(),
      }).eq("id", runId);
      await db.from("battery_observations").insert({
        battery_id: release.batteryId ?? selected.batteryId,
        station_id: DTA_PILOT_STATION_ID,
        slot_num: release.slotNum ?? selected.slotNum,
        qualification_run_id: runId,
        source: "ejection_response",
        provider_metric_kind: "unknown",
        raw_data: isRecord(ejection.data) ? ejection.data : {},
        created_by: actor,
      });
      await auditLog(db, {
        actor,
        action: "hardware.qualification.freepay_requested",
        target: runId,
        data: {
          station_id: DTA_PILOT_STATION_ID,
          expected_battery_id: selected.batteryId,
          requested_slot_num: selected.slotNum,
          provider_trade_no: orderIdentity.tradeNo,
          state: nextState,
        },
      });
      return json({
        ok: nextState === "ejection_confirmed",
        requiresPhysicalCheck: true,
        runId,
        state: nextState,
        expectedBatteryId: selected.batteryId,
        requestedSlotNum: selected.slotNum,
        observedBatteryId: release.batteryId,
        observedSlotNum: release.slotNum,
        error: code,
      }, nextState === "ejection_confirmed" ? 200 : 202);
    }

    if (action === "reconcile") {
      const runId = typeof body.runId === "string" ? body.runId : "";
      if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ ok: false, error: "VALID_RUN_REQUIRED" }, 400);
      const { data: run, error: runError } = await db.from("hardware_qualification_runs")
        .select("*")
        .eq("id", runId)
        .eq("station_id", DTA_PILOT_STATION_ID)
        .maybeSingle();
      if (runError) throw runError;
      if (!run) return json({ ok: false, error: "QUALIFICATION_RUN_NOT_FOUND" }, 404);

      const provider = await fetchPilotStatus(db);
      if (!provider.parsed) return json({ ok: false, error: provider.error, attempts: provider.attempts.map(sanitizedAttempt) }, 502);
      await persistPilotStatus(db, provider.parsed);
      const decision = reconcileQualificationRun(run as RunRow, provider.parsed);
      const now = new Date().toISOString();
      const update: Record<string, unknown> = {
        state: decision.state,
        observed_battery_id: decision.observedBatteryId,
        observed_slot_num: decision.observedSlotNum,
        latest_snapshot: provider.parsed.payload,
        failure_code: decision.state === "needs_reconciliation" ? decision.reason : null,
        failure_message: decision.state === "needs_reconciliation" ? "L'état physique ne correspond pas encore au cycle attendu." : null,
        updated_at: now,
      };
      if (decision.state === "completed") {
        update.return_confirmed_at = now;
        update.completed_at = now;
      }
      const { error: updateError } = await db.from("hardware_qualification_runs").update(update).eq("id", runId);
      if (updateError) throw updateError;

      const batteryId = decision.observedBatteryId ?? run.observed_battery_id ?? run.expected_battery_id;
      if (batteryId && decision.state === "completed") {
        await db.from("batteries").update({
          qualification_status: "provisional",
          capacity_confidence: "provider_only",
          pricing_eligible: false,
          station_id: DTA_PILOT_STATION_ID,
          slot_num: decision.observedSlotNum,
          status: "in_station",
        }).eq("battery_id", batteryId);
        const returned = provider.parsed.batteries.find((battery) => battery.batteryId === batteryId);
        await db.from("battery_observations").insert({
          battery_id: batteryId,
          station_id: DTA_PILOT_STATION_ID,
          slot_num: decision.observedSlotNum,
          qualification_run_id: runId,
          source: "return_event",
          provider_metric_kind: "unknown",
          provider_metric_value: returned?.powerLevel ?? null,
          raw_data: returned?.raw ?? {},
          created_by: actor,
        });
      }
      await auditLog(db, {
        actor,
        action: "hardware.qualification.reconciled",
        target: runId,
        data: { state: decision.state, reason: decision.reason, battery_id: batteryId },
      });
      return json({ ok: decision.state !== "needs_reconciliation", decision, ...(await dashboard(db)) }, decision.state === "needs_reconciliation" ? 202 : 200);
    }

    if (action === "record_measurement") {
      const batteryId = typeof body.batteryId === "string" ? body.batteryId.trim() : "";
      const method = typeof body.method === "string" ? body.method : "";
      const allowedMethods = new Set(["provider_cycle", "label_verification", "usb_load_meter", "bench_discharge"]);
      if (!batteryId || !allowedMethods.has(method)) return json({ ok: false, error: "VALID_MEASUREMENT_REQUIRED" }, 400);
      const ratedCapacityMah = body.ratedCapacityMah == null ? null : Number(body.ratedCapacityMah);
      const measuredCapacityMah = body.measuredCapacityMah == null ? null : Number(body.measuredCapacityMah);
      const measuredEnergyWh = body.measuredEnergyWh == null ? null : Number(body.measuredEnergyWh);
      if (ratedCapacityMah != null && (!Number.isInteger(ratedCapacityMah) || ratedCapacityMah <= 0)) return json({ ok: false, error: "INVALID_RATED_CAPACITY" }, 400);
      if (measuredCapacityMah != null && (!Number.isInteger(measuredCapacityMah) || measuredCapacityMah <= 0)) return json({ ok: false, error: "INVALID_MEASURED_CAPACITY" }, 400);
      if (["usb_load_meter", "bench_discharge"].includes(method) && measuredCapacityMah == null && measuredEnergyWh == null) {
        return json({ ok: false, error: "EXTERNAL_MEASUREMENT_VALUE_REQUIRED" }, 400);
      }
      const { data: battery, error: batteryError } = await db.from("batteries")
        .select("battery_id")
        .eq("battery_id", batteryId)
        .maybeSingle();
      if (batteryError) throw batteryError;
      if (!battery) return json({ ok: false, error: "BATTERY_NOT_FOUND" }, 404);

      const external = ["usb_load_meter", "bench_discharge"].includes(method);
      const confidence = external ? "externally_measured" : method === "label_verification" ? "label_verified" : "provider_only";
      const qualificationStatus = external ? "verified" : "provisional";
      const { error: cycleError } = await db.from("battery_test_cycles").insert({
        battery_id: batteryId,
        qualification_run_id: typeof body.runId === "string" ? body.runId : null,
        method,
        state: "completed",
        started_at: typeof body.startedAt === "string" ? body.startedAt : null,
        ended_at: typeof body.endedAt === "string" ? body.endedAt : new Date().toISOString(),
        delivered_capacity_mah: measuredCapacityMah,
        delivered_energy_wh: measuredEnergyWh,
        meter_reference: typeof body.meterReference === "string" ? body.meterReference.slice(0, 200) : null,
        notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : null,
        verified_by: actor,
      });
      if (cycleError) throw cycleError;
      const { error: updateError } = await db.from("batteries").update({
        model_code: typeof body.modelCode === "string" ? body.modelCode.slice(0, 120) : null,
        rated_capacity_mah: ratedCapacityMah,
        measured_capacity_mah: measuredCapacityMah,
        measured_energy_wh: measuredEnergyWh,
        qualification_status: qualificationStatus,
        capacity_confidence: confidence,
        pricing_eligible: false,
        qualified_at: external ? new Date().toISOString() : null,
        qualified_by: actor,
      }).eq("battery_id", batteryId);
      if (updateError) throw updateError;
      await db.from("battery_observations").insert({
        battery_id: batteryId,
        station_id: DTA_PILOT_STATION_ID,
        source: external ? "external_meter" : "label_entry",
        provider_metric_kind: "unknown",
        measured_capacity_mah: measuredCapacityMah,
        measured_energy_wh: measuredEnergyWh,
        raw_data: { method, modelCode: body.modelCode ?? null, ratedCapacityMah, meterReference: body.meterReference ?? null },
        created_by: actor,
      });
      await auditLog(db, {
        actor,
        action: "battery.capacity.measurement_recorded",
        target: batteryId,
        data: { method, ratedCapacityMah, measuredCapacityMah, measuredEnergyWh, confidence },
      });
      return json({ ok: true, ...(await dashboard(db)) });
    }

    if (action === "quarantine") {
      const batteryId = typeof body.batteryId === "string" ? body.batteryId.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
      if (!batteryId || !reason) return json({ ok: false, error: "BATTERY_AND_REASON_REQUIRED" }, 400);
      const { error } = await db.from("batteries").update({
        qualification_status: "quarantined",
        commercial_tier: "quarantine",
        pricing_eligible: false,
        quarantine_reason: reason,
        qualified_at: new Date().toISOString(),
        qualified_by: actor,
      }).eq("battery_id", batteryId);
      if (error) throw error;
      await auditLog(db, { actor, action: "battery.quarantined", target: batteryId, data: { reason } });
      return json({ ok: true, ...(await dashboard(db)) });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("dta pilot qualification failed", error instanceof Error ? error.name : "UNKNOWN");
    return json({ ok: false, error: "DTA_PILOT_QUALIFICATION_INTERNAL_ERROR" }, 500);
  }
});
