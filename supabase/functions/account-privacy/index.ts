import { adminClient, auditLog } from "../_shared/db.ts";
import { accountDeletionBlocked, safeDeletedEmail } from "../_shared/accountPrivacy.ts";
import { handlePassStudioWallet } from "../_shared/passStudioWallet.ts";
import { CHARGEURS_CUSTOM_PASS_ID } from "../_shared/passStudio.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function claimVerifiedEmailRentals(db: ReturnType<typeof adminClient>, user: { id: string; email?: string | null }) {
  if (!user.email) return;
  const { data: unlinked, error: selectError } = await db.from("rental_sessions").select("id").is("customer_user_id", null).eq("customer_email", user.email);
  if (selectError) throw new Error("RENTAL_LINK_LOOKUP_FAILED");
  const ids = (unlinked ?? []).map((rental) => String(rental.id));
  if (!ids.length) return;
  const { error: claimError } = await db.from("rental_sessions").update({ customer_user_id: user.id }).in("id", ids);
  if (claimError) throw new Error("RENTAL_LINK_FAILED");
}

async function customerData(db: ReturnType<typeof adminClient>, user: { id: string; email?: string | null }) {
  await claimVerifiedEmailRentals(db, user);
  const [rentalsResult, profileResult, membershipResult, walletResult, pointsResult, rentalCreditResult] = await Promise.all([
    db.from("rental_sessions").select("*").eq("customer_user_id", user.id),
    db.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    db.from("customer_memberships").select("id,status,starts_at,renews_at,ends_at,plan_id,cancel_at_period_end,stripe_current_period_start,stripe_current_period_end,customer_membership_plans(id,code,name,currency,annual_fee_cents,renewal_credit_cents,hourly_cents,daily_cap_cents,billing_interval,billing_interval_count,included_minutes,discount_percent)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("customer_wallet_passes").select("id,membership_id,public_pass_id,status,provider_status,provider,provider_pass_id,pass_revision,token_version,apple_serial_number,google_object_id,last_generated_at,last_synced_at,revoked_at,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("customer_chargepoints_balances").select("balance,last_activity_at").eq("user_id", user.id).maybeSingle(),
    db.from("customer_membership_credit_balances").select("balance_cents,currency,next_expiry_at,last_activity_at").eq("user_id", user.id).eq("currency", "CHF").maybeSingle(),
  ]);
  if (rentalsResult.error) throw new Error("RENTALS_UNAVAILABLE");
  if (membershipResult.error) throw new Error("MEMBERSHIP_UNAVAILABLE");
  if (walletResult.error) throw new Error("WALLET_PASS_UNAVAILABLE");
  if (pointsResult.error) throw new Error("CHARGEPOINTS_UNAVAILABLE");
  if (rentalCreditResult.error) throw new Error("MEMBERSHIP_CREDIT_UNAVAILABLE");
  const rentals = rentalsResult.data ?? [];
  const rentalIds = rentals.map((rental) => String(rental.id));
  let payments: unknown[] = []; let refunds: unknown[] = []; let incidents: unknown[] = [];
  if (rentalIds.length) {
    const [paymentsResult, refundsResult, incidentsResult] = await Promise.all([
      db.from("payments").select("id,rental_session_id,provider,amount,currency,payment_method,status,created_at").in("rental_session_id", rentalIds),
      db.from("refunds").select("id,rental_session_id,amount,currency,status,reason,created_at,updated_at").in("rental_session_id", rentalIds),
      db.from("system_incidents").select("id,rental_session_id,type,severity,resolved,created_at,resolved_at").in("rental_session_id", rentalIds),
    ]);
    if (paymentsResult.error || refundsResult.error || incidentsResult.error) throw new Error("ACCOUNT_RELATED_DATA_UNAVAILABLE");
    payments = paymentsResult.data ?? []; refunds = refundsResult.data ?? []; incidents = incidentsResult.data ?? [];
  }
  return {
    profile: profileResult.data ?? null, rentals, payments, refunds, incidents,
    membership: membershipResult.data ?? null, walletPass: walletResult.data ?? null,
    chargePoints: { balance: Number(pointsResult.data?.balance ?? 0), lastActivityAt: pointsResult.data?.last_activity_at ?? null },
    rentalCredit: { balanceCents: Number(rentalCreditResult.data?.balance_cents ?? 0), currency: String(rentalCreditResult.data?.currency ?? "CHF"), nextExpiryAt: rentalCreditResult.data?.next_expiry_at ?? null, lastActivityAt: rentalCreditResult.data?.last_activity_at ?? null },
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

  if (action === "wallet_pass") {
    const walletAction = body.walletAction === "sync" ? "sync" : "issue";
    if (walletAction === "sync") {
      const { data: wallet, error: walletError } = await db.from("customer_wallet_passes")
        .select("id,membership_id,provider,provider_status,provider_pass_id,provider_instance_id,provider_add_to_wallet_url")
        .eq("user_id", user.id).eq("status", "active").is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (walletError) return json({ ok: false, error: "WALLET_PASS_UNAVAILABLE" }, 500);
      const addToWalletUrl = String(wallet?.provider_add_to_wallet_url ?? "").trim();
      const existingPassStudioPass = wallet?.provider === "pass_studio"
        && wallet?.provider_pass_id === CHARGEURS_CUSTOM_PASS_ID
        && Boolean(wallet?.provider_instance_id)
        && /^https:\/\/www\.passstudio\.online\/i\//i.test(addToWalletUrl);
      if (existingPassStudioPass) {
        const { data: outboxId, error: queueError } = await db.rpc("enqueue_customer_wallet_sync_event", {
          p_user_id: user.id, p_event_type: "manual_sync", p_event_key: `wallet:manual:${user.id}:${crypto.randomUUID()}`,
          p_rental_session_id: null, p_payload: { source: "account_pass" }, p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        if (queueError || !outboxId) return json({ ok: false, error: "WALLET_SYNC_QUEUE_FAILED" }, 500);
        await auditLog(db, { actor: user.id, action: "wallet.pass_sync_queued", target: wallet?.membership_id ?? user.id, data: { provider: "pass_studio", outbox_id: outboxId } });
        return json({ ok: true, provider: "pass_studio", status: "update_pending", addToWalletUrl, queued: true });
      }
    }
    const result = await handlePassStudioWallet(db, user, walletAction);
    return json(result.body, result.status);
  }

  if (action === "summary" || action === "export") {
    let data: Awaited<ReturnType<typeof customerData>>;
    try { data = await customerData(db, user); } catch { return json({ ok: false, error: "ACCOUNT_DATA_UNAVAILABLE" }, 500); }
    await auditLog(db, { actor: user.id, action: action === "export" ? "account.exported" : "account.summary_viewed", target: user.id });
    return json({ ok: true, generatedAt: new Date().toISOString(), data });
  }

  if (action === "delete") {
    if (body.confirmation !== "DELETE_ACCOUNT") return json({ ok: false, error: "CONFIRMATION_REQUIRED" }, 400);
    let data: Awaited<ReturnType<typeof customerData>>;
    try { data = await customerData(db, user); } catch { return json({ ok: false, error: "ACCOUNT_DATA_UNAVAILABLE" }, 500); }
    const states = data.rentals.map((rental) => String(rental.state));
    if (accountDeletionBlocked(states)) return json({ ok: false, error: "ACTIVE_OR_UNSETTLED_RENTAL" }, 409);
    await db.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", user.id);
    const anonymizedEmail = safeDeletedEmail(user.id);
    if (data.rentals.length) {
      const rentalIds = data.rentals.map((rental) => String(rental.id));
      const { error: rentalError } = await db.from("rental_sessions").update({ customer_user_id: null, customer_email: anonymizedEmail }).in("id", rentalIds);
      if (rentalError) return json({ ok: false, error: "ANONYMIZATION_FAILED" }, 500);
    }
    await auditLog(db, { actor: user.id, action: "account.deleted", target: user.id, data: { rentalsAnonymized: data.rentals.length } });
    const { error: deleteError } = await db.auth.admin.deleteUser(user.id);
    if (deleteError) return json({ ok: false, error: "ACCOUNT_DELETE_FAILED" }, 500);
    return json({ ok: true });
  }
  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
});
