// sync-cabinet-status — pulls REAL cabinet/slot/battery state from ChargeNow
// and updates the database. No mock data: if the API is not configured or a
// station is unreachable, the station is marked unknown/offline.
//
// Authorization:
// - admins may synchronize one station or all stations;
// - a provisioned kiosk may synchronize only the station bound to its token.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin, verifyKioskDevice } from "../_shared/db.ts";
import {
  cabinetQuery,
  isChargeNowConfigured,
  type ApiResult,
} from "../_shared/chargenow.ts";
import {
  parseChargeNowCabinetStatus,
  type ParsedCabinetStatus,
} from "../_shared/chargenowStatus.ts";

const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
});

type ProviderAttempt = {
  transport: "primary_get";
  endpoint: string;
  result: ApiResult;
  parsed: ParsedCabinetStatus | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function businessCode(data: unknown): string | number | null {
  if (!isRecord(data) || data.code === undefined || data.code === null) return null;
  return typeof data.code === "number" || typeof data.code === "string" ? data.code : null;
}

// Some ChargeNow deployments serialize the documented business code 0 as "0".
// Treat that as success without weakening any non-zero business-code failure.
function isEffectiveSuccess(result: ApiResult): boolean {
  if (result.ok) return true;
  const code = businessCode(result.data);
  return result.status >= 200 && result.status < 300 && String(code ?? "").trim() === "0";
}

function usableAttempt(attempt: ProviderAttempt): boolean {
  return isEffectiveSuccess(attempt.result) && Boolean(attempt.parsed?.recognized);
}

function sanitizedAttempt(attempt: ProviderAttempt) {
  return {
    transport: attempt.transport,
    status: attempt.result.status,
    businessCode: businessCode(attempt.result.data),
    recognized: attempt.parsed?.recognized ?? false,
    error: attempt.result.error,
  };
}

function stableProviderError(attempts: ProviderAttempt[]): string {
  if (attempts.some((attempt) => [401, 403].includes(attempt.result.status))) {
    return "CHARGENOW_AUTH_REJECTED";
  }
  if (attempts.some((attempt) => attempt.result.status === 404)) {
    return "CHARGENOW_DEVICE_NOT_FOUND";
  }
  if (attempts.some((attempt) => isEffectiveSuccess(attempt.result) && !attempt.parsed?.recognized)) {
    return "CHARGENOW_RESPONSE_UNRECOGNIZED";
  }
  return attempts.at(-1)?.result.error ?? "CHARGENOW_UNREACHABLE";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const requestedHeaders = req.headers.get("Access-Control-Request-Headers")?.trim();
    return new Response("ok", {
      headers: {
        ...functionCorsHeaders,
        ...(requestedHeaders ? { "Access-Control-Allow-Headers": requestedHeaders } : {}),
      },
    });
  }
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : undefined;

    const adminId = await requireAdmin(req, db);
    if (!adminId) {
      // Kiosks are fail-closed and station-bound. A kiosk can never request the
      // all-stations branch and cannot impersonate another cabinet.
      if (!stationId) return json({ ok: false, error: "KIOSK_STATION_REQUIRED" }, 400);
      const auth = await verifyKioskDevice(req, db, stationId);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    }

    if (!isChargeNowConfigured()) {
      return json({ ok: false, configured: false, error: "CHARGENOW_NOT_CONFIGURED" });
    }

    const query = db.from("stations").select("station_id, cabinet_id");
    const { data: stations, error: stationError } = stationId
      ? await query.eq("station_id", stationId)
      : await query;

    if (stationError) return json({ ok: false, configured: true, error: "STATION_QUERY_FAILED" }, 500);
    if (stationId && !(stations ?? []).length) {
      return json({ ok: false, configured: true, error: "STATION_NOT_FOUND" }, 404);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const st of stations ?? []) {
      const deviceId = (st.cabinet_id as string) || (st.station_id as string);
      const attempts: ProviderAttempt[] = [];

      const primaryResult = await cabinetQuery(deviceId);
      const primaryAttempt: ProviderAttempt = {
        transport: "primary_get",
        endpoint: "/rent/cabinet/query",
        result: primaryResult,
        parsed: primaryResult.data == null ? null : parseChargeNowCabinetStatus(primaryResult.data),
      };
      attempts.push(primaryAttempt);
      await logApi(db, {
        service: "chargenow", endpoint: primaryAttempt.endpoint, method: "GET",
        status_code: primaryResult.status, request: { deviceId }, response: primaryResult.data, error: primaryResult.error,
      });

      const chosen = attempts.find(usableAttempt);
      const providerReachable = attempts.some((attempt) => attempt.result.status > 0);

      if (!chosen?.parsed) {
        const syncedAt = new Date().toISOString();
        const error = stableProviderError(attempts);
        await db.from("stations").update({
          // Do not rewrite last_sync_at here: it means the last *confirmed*
          // cabinet snapshot. A supplier timeout or contradictory response is
          // diagnostic information, not proof that the physical cabinet died.
          status: "unknown", online: false,
          provider_last_error_at: syncedAt,
          provider_last_error: error,
        }).eq("station_id", st.station_id);
        results.push({
          stationId: st.station_id,
          ok: false,
          configured: true,
          providerReachable,
          stateKnown: false,
          error,
          attempts: attempts.map(sanitizedAttempt),
          syncedAt,
        });
        continue;
      }

      const parsed = chosen.parsed;
      const syncedAt = new Date().toISOString();
      const status = parsed.online === true ? "online" : parsed.online === false ? "offline" : "unknown";
      const online = parsed.online === true;
      const total = parsed.totalCount ?? 0;
      const rentable = parsed.rentableCount;
      const returnable = parsed.returnableCount ?? 0;

      await db.from("stations").update({
        status,
        online,
        provider_shop_id: parsed.providerShopId ?? undefined,
        // Preserve the provider's human-readable location when it is known;
        // local shop/partner linkage remains an explicit admin decision.
        location_name: parsed.providerShopAddress ?? parsed.providerShopName ?? undefined,
        signal: parsed.signal,
        rentable_count: rentable,
        returnable_count: returnable,
        total_count: total,
        last_sync_at: syncedAt,
        provider_last_success_at: syncedAt,
        provider_last_error_at: null,
        provider_last_error: null,
        raw_data: parsed.payload,
      }).eq("station_id", st.station_id);

      // Upsert one slot row per battery currently present.
      const observedSlots = new Set<number>();
      for (const battery of parsed.batteries) {
        if (battery.slotNum == null || !battery.batteryId) continue;
        observedSlots.add(battery.slotNum);
        await db.from("slots").upsert({
          station_id: st.station_id,
          slot_num: battery.slotNum,
          status: "occupied",
          battery_id: battery.batteryId,
          raw_data: battery.raw,
        }, { onConflict: "station_id,slot_num" });
        await db.from("batteries").upsert({
          battery_id: battery.batteryId,
          station_id: st.station_id,
          slot_num: battery.slotNum,
          status: "in_station",
          power_level: battery.powerLevel,
          raw_data: battery.raw,
        }, { onConflict: "battery_id" });
      }

      // Reconcile slots that were occupied in the previous snapshot but are
      // absent from the provider response. ChargeNow reports present
      // batteries only; without this cleanup, a battery removed by a customer
      // could remain falsely visible in the public inventory indefinitely.
      const { data: previousSlots } = await db
        .from("slots")
        .select("slot_num, battery_id")
        .eq("station_id", st.station_id);
      for (const previous of previousSlots ?? []) {
        if (observedSlots.has(previous.slot_num)) continue;
        await db.from("slots")
          .update({ status: "available", battery_id: null, raw_data: null })
          .eq("station_id", st.station_id)
          .eq("slot_num", previous.slot_num);
        if (previous.battery_id) {
          await db.from("batteries")
            .update({ station_id: null, slot_num: null, status: "unknown" })
            .eq("battery_id", previous.battery_id);
        }
      }

      results.push({
        stationId: st.station_id,
        ok: true,
        configured: true,
        providerReachable: true,
        stateKnown: parsed.online !== null,
        online: parsed.online,
        status,
        rentableCount: rentable,
        returnableCount: returnable,
        totalCount: total,
        signal: parsed.signal,
        transport: chosen.transport,
        attempts: attempts.map(sanitizedAttempt),
        syncedAt,
      });
    }

    return json({ ok: true, configured: true, results });
  } catch (e) {
    console.error("sync-cabinet-status failed", e instanceof Error ? e.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
