import { createHash, randomBytes } from "node:crypto";
import { getGuestQuote, getStation } from "./data.mjs";
import { readCabinetSnapshot } from "./cabinetSnapshot.mjs";

const RATE_MAX = 6;
const RATE_WINDOW_SECONDS = 60;
const SESSION_TTL_MINUTES = 20;
const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function snapshotHash(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function publicCode() {
  let code = "";
  while (code.length < 12) {
    for (const byte of randomBytes(32)) {
      if (byte >= 256 - (256 % PUBLIC_CODE_ALPHABET.length)) continue;
      code += PUBLIC_CODE_ALPHABET[byte % PUBLIC_CODE_ALPHABET.length];
      if (code.length === 12) break;
    }
  }
  return `CHG-${code}`;
}

export async function createGuestRentalSession(pool, auth, body, headers) {
  const stationId = auth.stationId;
  const selectedSlotNum = Number(body.selectedSlotNum);
  const language = ["fr", "de", "en"].includes(body.language) ? body.language : "fr";
  if (!Number.isInteger(selectedSlotNum) || selectedSlotNum < 1 || selectedSlotNum > 128) {
    return { ok: false, status: 400, error: "SLOT_SELECTION_REQUIRED" };
  }

  const rawIdempotency = String(headers["x-idempotency-key"] || "").trim();
  if (rawIdempotency.length < 8 || rawIdempotency.length > 128) {
    return { ok: false, status: 400, error: "IDEMPOTENCY_KEY_REQUIRED" };
  }
  const idempotencyKey = `${auth.device.id}:${stationId}:${rawIdempotency}`;
  const existing = await pool.query("select * from rental_sessions where idempotency_key=$1 limit 1", [idempotencyKey]);
  if (existing.rows[0]) return { ok: true, status: 200, session: existing.rows[0], idempotent: true };

  const station = await getStation(pool, stationId);
  if (!station) return { ok: false, status: 404, error: "STATION_NOT_FOUND" };
  if (!station.pilot_enabled) return { ok: false, status: 409, error: "PILOT_STATION_NOT_ENABLED" };
  if (station.status === "maintenance") return { ok: false, status: 409, error: "STATION_MAINTENANCE" };

  const rate = await pool.query(
    `select count(*)::int as count from rental_sessions
      where kiosk_device_id=$1 and station_id=$2 and created_at >= now() - ($3 || ' seconds')::interval`,
    [auth.device.id, stationId, RATE_WINDOW_SECONDS],
  );
  if (Number(rate.rows[0]?.count || 0) >= RATE_MAX) return { ok: false, status: 429, error: "RATE_LIMITED" };

  const cabinet = await readCabinetSnapshot(station.cabinet_id || station.station_id);
  const selectedSlot = cabinet.slots.find((slot) => slot.slot_num === selectedSlotNum);
  if (!selectedSlot?.rentable || !selectedSlot.battery_id) {
    return { ok: false, status: 409, error: "SLOT_NOT_RENTABLE" };
  }

  const quote = await getGuestQuote(pool, stationId);
  if (!quote) return { ok: false, status: 409, error: "PRICING_NOT_CONFIGURED" };
  if (quote.currency !== station.currency) return { ok: false, status: 409, error: "CURRENCY_MISMATCH" };

  const pricingSnapshot = {
    ...quote,
    customer_segment: "guest",
    computed_at: new Date().toISOString(),
    selected_slot_num: selectedSlotNum,
  };
  const pricingSnapshotHash = snapshotHash(pricingSnapshot);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();

  try {
    const inserted = await pool.query(
      `insert into rental_sessions (
         station_id,kiosk_device_id,public_session_code,state,state_version,selected_slot_num,battery_id,
         customer_language,currency,pricing_snapshot,pricing_snapshot_hash,deposit_amount_cents,
         amount_expected,payment_status,idempotency_key,expires_at
       ) values ($1,$2,$3,'created',0,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'not_started',$12,$13)
       returning *`,
      [
        stationId,
        auth.device.id,
        publicCode(),
        selectedSlotNum,
        selectedSlot.battery_id,
        language,
        quote.currency,
        JSON.stringify(pricingSnapshot),
        pricingSnapshotHash,
        quote.deposit_cents,
        quote.deposit_cents / 100,
        idempotencyKey,
        expiresAt,
      ],
    );
    const session = inserted.rows[0];
    void pool.query(
      `insert into audit_logs(action,target,data) values ('kiosk.rental.created',$1,$2::jsonb)`,
      [session.id, JSON.stringify({ station_id: stationId, device_id: auth.device.id, token_fp: auth.tokenFingerprint, selected_slot_num: selectedSlotNum, battery_id: selectedSlot.battery_id, pricing_snapshot_hash: pricingSnapshotHash, customer_segment: "guest" })],
    ).catch(() => undefined);
    return { ok: true, status: 200, session, snapshot: pricingSnapshot, idempotent: false };
  } catch (error) {
    if (error?.code === "23505") {
      const replay = await pool.query("select * from rental_sessions where idempotency_key=$1 limit 1", [idempotencyKey]);
      if (replay.rows[0]) return { ok: true, status: 200, session: replay.rows[0], idempotent: true };
    }
    throw error;
  }
}

export async function publicSessionStatus(pool, sessionId, publicCodeValue) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ""))) return null;
  if (!/^CHG-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,32}$/.test(String(publicCodeValue || ""))) return null;
  const result = await pool.query(
    `select id,state,state_version,selected_slot_num,expires_at,paid_at,ejected_at,returned_at,
            payment_status,failure_code
       from rental_sessions where id=$1 and public_session_code=$2 limit 1`,
    [sessionId, publicCodeValue],
  );
  return result.rows[0] || null;
}
