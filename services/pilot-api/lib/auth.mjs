import { createHash } from "node:crypto";

const KIOSK_TOKEN_MIN_LEN = 24;

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export async function verifyKioskDevice(pool, headers, stationId) {
  const token = String(headers["x-kiosk-token"] || "").trim();
  if (!token || token.length < KIOSK_TOKEN_MIN_LEN) {
    return { ok: false, status: 401, error: "KIOSK_AUTH_REQUIRED" };
  }

  const hash = sha256Hex(token);
  const tokenFingerprint = hash.slice(0, 12);
  const result = await pool.query(
    `select id, station_id, active, token_revoked, token_expires_at, label
       from kiosk_devices
      where token_hash = $1
      limit 1`,
    [hash],
  );
  const device = result.rows[0];
  if (!device) return { ok: false, status: 401, error: "KIOSK_AUTH_INVALID" };

  const expired = device.token_expires_at && new Date(device.token_expires_at).getTime() < Date.now();
  if (!device.active || device.token_revoked || expired) {
    return { ok: false, status: 403, error: "KIOSK_DEVICE_DISABLED" };
  }
  if (device.station_id !== stationId) {
    return { ok: false, status: 403, error: "KIOSK_STATION_MISMATCH" };
  }

  void pool.query(
    "update kiosk_devices set last_seen_at = now(), updated_at = now() where id = $1",
    [device.id],
  ).catch(() => undefined);

  return { ok: true, device, tokenFingerprint };
}
