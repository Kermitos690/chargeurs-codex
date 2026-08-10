import { adminClient, auditLog } from "../_shared/db.ts";
import { accountDeletionBlocked, safeDeletedEmail } from "../_shared/accountPrivacy.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function claimVerifiedEmailRentals(db: ReturnType<typeof adminClient>, user: { id: string; email?: string | null }) {
  if (!user.email) return;
  const { data: unlinked, error: selectError } = await db
    .from("rental_sessions")
    .select("id")
    .is("customer_user_id", null)
    .eq("customer_email", user.email);
  if (selectError) throw new Error("RENTAL_LINK_LOOKUP_FAILED");
  const ids = (unlinked ?? []).map((rental) => String(rental.id));
  if (ids.length === 0) return;
  const { error: claimError } = await db
    .from("rental_sessions")
    .update({ customer_user_id: user.id })
    .in("id", ids);
  if (claimError) throw new Error("RENTAL_LINK_FAILED");
}

async function customerData(db: ReturnType<typeof adminClient>, user: { id: string; email?: string | null }) {
  await claimVerifiedEmailRentals(db, user);

  const [rentalsResult, profileResult, membershipResult, walletResult, pointsResult] = await Promise.all([
    db.from("rental_sessions").select("*").eq("customer_user_id", user.id),
    db.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    db.from("customer_memberships")
      .select("id,status,starts_at,renews_at,ends_at,plan_id,cancel_at_period_end,stripe_current_period_start,stripe_current_period_end,customer_membership_plans(id,code,name,currency,annual_fee_cents,renewal_credit_cents,hourly_cents,daily_cap_cents,billing_interval,billing_interval_count,included_minutes,discount_percent)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("customer_wallet_passes")
      .select("id,membership_id,public_pass_id,status,provider_status,pass_revision,token_version,apple_serial_number,google_object_id,last_generated_at,last_synced_at,revoked_at,created_at,updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("customer_chargepoints_balances").select("balance,last_activity_at").eq("user_id", user.id).maybeSingle(),
  ]);

  if (rentalsResult.error) throw new Error("RENTALS_UNAVAILABLE");
  if (membershipResult.error) throw new Error("MEMBERSHIP_UNAVAILABLE");
  if (walletResult.error) throw new Error("WALLET_PASS_UNAVAILABLE");
  if (pointsResult.error) throw new Error("CHARGEPOINTS_UNAVAILABLE");

  const rentals = rentalsResult.data ?? [];
  const rentalIds = rentals.map((rental) => String(rental.id));
  let payments: unknown[] = [];
  let refunds: unknown[] = [];
  let incidents: unknown[] = [];

  if (rentalIds.length > 0) {
    const [paymentsResult, refundsResult, incidentsResult] = await Promise.all([
      db.from("payments").select("id,rental_session_id,provider,amount,currency,payment_method,status,created_at").in("rental_session_id", rentalIds),
      db.from("refunds").select("id,rental_session_id,amount,currency,status,reason,created_at,updated_at").in("rental_session_id", rentalIds),
      db.from("system_incidents").select("id,rental_session_id,type,severity,resolved,created_at,resolved_at").in("rental_session_id", rentalIds),
    ]);
    if (paymentsResult.error || refundsResult.error || incidentsResult.error) throw new Error("ACCOUNT_RELATED_DATA_UNAVAILABLE");
    payments = paymentsResult.data ?? [];
    refunds = refundsResult.data ?? [];
    incidents = incidentsResult.data ?? [];
  }

  // Deliberately omit Stripe customer/subscription/checkout IDs and Wallet token hashes.
  return {
    profile: profileResult.data ?? null,
    rentals,
    payments,
    refunds,
    incidents,
    membership: membershipResult.data ?? null,
    walletPass: walletResult.data ?? null,
    chargePoints: {
      balance: Number(pointsResult.data?.balance ?? 0),
      lastActivityAt: pointsResult.data?.last_activity_at ?? null,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = adminClient();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email_confirmed_at) return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "summary");

  if (action === "summary" || action === "export") {
    let data: Awaited<ReturnType<typeof customerData>>;
    try {
      data = await customerData(db, user);
    } catch {
      return json({ ok: false, error: "ACCOUNT_DATA_UNAVAILABLE" }, 500);
    }
    await auditLog(db, { actor: user.id, action: action === "export" ? "account.exported" : "account.summary_viewed", target: user.id });
    return json({ ok: true, generatedAt: new Date().toISOString(), data });
  }

  if (action === "delete") {
    if (body.confirmation !== "DELETE_ACCOUNT") return json({ ok: false, error: "CONFIRMATION_REQUIRED" }, 400);
    let data: Awaited<ReturnType<typeof customerData>>;
    try {
      data = await customerData(db, user);
    } catch {
      return json({ ok: false, error: "ACCOUNT_DATA_UNAVAILABLE" }, 500);
    }
    const states = data.rentals.map((rental) => String(rental.state));
    if (accountDeletionBlocked(states)) return json({ ok: false, error: "ACTIVE_OR_UNSETTLED_RENTAL" }, 409);

    await db.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", user.id);
    const anonymizedEmail = safeDeletedEmail(user.id);
    if (data.rentals.length > 0) {
      const rentalIds = data.rentals.map((rental) => String(rental.id));
      const { error: rentalError } = await db.from("rental_sessions").update({
        customer_user_id: null,
        customer_email: anonymizedEmail,
      }).in("id", rentalIds);
      if (rentalError) return json({ ok: false, error: "ANONYMIZATION_FAILED" }, 500);
    }

    await auditLog(db, { actor: user.id, action: "account.deleted", target: user.id, data: { rentalsAnonymized: data.rentals.length } });
    const { error: deleteError } = await db.auth.admin.deleteUser(user.id);
    if (deleteError) return json({ ok: false, error: "ACCOUNT_DELETE_FAILED" }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
});
