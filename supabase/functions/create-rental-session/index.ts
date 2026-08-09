// create-rental-session — starts a rental from the kiosk.
//
// SECURITY MODEL (fail-closed):
//  - kiosk identity is authenticated by X-Kiosk-Token and station-bound;
//  - customer identity is NEVER accepted as a user id from the kiosk. A member
//    rental requires a short-lived pairing previously claimed by a verified
//    Chargeurs account;
//  - guest/member pricing is resolved server-side from that verified segment;
//  - the selected battery is re-read from ChargeNow immediately before the
//    atomic rental + slot reservation;
//  - an active hardware quarantine refuses new rentals before payment.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, snapshotHash, verifyKioskDevice } from "../_shared/db.ts";
import { createRentalPublicCode } from "../_shared/rentalPublicCode.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";

const RATE_MAX = 6;
const RATE_WINDOW_SEC = 60;
const SESSION_TTL_MIN = 20;

const rentalCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-idempotency-key",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: rentalCorsHeaders });
  const startedAt = Date.now();
  const db = adminClient();
  const correlationId = crypto.randomUUID();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify({ ...(body as object), correlationId }), {
      status,
      headers: { ...rentalCorsHeaders, "Content-Type": "application/json", "X-Correlation-Id": correlationId },
    });

  const refuse = async (status: number, error: string, extra: Record<string, unknown> = {}) => {
    await auditLog(db, {
      action: "kiosk.rental.refused",
      target: (extra.station_id as string) ?? null,
      data: { reason: error, status, correlation_id: correlationId, duration_ms: Date.now() - startedAt, ...extra },
    });
    return json({ ok: false, error }, status);
  };

  try {
    let payload: {
      stationId?: string;
      language?: string;
      selectedSlotNum?: number;
      customerPairingId?: string | null;
    };
    try {
      payload = await req.json();
    } catch {
      return refuse(400, "MISSING_STATION");
    }

    const stationId = typeof payload.stationId === "string" ? payload.stationId.trim() : "";
    const language = typeof payload.language === "string" ? payload.language.slice(0, 8) : "fr";
    const selectedSlotNum = Number(payload.selectedSlotNum);
    const requestedPairingId = typeof payload.customerPairingId === "string" ? payload.customerPairingId.trim() : "";

    if (!stationId || !/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) {
      return refuse(400, "MISSING_STATION");
    }
    if (!Number.isInteger(selectedSlotNum) || selectedSlotNum < 1 || selectedSlotNum > 128) {
      return refuse(400, "SLOT_SELECTION_REQUIRED", { station_id: stationId });
    }
    if (requestedPairingId && !/^[0-9a-f-]{36}$/i.test(requestedPairingId)) {
      return refuse(400, "CUSTOMER_PAIRING_INVALID", { station_id: stationId });
    }

    // ---- 1. Kiosk authentication + strict station binding. ----
    const auth = await verifyKioskDevice(req, db, stationId);
    if (!auth.ok) return refuse(auth.status, auth.error, { station_id: stationId });
    const device = auth.device;
    const fingerprint = auth.tokenFingerprint;

    await db.rpc("expire_stale_rental_sessions").then(() => {}, () => {});

    // ---- 2. Idempotency before any new business side effect. ----
    const rawIdem = (req.headers.get("X-Idempotency-Key") ?? "").trim();
    const idempotencyKey = rawIdem && rawIdem.length >= 8 && rawIdem.length <= 128
      ? `${device.id}:${stationId}:${rawIdem}`
      : null;

    if (idempotencyKey) {
      const { data: existing } = await db.from("rental_sessions")
        .select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing) {
        if (existing.station_id !== stationId) {
          return refuse(409, "IDEMPOTENCY_CONFLICT", { station_id: stationId });
        }
        await auditLog(db, {
          action: "kiosk.rental.idempotent_replay",
          target: existing.id,
          data: { station_id: stationId, device_id: device.id, correlation_id: correlationId, token_fp: fingerprint },
        });
        return json({ ok: true, session: existing, snapshot: existing.pricing_snapshot, idempotent: true });
      }
    }

    // ---- 3. Rate limiting. ----
    const sinceIso = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString();
    const { count: recentCount } = await db.from("rental_sessions")
      .select("id", { count: "exact", head: true })
      .eq("kiosk_device_id", device.id)
      .eq("station_id", stationId)
      .gte("created_at", sinceIso);
    if ((recentCount ?? 0) >= RATE_MAX) {
      return refuse(429, "RATE_LIMITED", { station_id: stationId, device_id: device.id, recent: recentCount });
    }

    // ---- 4. Station + physical safety gates. ----
    const { data: station } = await db.from("stations").select("*").eq("station_id", stationId).maybeSingle();
    if (!station) return refuse(404, "STATION_NOT_FOUND", { station_id: stationId });
    if (station.status === "maintenance") return refuse(409, "STATION_MAINTENANCE", { station_id: stationId });

    const { data: quarantine, error: quarantineError } = await db.from("station_hardware_quarantines")
      .select("reason_code")
      .eq("station_id", stationId)
      .eq("active", true)
      .maybeSingle();
    if (quarantineError) throw quarantineError;
    if (quarantine) {
      return refuse(409, "STATION_HARDWARE_QUARANTINED", {
        station_id: stationId,
        quarantine_reason: quarantine.reason_code,
      });
    }

    // ---- 5. Resolve customer journey from a claimed server-side pairing. ----
    let customerSegment: "guest" | "member" = "guest";
    let customerUserId: string | null = null;
    let customerPairingSessionId: string | null = null;

    if (requestedPairingId) {
      const now = new Date().toISOString();
      const { data: pairing, error: pairingError } = await db.from("customer_pairing_sessions")
        .select("id,station_id,kiosk_device_id,customer_user_id,state,segment,expires_at,consumed_at")
        .eq("id", requestedPairingId)
        .eq("station_id", stationId)
        .eq("kiosk_device_id", device.id)
        .eq("state", "claimed")
        .eq("segment", "member")
        .is("consumed_at", null)
        .gt("expires_at", now)
        .maybeSingle();
      if (pairingError) throw pairingError;
      if (!pairing?.customer_user_id) {
        return refuse(409, "CUSTOMER_PAIRING_INVALID", { station_id: stationId });
      }
      customerSegment = "member";
      customerUserId = pairing.customer_user_id;
      customerPairingSessionId = pairing.id;
    }

    // ---- 6. Fresh multi-source hardware qualification. ----
    if (!isChargeNowConfigured()) return refuse(409, "CHARGENOW_NOT_CONFIGURED", { station_id: stationId });
    const liveSnapshot = await readCabinetSnapshot(station.cabinet_id || station.station_id);
    const selectedSlot = liveSnapshot.slots.find((slot) => slot.slot_num === selectedSlotNum);
    if (!selectedSlot?.rentable) {
      return refuse(409, "SLOT_NOT_RENTABLE", {
        station_id: stationId,
        slot_num: selectedSlotNum,
        confidence: selectedSlot?.confidence ?? "none",
        conflict_count: selectedSlot?.conflicts.length ?? 0,
      });
    }

    // ---- 7. Segment-aware server pricing. ----
    const { data: snapshot, error: priceErr } = await db.rpc("compute_customer_pricing_snapshot", {
      p_station: stationId,
      p_segment: customerSegment,
      p_start: new Date().toISOString(),
      p_end: null,
      p_rental_state: "created",
      p_return_state: "normal",
      p_currency: station.currency ?? null,
    });
    if (priceErr || !snapshot) {
      const msg = String(priceErr?.message ?? "");
      const code = msg.includes("PRICING_NOT_CONFIGURED")
        ? customerSegment === "member" ? "MEMBER_PRICING_NOT_CONFIGURED" : "PRICING_NOT_CONFIGURED"
        : msg.includes("CURRENCY_MISMATCH") ? "CURRENCY_MISMATCH" : "PRICING_ERROR";
      return refuse(409, code, { station_id: stationId, customer_segment: customerSegment });
    }

    const snap = snapshot as Record<string, unknown>;
    const finalCents = Number(snap.final_cents ?? 0);
    if (!Number.isFinite(finalCents) || finalCents <= 0) {
      return refuse(409, "PRICING_NOT_CONFIGURED", { station_id: stationId, customer_segment: customerSegment });
    }

    const amount = finalCents / 100;
    const currency = String(snap.currency ?? station.currency ?? "CHF");
    const hash = await snapshotHash(snap);
    const cabinetId = station.cabinet_id || station.station_id;
    const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000).toISOString();

    // ---- 8. Atomic pairing-consume + session + physical-slot reservation. ----
    const reservationPayload = {
      station_id: stationId,
      cabinet_id: cabinetId,
      shop_id: station.shop_id ?? null,
      kiosk_device_id: device.id,
      price_profile_id: snap.profile_id ?? null,
      price_profile_version: snap.profile_version ?? null,
      pricing_snapshot: snap,
      pricing_snapshot_hash: hash,
      state: "created",
      public_session_code: createRentalPublicCode(),
      amount,
      amount_expected: amount,
      currency,
      selected_slot_num: selectedSlotNum,
      battery_id: selectedSlot.battery_id,
      customer_language: language,
      customer_user_id: customerUserId,
      customer_segment: customerSegment,
      customer_pairing_session_id: customerPairingSessionId,
      idempotency_key: idempotencyKey,
      expires_at: expiresAt,
    };

    const { data: session, error: insErr } = await db.rpc("create_reserved_kiosk_rental_session", {
      p_session: reservationPayload,
    });

    if (insErr) {
      if (idempotencyKey) {
        const { data: existing } = await db.from("rental_sessions")
          .select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
        if (existing) return json({ ok: true, session: existing, snapshot: existing.pricing_snapshot, idempotent: true });
      }
      const message = String((insErr as { message?: string })?.message ?? "");
      if (message.includes("SLOT_ALREADY_RESERVED")) {
        return refuse(409, "SLOT_ALREADY_RESERVED", { station_id: stationId, slot_num: selectedSlotNum });
      }
      if (message.includes("CUSTOMER_PAIRING_INVALID") || message.includes("MEMBER_PAIRING_REQUIRED")) {
        return refuse(409, "CUSTOMER_PAIRING_INVALID", { station_id: stationId });
      }
      throw insErr;
    }
    if (!session) throw new Error("INSERT_FAILED");

    await auditLog(db, {
      action: "kiosk.rental.created",
      target: session.id,
      data: {
        station_id: stationId,
        device_id: device.id,
        token_fp: fingerprint,
        correlation_id: correlationId,
        idempotency_present: Boolean(idempotencyKey),
        customer_segment: customerSegment,
        customer_pairing_present: Boolean(customerPairingSessionId),
        price_profile_id: snap.profile_id,
        price_profile_version: snap.profile_version,
        source: snap.source,
        final_cents: finalCents,
        currency,
        selected_slot_num: selectedSlotNum,
        selected_battery_id: selectedSlot.battery_id,
        selected_battery_present: selectedSlot.battery_present === true,
        selected_snapshot_confidence: selectedSlot.confidence,
        pricing_snapshot_hash: hash,
        duration_ms: Date.now() - startedAt,
      },
    });

    return json({ ok: true, session, snapshot: snap, customerSegment });
  } catch (e) {
    await auditLog(db, {
      action: "kiosk.rental.error",
      data: { reason: "INTERNAL_ERROR", correlation_id: correlationId, message: String((e as Error)?.message ?? e) },
    });
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
