import { adminClient, auditLog } from "../_shared/db.ts";
import { accountDeletionBlocked, safeDeletedEmail } from "../_shared/accountPrivacy.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function customerData(db: ReturnType<typeof adminClient>, user: { id: string; email?: string | null }) {
  const { data: byId } = await db.from("rental_sessions").select("*").eq("customer_user_id", user.id);
  const { data: byEmail } = user.email
    ? await db.from("rental_sessions").select("*").eq("customer_email", user.email)
    : { data: [] };
  const rentalsById = new Map<string, Record<string, unknown>>();
  for (const rental of [...(byId ?? []), ...(byEmail ?? [])]) rentalsById.set(String(rental.id), rental);
  const rentals = Array.from(rentalsById.values());
  const rentalIds = rentals.map((rental) => String(rental.id));
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (rentalIds.length === 0) return { profile, rentals: [], payments: [], refunds: [], incidents: [] };
  const [{ data: payments }, { data: refunds }, { data: incidents }] = await Promise.all([
    db.from("payments").select("id,rental_session_id,provider,amount,currency,payment_method,status,created_at").in("rental_session_id", rentalIds),
    db.from("refunds").select("id,rental_session_id,amount,currency,status,reason,created_at,updated_at").in("rental_session_id", rentalIds),
    db.from("system_incidents").select("id,rental_session_id,type,severity,resolved,created_at,resolved_at").in("rental_session_id", rentalIds),
  ]);
  return { profile, rentals, payments: payments ?? [], refunds: refunds ?? [], incidents: incidents ?? [] };
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
    const data = await customerData(db, user);
    await auditLog(db, { actor: user.id, action: action === "export" ? "account.exported" : "account.summary_viewed", target: user.id });
    return json({ ok: true, generatedAt: new Date().toISOString(), data });
  }

  if (action === "delete") {
    if (body.confirmation !== "DELETE_ACCOUNT") return json({ ok: false, error: "CONFIRMATION_REQUIRED" }, 400);
    const data = await customerData(db, user);
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
