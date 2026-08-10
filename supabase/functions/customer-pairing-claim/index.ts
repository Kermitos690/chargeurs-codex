// Claim a kiosk pairing from the authenticated Chargeurs customer account.
// verify_jwt must remain enabled on deployment; the function also validates the
// JWT server-side and requires a confirmed email before exposing member pricing.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog } from "../_shared/db.ts";
import { pairingTokenHash, validPairingToken } from "../_shared/customerPairing.ts";

const CLAIMED_PAIRING_TTL_MS = 5 * 60 * 1000;

type MembershipPlan = {
  id: string;
  code: string;
  name: string;
  currency: string;
  hourly_cents: number;
  daily_cap_cents: number;
  included_minutes: number | null;
  renewal_credit_cents: number;
  active: boolean;
  valid_from: string;
  valid_to: string | null;
};

function activeAt(row: { starts_at?: string | null; ends_at?: string | null }, nowMs: number) {
  const starts = row.starts_at ? Date.parse(row.starts_at) : -Infinity;
  const ends = row.ends_at ? Date.parse(row.ends_at) : Infinity;
  return starts <= nowMs && ends > nowMs;
}

function planFromRelation(value: unknown): MembershipPlan | null {
  if (Array.isArray(value)) return (value[0] as MembershipPlan | undefined) ?? null;
  return value && typeof value === "object" ? value as MembershipPlan : null;
}

function planActiveAt(plan: MembershipPlan | null, nowMs: number) {
  if (!plan?.active) return false;
  const starts = plan.valid_from ? Date.parse(plan.valid_from) : -Infinity;
  const ends = plan.valid_to ? Date.parse(plan.valid_to) : Infinity;
  return starts <= nowMs && ends > nowMs;
}

async function activeMembership(db: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await db.from("customer_memberships")
    .select("id,plan_id,status,starts_at,renews_at,ends_at,customer_membership_plans(id,code,name,currency,hourly_cents,daily_cap_cents,included_minutes,renewal_credit_cents,active,valid_from,valid_to)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  const nowMs = Date.now();
  for (const row of data ?? []) {
    const plan = planFromRelation(row.customer_membership_plans);
    if (activeAt(row, nowMs) && planActiveAt(plan, nowMs)) return { ...row, plan };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return reply({ ok: false, error: "AUTH_REQUIRED" }, 401);

    const db = adminClient();
    const { data: userData, error: userError } = await db.auth.getUser(jwt);
    const user = userData.user;
    if (userError || !user) return reply({ ok: false, error: "AUTH_INVALID" }, 401);
    if (!user.email_confirmed_at) return reply({ ok: false, error: "EMAIL_CONFIRMATION_REQUIRED" }, 403);

    const membership = await activeMembership(db, user.id);
    if (!membership?.plan) {
      await auditLog(db, {
        actor: user.id,
        action: "customer.pairing.membership_required",
        data: { correlation_id: correlationId },
      });
      return reply({ ok: false, error: "MEMBERSHIP_REQUIRED", passPath: "/compte/pass" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const token = body.token;
    if (!validPairingToken(token)) return reply({ ok: false, error: "PAIRING_TOKEN_INVALID" }, 400);
    const tokenHash = await pairingTokenHash(token);

    const { data: current, error: readError } = await db.from("customer_pairing_sessions")
      .select("id,station_id,kiosk_device_id,customer_user_id,state,segment,expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return reply({ ok: false, error: "PAIRING_NOT_FOUND" }, 404);

    if (Date.parse(current.expires_at) <= Date.now()) {
      if (current.state === "pending") {
        await db.from("customer_pairing_sessions").update({ state: "expired", updated_at: new Date().toISOString() }).eq("id", current.id);
      }
      return reply({ ok: false, error: "PAIRING_EXPIRED" }, 410);
    }

    const memberSummary = {
      planCode: membership.plan.code,
      planName: membership.plan.name,
      currency: membership.plan.currency,
      hourlyCents: membership.plan.hourly_cents,
      dailyCapCents: membership.plan.daily_cap_cents,
      includedMinutes: membership.plan.included_minutes,
      renewalCreditCents: membership.plan.renewal_credit_cents,
      renewsAt: membership.renews_at ?? null,
    };

    if (current.state === "claimed" && current.customer_user_id === user.id) {
      return reply({ ok: true, pairingId: current.id, stationId: current.station_id, segment: "member", member: memberSummary, idempotent: true });
    }
    if (current.state !== "pending") return reply({ ok: false, error: "PAIRING_NOT_CLAIMABLE" }, 409);

    const now = new Date().toISOString();
    const claimedExpiresAt = new Date(Date.now() + CLAIMED_PAIRING_TTL_MS).toISOString();
    const { data: claimed, error: claimError } = await db.from("customer_pairing_sessions").update({
      customer_user_id: user.id,
      state: "claimed",
      segment: "member",
      claimed_at: now,
      expires_at: claimedExpiresAt,
      updated_at: now,
    }).eq("id", current.id)
      .eq("state", "pending")
      .is("customer_user_id", null)
      .gt("expires_at", now)
      .select("id,station_id,segment,expires_at")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return reply({ ok: false, error: "PAIRING_ALREADY_CLAIMED" }, 409);

    await auditLog(db, {
      actor: user.id,
      action: "customer.pairing.claimed",
      target: claimed.id,
      data: {
        station_id: claimed.station_id,
        kiosk_device_id: current.kiosk_device_id,
        segment: "member",
        membership_id: membership.id,
        membership_plan_id: membership.plan.id,
        expires_at: claimed.expires_at,
        correlation_id: correlationId,
      },
    });

    return reply({
      ok: true,
      pairingId: claimed.id,
      stationId: claimed.station_id,
      segment: "member",
      expiresAt: claimed.expires_at,
      member: memberSummary,
    });
  } catch (error) {
    console.error("customer-pairing-claim", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "PAIRING_CLAIM_FAILED" }, 500);
  }
});
