// create-rental-session — starts a rental from the kiosk.
//
// SECURITY MODEL (fail-closed):
//  - The caller MUST present a valid kiosk credential in the `X-Kiosk-Token`
//    header (never in the URL, never logged raw). It is hashed server-side and
//    matched against kiosk_devices.token_hash.
//  - The device must be active, not revoked, not expired, and STRICTLY bound to
//    the requested station (kiosk_devices.station_id == stationId). Local lock,
//    cabinet id in the URL and localStorage are NEVER an authorization.
//  - The authoritative station is the one stored on the kiosk_devices record.
//  - The price/currency/profile/status/payment-state are resolved 100% server
//    side via public.compute_pricing(). Any amount sent by the client is ignored.
//  - Rate limiting per (device, station) blocks automated mass creation.
//  - An idempotency key (header `X-Idempotency-Key`) dedupes double-tap, retries
//    and concurrent calls (DB unique index enforces single session).
//  - Stale unpaid sessions are expired lazily (no hardware / no payment effect).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, snapshotHash, verifyKioskDevice } from "../_shared/db.ts";
import { createRentalPublicCode } from "../_shared/rentalPublicCode.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";

// Anti-spam: at most N session creations per device+station in WINDOW seconds.
const RATE_MAX = 6;
const RATE_WINDOW_SEC = 60;
// A created/checkout session is considered abandoned after this delay.
const SESSION_TTL_MIN = 20;
// The kiosk token and idempotency key are deliberately sent as request
// headers, never embedded in a URL or body. They must also be explicitly
// allowed for a browser/WebView preflight; otherwise the browser blocks the
// request before this function can return its safe, correlated error response.
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

  // Normalized, redacted refusal logger. NEVER logs the raw token.
  const refuse = async (
    status: number,
    error: string,
    extra: Record<string, unknown> = {},
  ) => {
    await auditLog(db, {
      action: "kiosk.rental.refused",
      target: (extra.station_id as string) ?? null,
      data: { reason: error, status, correlation_id: correlationId, duration_ms: Date.now() - startedAt, ...extra },
    });
    return json({ ok: false, error }, status);
  };

  try {
    let payload: { stationId?: string; language?: string; selectedSlotNum?: number };
    try {
      payload = await req.json();
    } catch {
      return refuse(400, "MISSING_STATION");
    }
    const stationId = typeof payload.stationId === "string" ? payload.stationId.trim() : "";
    const language = typeof payload.language === "string" ? payload.language.slice(0, 8) : "fr";
    const selectedSlotNum = Number(payload.selectedSlotNum);
    if (!stationId || !/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) {
      return refuse(400, "MISSING_STATION");
    }
    if (!Number.isInteger(selectedSlotNum) || selectedSlotNum < 1 || selectedSlotNum > 128) {
      return refuse(400, "SLOT_SELECTION_REQUIRED", { station_id: stationId });
    }

    // ---- 1. Kiosk authentication + strict station binding (fail-closed) ----
    const auth = await verifyKioskDevice(req, db, stationId);
    if (!auth.ok) {
      return refuse(auth.status, auth.error, { station_id: stationId });
    }
    const device = auth.device;
    const fingerprint = auth.tokenFingerprint;

    // ---- 2. Lazy cleanup of abandoned sessions (no side effects) ----
    await db.rpc("expire_stale_rental_sessions").then(() => {}, () => {});

    // ---- 3. Idempotency: stable key bound to device + station + intent ----
    // The key is supplied by the kiosk; same key + same station => same session.
    const rawIdem = (req.headers.get("X-Idempotency-Key") ?? "").trim();
    const idempotencyKey = rawIdem && rawIdem.length >= 8 && rawIdem.length <= 128
      ? `${device.id}:${stationId}:${rawIdem}`
      : null;

    if (idempotencyKey) {
      const { data: existing } = await db
        .from("rental_sessions")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
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

    // ---- 4. Rate limiting per (device, station) ----
    const sinceIso = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString();
    const { count: recentCount } = await db
      .from("rental_sessions")
      .select("id", { count: "exact", head: true })
      .eq("kiosk_device_id", device.id)
      .eq("station_id", stationId)
      .gte("created_at", sinceIso);
    if ((recentCount ?? 0) >= RATE_MAX) {
      return refuse(429, "RATE_LIMITED", { station_id: stationId, device_id: device.id, recent: recentCount });
    }

    // ---- 5. Business validation: station known, active, has stock ----
    const { data: station } = await db.from("stations").select("*").eq("station_id", stationId).maybeSingle();
    if (!station) return refuse(404, "STATION_NOT_FOUND", { station_id: stationId });
    if (station.status === "maintenance") {
      return refuse(409, "STATION_MAINTENANCE", { station_id: stationId });
    }
    // ---- 5b. A client choice is never enough to select physical hardware. ----
    // Re-read C4/C7/C8/O1 at the point of reservation and accept the chosen
    // slot only when independent supplier observations agree it is rentable.
    // This prevents a stale UI, slot 0, or a conflicting provider payload from
    // silently becoming an ambiguous ejection request later in the flow.
    if (!isChargeNowConfigured()) {
      return refuse(409, "CHARGENOW_NOT_CONFIGURED", { station_id: stationId });
    }
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

    // ---- 6. Authoritative server-side pricing (single source of truth) ----
    // This RPC enriches the quote with every rule required to settle the
    // rental later without consulting a mutable profile assignment.
    const { data: snapshot, error: priceErr } = await db.rpc("compute_rental_pricing_snapshot", {
      p_device: device.id,
      p_station: stationId,
      p_shop: station.shop_id ?? null,
      p_start: new Date().toISOString(),
      p_end: null,
      p_rental_state: "created",
      p_return_state: "normal",
      p_currency: station.currency ?? null,
    });
    if (priceErr || !snapshot) {
      const msg = String(priceErr?.message ?? "");
      const code = msg.includes("PRICING_NOT_CONFIGURED")
        ? "PRICING_NOT_CONFIGURED"
        : msg.includes("CURRENCY_MISMATCH")
        ? "CURRENCY_MISMATCH"
        : "PRICING_ERROR";
      return refuse(409, code, { station_id: stationId });
    }

    const snap = snapshot as Record<string, unknown>;
    const finalCents = Number(snap.final_cents ?? 0);
    if (!Number.isFinite(finalCents) || finalCents <= 0) {
      return refuse(409, "PRICING_NOT_CONFIGURED", { station_id: stationId });
    }
    const amount = finalCents / 100;
    const currency = String(snap.currency ?? station.currency ?? "CHF");
    const hash = await snapshotHash(snap);
    const cabinetId = station.cabinet_id || station.station_id;
    const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000).toISOString();

    // ---- 7. Insert. Unique idempotency index enforces single session ----
    const { data: session, error: insErr } = await db.from("rental_sessions").insert({
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
      customer_language: language,
      idempotency_key: idempotencyKey,
      expires_at: expiresAt,
    }).select().single();

    if (insErr) {
      // 23505 = unique violation on idempotency_key => a concurrent request won.
      if ((insErr as { code?: string }).code === "23505" && idempotencyKey) {
        const { data: existing } = await db
          .from("rental_sessions")
          .select("*")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existing) {
          return json({ ok: true, session: existing, snapshot: existing.pricing_snapshot, idempotent: true });
        }
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
        price_profile_id: snap.profile_id,
        price_profile_version: snap.profile_version,
        source: snap.source,
        final_cents: finalCents,
        currency,
        selected_slot_num: selectedSlotNum,
        selected_battery_present: selectedSlot.battery_present === true,
        selected_snapshot_confidence: selectedSlot.confidence,
        pricing_snapshot_hash: hash,
        duration_ms: Date.now() - startedAt,
      },
    });

    // The ChargeNow rent order + ejection happen ONLY after confirmed payment.
    return json({ ok: true, session, snapshot: snap });
  } catch (e) {
    await auditLog(db, {
      action: "kiosk.rental.error",
      data: { reason: "INTERNAL_ERROR", correlation_id: correlationId, message: String((e as Error)?.message ?? e) },
    });
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
