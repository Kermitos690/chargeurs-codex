// Kiosk-safe polling for account pairing. No email, auth token or user UUID is
// returned to the public screen; only a display first name and safe plan fields.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

function safeFirstName(value: unknown): string {
  if (typeof value !== "string") return "Client";
  const trimmed = value.trim().replace(/[<>]/g, "").slice(0, 80);
  if (!trimmed) return "Client";
  return trimmed.split(/\s+/)[0].slice(0, 32);
}

function relationOne(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as Record<string, unknown> : null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

async function safeMemberSummary(db: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await db.from("customer_memberships")
    .select("id,status,starts_at,renews_at,ends_at,customer_membership_plans(code,name,currency,hourly_cents,daily_cap_cents,included_minutes,renewal_credit_cents,active,valid_from,valid_to)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  const nowMs = Date.now();
  for (const row of data ?? []) {
    const starts = row.starts_at ? Date.parse(row.starts_at) : -Infinity;
    const ends = row.ends_at ? Date.parse(row.ends_at) : Infinity;
    if (!(starts <= nowMs && ends > nowMs)) continue;
    const plan = relationOne(row.customer_membership_plans);
    if (!plan || plan.active !== true) continue;
    const planStart = plan.valid_from ? Date.parse(String(plan.valid_from)) : -Infinity;
    const planEnd = plan.valid_to ? Date.parse(String(plan.valid_to)) : Infinity;
    if (!(planStart <= nowMs && planEnd > nowMs)) continue;

    const { data: walletPass } = await db.from("customer_wallet_passes")
      .select("status,provider_status")
      .eq("user_id", userId)
      .eq("membership_id", row.id)
      .maybeSingle();

    return {
      planCode: String(plan.code ?? ""),
      planName: String(plan.name ?? "Client Chargeurs"),
      currency: String(plan.currency ?? "CHF"),
      hourlyCents: Number(plan.hourly_cents ?? 0),
      dailyCapCents: Number(plan.daily_cap_cents ?? 0),
      includedMinutes: plan.included_minutes == null ? null : Number(plan.included_minutes),
      renewalCreditCents: Number(plan.renewal_credit_cents ?? 0),
      renewsAt: row.renews_at ?? null,
      walletPassActive: walletPass?.status === "active",
      walletProviderStatus: walletPass?.provider_status ?? "not_issued",
    };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const pairingId = typeof body.pairingId === "string" ? body.pairingId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId) || !/^[0-9a-f-]{36}$/i.test(pairingId)) {
      return reply({ ok: false, error: "PAIRING_STATUS_INVALID" }, 400);
    }

    const db = adminClient();
    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);

    const { data: pairing, error } = await db.from("customer_pairing_sessions")
      .select("id,station_id,kiosk_device_id,customer_user_id,state,segment,expires_at,claimed_at,consumed_at")
      .eq("id", pairingId)
      .eq("station_id", stationId)
      .eq("kiosk_device_id", kiosk.device.id)
      .maybeSingle();
    if (error) throw error;
    if (!pairing) return reply({ ok: false, error: "PAIRING_NOT_FOUND" }, 404);

    if (Date.parse(pairing.expires_at) <= Date.now() && pairing.state === "pending") {
      await db.from("customer_pairing_sessions").update({ state: "expired", updated_at: new Date().toISOString() }).eq("id", pairing.id);
      return reply({ ok: true, state: "expired", connected: false, expiresAt: pairing.expires_at });
    }

    if (!["claimed", "consumed"].includes(pairing.state) || !pairing.customer_user_id) {
      return reply({ ok: true, state: pairing.state, connected: false, expiresAt: pairing.expires_at });
    }

    const [{ data: profile }, member] = await Promise.all([
      db.from("profiles").select("display_name,preferred_language").eq("id", pairing.customer_user_id).maybeSingle(),
      safeMemberSummary(db, pairing.customer_user_id),
    ]);

    // A member pairing may only have been claimed after an active membership
    // check. Recheck here so the public kiosk never displays stale benefits.
    if (pairing.segment === "member" && !member) {
      return reply({ ok: true, state: "membership_required", connected: false, expiresAt: pairing.expires_at });
    }

    return reply({
      ok: true,
      state: pairing.state,
      connected: true,
      displayName: safeFirstName(profile?.display_name),
      preferredLanguage: profile?.preferred_language ?? null,
      segment: pairing.segment,
      member,
      expiresAt: pairing.expires_at,
    });
  } catch (error) {
    console.error("customer-pairing-status", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "PAIRING_STATUS_FAILED" }, 500);
  }
});
