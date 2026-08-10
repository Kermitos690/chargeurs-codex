import { createHash, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

const supabaseUrl = required("SUPABASE_URL");
const serviceRole = required("SUPABASE_SERVICE_ROLE_KEY");
const email = required("STAGING_ADMIN_EMAIL").toLowerCase();
const stationId = process.env.STAGING_STATION_ID?.trim() || "DTA21269";

if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(supabaseUrl)) {
  throw new Error("STAGING_SUPABASE_URL_INVALID");
}
if (stationId !== "DTA21269") throw new Error("PILOT_STATION_REQUIRED");

const client = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let owner = null;
for (let page = 1; page <= 10 && !owner; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error("AUTH_USER_LIST_FAILED");
  owner = data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 100) break;
}
if (!owner) throw new Error("STAGING_OWNER_NOT_FOUND");

const { data: station, error: stationError } = await client
  .from("stations")
  .select("station_id,name,organization_id,organization:organizations(slug,legal_name)")
  .eq("station_id", stationId)
  .single();
if (stationError || !station?.organization_id) throw new Error("PILOT_STATION_NOT_READY");

const organization = Array.isArray(station.organization)
  ? station.organization[0]
  : station.organization;
if (organization?.slug !== "chargeurs-ch") throw new Error("OWNER_ORGANIZATION_MISMATCH");

// `randomInt` is cryptographically secure and preserves leading zeroes after
// padding. This script prints the value exactly once for the physical tablet.
const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
const codeHash = createHash("sha256").update(code).digest("hex");
const ttlMinutes = Number(process.env.STAGING_PAIRING_TTL_MINUTES ?? 10);
if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 15) {
  throw new Error("STAGING_PAIRING_TTL_INVALID");
}
const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

// Match the back-office safety property: a renewal makes every unused code
// for this station unusable before the new code is issued. This fallback is
// intended only for controlled staging recovery, not routine administration.
const { error: invalidateError } = await client
  .from("kiosk_pairing_codes")
  .update({ used_at: new Date().toISOString() })
  .eq("station_id", station.station_id)
  .is("used_at", null);
if (invalidateError) throw new Error("PAIRING_CODE_INVALIDATION_FAILED");

const { data: pairing, error: pairingError } = await client
  .from("kiosk_pairing_codes")
  .insert({
    station_id: station.station_id,
    organization_id: station.organization_id,
    label: "Tablette pilote staging",
    code_hash: codeHash,
    expires_at: expiresAt,
    created_by: owner.id,
  })
  .select("id,created_at,expires_at,used_at,used_by_device_id")
  .single();
if (pairingError || !pairing) throw new Error("PAIRING_CODE_CREATION_FAILED");

const { error: auditError } = await client.from("audit_logs").insert({
  actor: owner.id,
  action: "kiosk.pairing_code.created",
  target: pairing.id,
  data: { station_id: station.station_id, expires_at: pairing.expires_at },
});
if (auditError) throw new Error("PAIRING_AUDIT_FAILED");

console.log(JSON.stringify({
  ok: true,
  code,
  stationId: station.station_id,
  stationName: station.name,
  organization: organization.legal_name,
  createdAt: pairing.created_at,
  expiresAt: pairing.expires_at,
  used: pairing.used_at !== null || pairing.used_by_device_id !== null,
}));
