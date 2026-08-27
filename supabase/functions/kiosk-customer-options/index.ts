// Return kiosk journeys with server-owned pricing and record rental-contract acceptance.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const TERMS_VERSION = "terms-2026-08-26-preproduction-v2";
const PRIVACY_VERSION = "privacy-2026-08-26-preproduction-v2";
const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

type Tier = { upper_minutes: number; total_cents: number };
type Reply = (body: Record<string, unknown>, status?: number) => Response;

function normalizedTiers(snapshot: Record<string, unknown>): Tier[] {
  if (!Array.isArray(snapshot.tiers)) return [];
  return snapshot.tiers
    .map((raw) => {
      const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { upper_minutes: Number(row.upper_minutes), total_cents: Number(row.total_cents) };
    })
    .filter((row) => Number.isInteger(row.upper_minutes) && row.upper_minutes > 0 && Number.isInteger(row.total_cents) && row.total_cents > 0)
    .sort((a, b) => a.upper_minutes - b.upper_minutes);
}

function hourlyCents(snapshot: Record<string, unknown>): number | null {
  if (snapshot.tiered === true) return null;
  const cents = Number(snapshot.price_per_period_cents);
  const minutes = Number(snapshot.period_minutes);
  if (!Number.isFinite(cents) || !Number.isFinite(minutes) || cents < 0 || minutes <= 0) return null;
  return Math.round(cents * 60 / minutes);
}

async function triggerEjection(rentalSessionId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) return { ok: false, status: 0, error: "SUPABASE_INTERNAL_CONFIG_MISSING" };
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/eject-after-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ rentalSessionId }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      error: typeof payload.error === "string" ? payload.error : null,
    };
  } catch {
    return { ok: false, status: 0, error: "EJECT_TRIGGER_UNAVAILABLE" };
  }
}

async function recordContractAcceptance(
  req: Request,
  db: ReturnType<typeof adminClient>,
  body: Record<string, unknown>,
  reply: Reply,
) {
  const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
  const accepted = body.accepted === true;
  const surface = body.acceptanceSurface === "kiosk" ? "kiosk" : "";
  const language = body.language === "de" || body.language === "en" ? body.language : "fr";
  if (!rentalSessionId || !accepted || surface !== "kiosk") {
    return reply({ ok: false, error: "CONTRACT_ACCEPTANCE_REQUIRED" }, 400);
  }

  const { data: session, error: sessionError } = await db.from("rental_sessions")
    .select("id,station_id,kiosk_device_id,state,expires_at,customer_segment,settlement_strategy,settlement_status,contract_terms_version,contract_privacy_version,contract_accepted_at")
    .eq("id", rentalSessionId).maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return reply({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
  if (session.expires_at && Date.parse(session.expires_at) < Date.now()) {
    return reply({ ok: false, error: "SESSION_EXPIRED" }, 410);
  }

  const kiosk = await verifyKioskDevice(req, db, String(session.station_id));
  if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);
  if (String(kiosk.device.id) !== String(session.kiosk_device_id)) {
    return reply({ ok: false, error: "KIOSK_DEVICE_MISMATCH" }, 403);
  }

  const alreadyAccepted = session.contract_terms_version === TERMS_VERSION
    && session.contract_privacy_version === PRIVACY_VERSION
    && Boolean(session.contract_accepted_at);
  const alreadyPrepaid = alreadyAccepted
    && session.customer_segment === "member"
    && session.settlement_strategy === "membership_prepaid"
    && session.settlement_status === "prepaid"
    && session.state === "payment_succeeded";

  if (alreadyPrepaid) {
    const ejection = await triggerEjection(rentalSessionId);
    return reply({
      ok: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt: session.contract_accepted_at,
      prepaidAuthorized: true,
      prepaidReason: "ALREADY_AUTHORIZED",
      ejectionTriggered: ejection.ok,
      ejectionTriggerStatus: ejection.status,
      ejectionTriggerError: ejection.error,
    });
  }

  if (!["created", "checkout_created"].includes(String(session.state))) {
    return reply({ ok: false, error: "SESSION_NOT_ACCEPTING_CONTRACT" }, 409);
  }

  const acceptedAt = new Date().toISOString();
  const { error: updateError } = await db.from("rental_sessions").update({
    contract_terms_version: TERMS_VERSION,
    contract_privacy_version: PRIVACY_VERSION,
    contract_accepted_at: acceptedAt,
    updated_at: acceptedAt,
  }).eq("id", rentalSessionId);
  if (updateError) throw updateError;
  await db.from("audit_logs").insert({
    action: "rental.contract.accepted",
    target: rentalSessionId,
    data: { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, surface, language },
  }).then(() => {}, () => {});

  let prepaidAuthorized = false;
  let prepaidReason = session.customer_segment === "member" ? "PREPAID_NOT_AVAILABLE" : "NOT_MEMBER";
  let reservedCents = 0;
  let ejection = { ok: false, status: 0, error: null as string | null };

  if (session.customer_segment === "member") {
    const { data: prepaidData, error: prepaidError } = await db.rpc("authorize_member_prepaid_rental", {
      p_rental_id: rentalSessionId,
      p_kiosk_device_id: kiosk.device.id,
      p_correlation_id: crypto.randomUUID(),
    });
    if (prepaidError) {
      const message = String(prepaidError.message ?? "");
      if (message.includes("MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED")) {
        prepaidReason = "PREPAID_V3_NOT_AVAILABLE";
      } else if (message.includes("PAYMENT_ALREADY_STARTED") || message.includes("PAYMENT_RAIL_ALREADY_CLAIMED")) {
        prepaidReason = "PAYMENT_RAIL_ALREADY_STARTED";
      } else {
        throw prepaidError;
      }
    } else {
      const result = (Array.isArray(prepaidData) ? prepaidData[0] : prepaidData) as Record<string, unknown> | null;
      prepaidAuthorized = result?.authorized === true;
      prepaidReason = String(result?.reason ?? (prepaidAuthorized ? "AUTHORIZED" : "PREPAID_NOT_AVAILABLE"));
      reservedCents = Number(result?.reserved_cents ?? 0);
      if (prepaidAuthorized) ejection = await triggerEjection(rentalSessionId);
    }
  }

  return reply({
    ok: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt,
    prepaidAuthorized,
    prepaidReason,
    reservedCents,
    prepaidCurrency: prepaidAuthorized ? "CHF" : null,
    ejectionTriggered: prepaidAuthorized ? ejection.ok : false,
    ejectionTriggerStatus: prepaidAuthorized ? ejection.status : null,
    ejectionTriggerError: prepaidAuthorized ? ejection.error : null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply: Reply = (body, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const db = adminClient();

    if (body.rentalSessionId !== undefined || body.acceptanceSurface !== undefined) {
      return await recordContractAcceptance(req, db, body, reply);
    }

    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) return reply({ ok: false, error: "INVALID_STATION" }, 400);

    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);

    const { data: station, error: stationError } = await db
      .from("stations")
      .select("station_id,currency,status")
      .eq("station_id", stationId)
      .maybeSingle();
    if (stationError) throw stationError;
    if (!station) return reply({ ok: false, error: "STATION_NOT_FOUND" }, 404);

    const now = new Date().toISOString();
    const quote = async (segment: "guest" | "member") => {
      const { data, error } = await db.rpc("compute_customer_pricing_snapshot", {
        p_station: stationId,
        p_segment: segment,
        p_start: now,
        p_end: null,
        p_rental_state: "quote",
        p_return_state: "normal",
        p_currency: null,
      });
      if (error || !data) return null;
      const snapshot = data as Record<string, unknown>;
      const tiers = normalizedTiers(snapshot);
      return {
        segment,
        currency: String(snapshot.currency ?? station.currency ?? "CHF"),
        tiered: snapshot.tiered === true,
        tiers,
        starting_cents: Number(snapshot.final_cents ?? tiers[0]?.total_cents ?? 0),
        hourly_cents: hourlyCents(snapshot),
        period_minutes: Number(snapshot.period_minutes ?? 0),
        price_per_period_cents: Number(snapshot.price_per_period_cents ?? 0),
        daily_cap_cents: Number(snapshot.daily_cap_cents ?? 0),
        total_cap_cents: Number(snapshot.total_cap_cents ?? 0),
        deposit_cents: Number(snapshot.deposit_cents ?? 0),
        unreturned_after_minutes: Number(snapshot.unreturned_after_minutes ?? 0),
        unreturned_fee_cents: Number(snapshot.unreturned_fee_cents ?? 0),
        profile_name: String(snapshot.profile_name ?? ""),
        pricing_rules_version: Number(snapshot.pricing_rules_version ?? 0),
      };
    };

    const [guest, member, planResult] = await Promise.all([
      quote("guest"),
      quote("member"),
      db.from("customer_membership_plans")
        .select("id,code,name,currency,annual_fee_cents,renewal_credit_cents,hourly_cents,daily_cap_cents,valid_from,valid_to")
        .eq("active", true)
        .lte("valid_from", now)
        .or(`valid_to.is.null,valid_to.gte.${now}`)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!guest) return reply({ ok: false, error: "GUEST_PRICING_NOT_CONFIGURED" }, 409);
    if (planResult.error) throw planResult.error;

    const p = planResult.data;
    const membershipPlan = p ? {
      id: p.id,
      code: p.code,
      name: p.name,
      currency: p.currency,
      annual_fee_cents: Number(p.annual_fee_cents ?? 0),
      renewal_credit_cents: Number(p.renewal_credit_cents ?? 0),
      hourly_cents: Number(p.hourly_cents ?? member?.hourly_cents ?? 0),
      daily_cap_cents: Number(p.daily_cap_cents ?? member?.daily_cap_cents ?? 0),
      valid_from: p.valid_from,
      valid_to: p.valid_to,
    } : null;

    return reply({ ok: true, guest, member, memberAvailable: Boolean(member), membershipPlan });
  } catch (error) {
    console.error("kiosk-customer-options", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "KIOSK_CUSTOMER_OPTIONS_FAILED" }, 500);
  }
});